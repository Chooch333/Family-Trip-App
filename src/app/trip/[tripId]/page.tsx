"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getMemberForTrip, getSessionTokens } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { askClaude, executeToolCall, getPromptChips } from "@/lib/claude";
import TripLayout from "@/components/TripLayout";
import ReactMarkdown from "react-markdown";
import type { Trip, TripMember, Day, Stop, Vote, Proposal } from "@/lib/database.types";

interface TripSwitcherItem {
  trip: Trip;
  memberCount: number;
  role: "organizer" | "member";
}

// --- Dynamic color gradient: forest green → teal → cyan → blue → indigo → purple/rose ---
function generateDayColors(count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return ["hsl(145, 55%, 33%)"];
  const hueStops = [145, 165, 180, 195, 220, 250, 280, 310];
  const satStops = [55, 60, 55, 50, 55, 50, 50, 45];
  const litStops = [33, 38, 40, 42, 42, 40, 38, 38];
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const idx = t * (hueStops.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, hueStops.length - 1);
    const frac = idx - lo;
    const h = hueStops[lo] + (hueStops[hi] - hueStops[lo]) * frac;
    const s = satStops[lo] + (satStops[hi] - satStops[lo]) * frac;
    const l = litStops[lo] + (litStops[hi] - litStops[lo]) * frac;
    colors.push(`hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`);
  }
  return colors;
}

// --- Stop type badge helper ---
function getStopBadge(stop: Stop): { label: string; bg: string; text: string } | null {
  const name = stop.name.toLowerCase();
  const desc = (stop.description || "").toLowerCase();
  const tags = Array.isArray(stop.tags) ? stop.tags.map((t: string) => t.toLowerCase()) : [];
  const all = `${name} ${desc} ${tags.join(" ")}`;

  if (all.match(/\b(breakfast|lunch|dinner|restaurant|cafe|coffee|eat|food|bistro|pizz|taco|bakery|brunch|gelato|ice cream)\b/))
    return { label: "Food", bg: "bg-orange-100", text: "text-orange-700" };
  if (all.match(/\b(walk|hike|trail|stroll|park|garden|beach|nature|waterfall)\b/))
    return { label: "Walking", bg: "bg-green-100", text: "text-green-700" };
  if (all.match(/\b(museum|gallery|castle|monument|cathedral|church|temple|ruins|historic|tour)\b/))
    return { label: "Visit", bg: "bg-blue-100", text: "text-blue-700" };
  if (all.match(/\b(shop|market|store|souvenir|mall|boutique)\b/))
    return { label: "Shopping", bg: "bg-pink-100", text: "text-pink-700" };
  return null;
}

// --- 12-hour time formatter ---
function formatTime12(time: string | null): string {
  if (!time) return "TBD";
  const parts = time.slice(0, 5).split(":");
  let h = parseInt(parts[0], 10);
  const m = parts[1] || "00";
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

// --- Leaflet Maps (dynamic, SSR-safe) ---
const TripMap = dynamic(() => import("./TripMap"), { ssr: false, loading: () => (
  <div className="flex-1 bg-gray-100 flex items-center justify-center">
    <p className="text-gray-400 text-xs">Loading map...</p>
  </div>
)});
const RegionalMap = dynamic(() => import("./RegionalMap"), { ssr: false, loading: () => (
  <div className="w-full bg-gray-100" style={{ height: 182 }} />
)});

// --- Haversine distance in km ---
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- Extract unique route cities from stops in travel order ---
interface RouteCity { name: string; lat: number; lng: number; dayIndices: number[]; }
interface RouteCityResult { cities: RouteCity[]; dayToCityIndex: Map<number, number>; }

function extractRouteCities(stops: Stop[], days: Day[]): RouteCityResult {
  const dayIdxMap = new Map<string, number>();
  days.forEach((d, i) => dayIdxMap.set(d.id, i));

  // Get all non-transit stops with coords, sorted by day then sort_order
  const ordered = stops
    .filter(s => s.latitude && s.longitude && s.stop_type !== "transit")
    .sort((a, b) => {
      const dayA = dayIdxMap.get(a.day_id) ?? 0;
      const dayB = dayIdxMap.get(b.day_id) ?? 0;
      if (dayA !== dayB) return dayA - dayB;
      return a.sort_order - b.sort_order;
    });

  if (ordered.length === 0) return { cities: [], dayToCityIndex: new Map() };

  // Cluster stops within ~15km into "cities", track which day indices belong to each
  interface RawCity { name: string; lat: number; lng: number; dayIndices: Set<number>; }
  const rawCities: RawCity[] = [];
  let clusterStops = [ordered[0]];

  function finalizeCluster(cluster: Stop[]) {
    const lat = cluster.reduce((s, st) => s + st.latitude!, 0) / cluster.length;
    const lng = cluster.reduce((s, st) => s + st.longitude!, 0) / cluster.length;
    const name = deriveCityName(cluster, stops, days, dayIdxMap);
    const dayIndices = new Set(cluster.map(s => dayIdxMap.get(s.day_id) ?? 0));
    rawCities.push({ name, lat, lng, dayIndices });
  }

  for (let i = 1; i < ordered.length; i++) {
    const prev = clusterStops[clusterStops.length - 1];
    const curr = ordered[i];
    const dist = haversineKm(prev.latitude!, prev.longitude!, curr.latitude!, curr.longitude!);
    if (dist < 15) {
      clusterStops.push(curr);
    } else {
      finalizeCluster(clusterStops);
      clusterStops = [curr];
    }
  }
  finalizeCluster(clusterStops);

  // Merge consecutive clusters with the same name
  const merged: RawCity[] = [];
  for (const city of rawCities) {
    if (merged.length > 0 && merged[merged.length - 1].name === city.name) {
      city.dayIndices.forEach(d => merged[merged.length - 1].dayIndices.add(d));
    } else {
      merged.push({ ...city, dayIndices: new Set(city.dayIndices) });
    }
  }

  // Build final cities and day-to-city-index lookup
  const cities: RouteCity[] = [];
  const dayToCityIndex = new Map<number, number>();
  merged.forEach((raw, cityIdx) => {
    const dayArr = Array.from(raw.dayIndices).sort((a, b) => a - b);
    cities.push({ name: raw.name, lat: raw.lat, lng: raw.lng, dayIndices: dayArr });
    dayArr.forEach(d => dayToCityIndex.set(d, cityIdx));
  });

  return { cities, dayToCityIndex };
}

function deriveCityName(clusterStops: Stop[], allStops: Stop[], days: Day[], dayIdxMap: Map<string, number>): string {
  // Try to find a transit stop right before this cluster that says "to CityName"
  const firstStop = clusterStops[0];
  const dayStops = allStops
    .filter(s => s.day_id === firstStop.day_id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const idx = dayStops.findIndex(s => s.id === firstStop.id);
  if (idx > 0) {
    for (let i = idx - 1; i >= 0; i--) {
      if (dayStops[i].stop_type === "transit") {
        const toMatch = dayStops[i].name.match(/(?:to|towards|into|arriving?\s+in)\s+(.+)/i);
        if (toMatch) return toMatch[1].trim();
        break;
      }
    }
  }

  // Try day title
  const dayIdx = dayIdxMap.get(firstStop.day_id) ?? 0;
  const dayTitle = days[dayIdx]?.title;
  if (dayTitle) {
    // If title has arrows or slashes, pick the relevant part
    const parts = dayTitle.split(/[→\-–\/,&]/).map(s => s.trim()).filter(Boolean);
    if (parts.length === 1) return parts[0];
    // Return the first part that isn't already used (rough heuristic)
    return parts[0];
  }

  // Fallback: use first stop name, shortened
  const stopName = clusterStops[0].name;
  // Try to extract a place-sounding short name
  return stopName.split(/[,\-–]/).map(s => s.trim())[0] || stopName;
}

// --- Check if trip is multi-city (>50km span) ---
function isMultiCityTrip(stops: Stop[]): boolean {
  const coords = stops.filter(s => s.latitude && s.longitude && s.stop_type !== "transit");
  if (coords.length < 2) return false;
  let maxDist = 0;
  for (let i = 0; i < coords.length; i++) {
    for (let j = i + 1; j < coords.length; j++) {
      const d = haversineKm(coords[i].latitude!, coords[i].longitude!, coords[j].latitude!, coords[j].longitude!);
      if (d > maxDist) maxDist = d;
      if (maxDist > 50) return true; // Early exit
    }
  }
  return maxDist > 50;
}

export default function TripDashboard() {
  const router = useRouter();
  const params = useParams();
  const tripId = params.tripId as string;
  const [loading, setLoading] = useState(true);
  const [currentMember, setCurrentMember] = useState<TripMember | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<TripMember[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [activeDay, setActiveDay] = useState<number>(0);
  const [showAddDay, setShowAddDay] = useState(false);
  const [newDayTitle, setNewDayTitle] = useState("");
  const [addingDay, setAddingDay] = useState(false);
  const [showAddStop, setShowAddStop] = useState(false);
  const [newStop, setNewStop] = useState({ name: "", description: "", start_time: "", duration_minutes: 30, cost_estimate: "" });
  const [addingStop, setAddingStop] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [generatingItinerary, setGeneratingItinerary] = useState(false);
  const [itinerarySaved, setItinerarySaved] = useState(false); // kept for logic flow only
  const [expandedStop, setExpandedStop] = useState<string | null>(null);
  const [pulsingStop, setPulsingStop] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  // Lightbox state
  const [lightboxStop, setLightboxStop] = useState<Stop | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  // Trip summary splash
  const [showTripSplash, setShowTripSplash] = useState(false);
  // Trip switcher
  const [allTrips, setAllTrips] = useState<TripSwitcherItem[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const stopRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const dayColors = generateDayColors(days.length);

  const getDayColor = useCallback((dayIdx: number) => {
    return dayColors[dayIdx] || "hsl(145, 55%, 33%)";
  }, [dayColors]);

  const getDayIdxForStop = useCallback((stop: Stop) => {
    return days.findIndex(d => d.id === stop.day_id);
  }, [days]);

  const ITINERARY_SYSTEM_PROMPT = `You are a family trip planning assistant. When the user describes a trip, generate a complete day-by-day itinerary.

You MUST respond with a friendly message followed by a JSON code block containing the itinerary. The JSON must be wrapped in \`\`\`json and \`\`\` markers.

The JSON format must be exactly:
{
  "days": [
    {
      "day_number": 1,
      "title": "City or area name",
      "narrative": "2-3 sentences setting the tone for this day. Explain the day's theme, energy level, and what makes this day special. Write as if you're a knowledgeable friend briefing the family. Example: 'Your first full day in Rome — hitting the ancient highlights while the kids still have energy. We're keeping the pace relaxed with a long gelato break in the afternoon.'",
      "stops": [
        {
          "name": "Place name",
          "description": "An engaging description that sells WHY this stop is worth visiting for this specific family. Don't just describe what it is — explain why it matters, what makes it special, and reference the family (kids' ages, interests). Write like a knowledgeable friend's recommendation, not a guidebook. Example: 'Historic gelateria serving Rome's best gelato since 1900 — the kids will love picking flavors at the counter' or 'Less crowded ancient Roman baths with virtual reality tours perfect for kids aged 10-12.'",
          "stop_type": "visit",
          "latitude": 42.1234,
          "longitude": -85.1234,
          "start_time": "9:00 AM",
          "duration_minutes": 90,
          "cost_estimate": 25.00
        }
      ]
    }
  ]
}

Rules:
- Include 4-7 stops per day with realistic times starting around 8-9am
- Include real coordinates (latitude/longitude) for each stop — EXCEPT transit stops
- Include cost estimates in USD (0 for free activities)
- Duration in minutes
- start_time in 12-hour format with AM/PM (e.g. "9:00 AM", "2:30 PM", "12:00 PM")
- Make stops family-friendly and varied (mix of activities, food, sightseeing)
- Include breakfast/lunch/dinner stops
- EVERY stop MUST have a compelling description — never leave it empty
- Descriptions must reference the family composition (mention kids, ages, interests) and explain WHY this stop is great for them specifically
- Each day MUST have a "narrative" field: 2-3 sentences setting the tone, theme, and energy level for that day
- stop_type must be one of: "visit", "food", "transit", "walk_by", "guided_tour"
- Use "food" for restaurants, cafes, gelato shops, bakeries, any meal/snack stop
- Use "transit" for travel between cities/areas (e.g. "Train to Florence", "Drive to Lucca"). Transit stops should have a descriptive name like "Train to Florence" and description with details (departure station, duration, tips). Transit stops do NOT need latitude/longitude
- Use "walk_by" for quick photo ops or strolls past landmarks without going inside
- Use "guided_tour" for stops with organized tours or guides
- Use "visit" for general sightseeing, museums, attractions`;

  // --- Chat persistence ---
  async function saveChatMessages(messages: { role: "user" | "assistant"; content: string }[]) {
    if (!currentMember) return;
    const messagesWithTimestamp = messages.map(m => ({ ...m, timestamp: new Date().toISOString() }));
    if (conversationId) {
      await supabase.from("ai_conversations").update({ messages: messagesWithTimestamp }).eq("id", conversationId);
    } else {
      const { data } = await supabase.from("ai_conversations").insert({
        trip_id: tripId, member_id: currentMember.id, messages: messagesWithTimestamp,
      }).select().single();
      if (data) setConversationId(data.id);
    }
  }

  async function handleChatSend(message?: string) {
    const text = message || chatInput.trim();
    if (!text || generatingItinerary) return;
    const userMsg = { role: "user" as const, content: text };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatInput("");
    setGeneratingItinerary(true);

    try {
      if (days.length === 0) {
        // Itinerary generation mode — use the itinerary system prompt
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: newMessages,
            systemPrompt: ITINERARY_SYSTEM_PROMPT,
            max_tokens: 8192,
          }),
        });
        const data = await res.json();
        // API returns content as array of blocks — extract text
        const contentBlocks: Array<{ type: string; text?: string }> = Array.isArray(data.content) ? data.content : [];
        const fullContent: string = contentBlocks.filter(b => b.type === "text").map(b => b.text || "").join("\n") || (typeof data.content === "string" ? data.content : "");
        const displayText = fullContent.replace(/```json[\s\S]*?```/g, "").trim();
        const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)```/);
        let parsed = false;
        if (jsonMatch) {
          try {
            const itinerary = JSON.parse(jsonMatch[1]);
            if (itinerary.days && Array.isArray(itinerary.days)) {
              const msgsWithText = displayText
                ? [...newMessages, { role: "assistant" as const, content: displayText }]
                : newMessages;
              if (displayText) setChatMessages(msgsWithText);
              await saveItinerary(itinerary.days);
              const finalMsgs = [...msgsWithText, { role: "assistant" as const, content: "Your itinerary is ready! Check out your days above." }];
              setChatMessages(finalMsgs);
              await saveChatMessages(finalMsgs);
              setItinerarySaved(true);
              parsed = true;
            }
          } catch { /* fall through */ }
        }
        if (!parsed) {
          const finalMsgs = [...newMessages, { role: "assistant" as const, content: fullContent }];
          setChatMessages(finalMsgs);
          await saveChatMessages(finalMsgs);
        }
      } else {
        // Conversational mode — use askClaude with full trip context and tool use
        let dayContext: string | undefined;
        if (days[activeDay]) {
          const ad = days[activeDay];
          const adStops = stops
            .filter(s => s.day_id === ad.id && s.stop_type !== "transit")
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((s, i) => `  ${i + 1}. [stop_id: ${s.id}] ${s.name} (${s.stop_type}, ${s.duration_minutes} min)`)
            .join("\n");
          dayContext = `The user is currently viewing Day ${ad.day_number}${ad.title ? ` — ${ad.title}` : ""}. When they say "today" or "this day" or ask about the current view, they mean Day ${ad.day_number}. Here are the stops for Day ${ad.day_number}:\n${adStops || "  (no stops yet)"}`;
        }
        const recentMessages = newMessages.slice(-20);
        const result = await askClaude({
          tripId,
          messages: recentMessages,
          systemContext: dayContext,
        });

        // Execute any tool calls
        const toolResults: string[] = [];
        for (const tc of result.toolCalls) {
          const r = await executeToolCall(tripId, tc);
          toolResults.push(r);
        }

        // Refresh stops if any tools were executed
        if (result.toolCalls.length > 0) {
          const { data: freshStops } = await supabase.from("stops").select("*").eq("trip_id", tripId).is("version_owner", null).order("sort_order");
          if (freshStops) setStops(freshStops as Stop[]);
        }

        // Build display message: Claude's text + tool action summaries
        const displayParts: string[] = [];
        if (result.text) displayParts.push(result.text);
        if (toolResults.length > 0 && !result.text) {
          displayParts.push(toolResults.join(". ") + ".");
        }
        const displayText = displayParts.join("\n\n") || "Done!";

        const finalMsgs = [...newMessages, { role: "assistant" as const, content: displayText }];
        setChatMessages(finalMsgs);
        await saveChatMessages(finalMsgs);
      }
    } catch {
      const errorMsgs = [...chatMessages, { role: "user" as const, content: text }, { role: "assistant" as const, content: "Sorry, something went wrong. Please try again." }];
      setChatMessages(errorMsgs);
      await saveChatMessages(errorMsgs);
    } finally {
      setGeneratingItinerary(false);
    }
  }

  async function saveItinerary(itineraryDays: Array<{ day_number: number; title: string; narrative?: string; stops: Array<{ name: string; description?: string; stop_type?: string; latitude?: number; longitude?: number; start_time?: string; duration_minutes?: number; cost_estimate?: number }> }>) {
    const colors = generateDayColors(itineraryDays.length);
    const createdDays: Day[] = [];
    for (const dayData of itineraryDays) {
      const color = colors[(dayData.day_number - 1) % colors.length];
      const { data: dayRow } = await supabase.from("days").insert({
        trip_id: tripId, day_number: dayData.day_number, title: dayData.title, color,
        narrative: dayData.narrative || null,
      }).select().single();
      if (dayRow) createdDays.push(dayRow as Day);
    }

    const allStops: Stop[] = [];
    for (let i = 0; i < itineraryDays.length; i++) {
      const dayData = itineraryDays[i];
      const savedDay = createdDays[i];
      if (!savedDay) continue;
      for (let j = 0; j < dayData.stops.length; j++) {
        const stopData = dayData.stops[j];
        const isTransit = stopData.stop_type === "transit";
        const { data: stopRow } = await supabase.from("stops").insert({
          trip_id: tripId, day_id: savedDay.id, name: stopData.name,
          description: stopData.description || null,
          latitude: isTransit ? null : (stopData.latitude || null),
          longitude: isTransit ? null : (stopData.longitude || null),
          start_time: stopData.start_time || null,
          duration_minutes: stopData.duration_minutes || 60,
          cost_estimate: stopData.cost_estimate ?? null,
          stop_type: stopData.stop_type || "visit",
          sort_order: j, created_by: currentMember?.id || null,
        }).select().single();
        if (stopRow) allStops.push(stopRow as Stop);
      }
    }
    setDays(createdDays);
    setStops(allStops);
    setActiveDay(0);
  }

  async function handleAddDay() {
    if (!newDayTitle.trim()) return;
    setAddingDay(true);
    const nextDayNumber = days.length > 0 ? Math.max(...days.map(d => d.day_number)) + 1 : 1;
    const newColors = generateDayColors(days.length + 1);
    const color = newColors[days.length];
    const { data, error } = await supabase.from("days").insert({ trip_id: tripId, day_number: nextDayNumber, title: newDayTitle.trim(), color }).select().single();
    if (data && !error) {
      setDays(prev => [...prev, data as Day]);
      setActiveDay(days.length);
      setNewDayTitle("");
      setShowAddDay(false);
    }
    setAddingDay(false);
  }

  async function handleAddStop() {
    if (!newStop.name.trim() || !days[activeDay]) return;
    setAddingStop(true);
    const dayStops = stops.filter(s => s.day_id === days[activeDay].id);
    const nextOrder = dayStops.length > 0 ? Math.max(...dayStops.map(s => s.sort_order)) + 1 : 0;
    const { data, error } = await supabase.from("stops").insert({
      trip_id: tripId, day_id: days[activeDay].id, name: newStop.name.trim(),
      description: newStop.description.trim() || null, start_time: newStop.start_time || null,
      duration_minutes: newStop.duration_minutes,
      cost_estimate: newStop.cost_estimate ? parseFloat(newStop.cost_estimate) : null,
      sort_order: nextOrder, created_by: currentMember?.id || null,
    }).select().single();
    if (data && !error) {
      setStops(prev => [...prev, data as Stop]);
      setNewStop({ name: "", description: "", start_time: "", duration_minutes: 30, cost_estimate: "" });
      setShowAddStop(false);
    }
    setAddingStop(false);
  }

  // Pulse a stop pin on the map
  function triggerPulse(stopId: string) {
    setPulsingStop(stopId);
    setTimeout(() => setPulsingStop(null), 800);
  }

  // Handle map pin click — select day, highlight stop, scroll to it
  function handleMapPinClick(stop: Stop) {
    const dayIdx = getDayIdxForStop(stop);
    if (dayIdx >= 0) setActiveDay(dayIdx);
    setExpandedStop(stop.id);
    triggerPulse(stop.id);
    // Scroll stop into view after a brief delay for re-render
    setTimeout(() => {
      const el = stopRefs.current.get(stop.id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }

  // Handle stop card click — expand and pulse
  function handleStopCardClick(stop: Stop) {
    setExpandedStop(expandedStop === stop.id ? null : stop.id);
    triggerPulse(stop.id);
  }

  // Lightbox navigation
  function openLightbox(stop: Stop, photoIndex: number) {
    setLightboxStop(stop);
    setLightboxIndex(photoIndex);
  }
  function closeLightbox() {
    setLightboxStop(null);
    setLightboxIndex(0);
  }
  function lightboxPrev() {
    if (!lightboxStop?.photos) return;
    const photos = lightboxStop.photos as { url: string }[];
    setLightboxIndex((lightboxIndex - 1 + photos.length) % photos.length);
  }
  function lightboxNext() {
    if (!lightboxStop?.photos) return;
    const photos = lightboxStop.photos as { url: string }[];
    setLightboxIndex((lightboxIndex + 1) % photos.length);
  }

  // Keyboard nav for lightbox
  useEffect(() => {
    if (!lightboxStop) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") lightboxPrev();
      if (e.key === "ArrowRight") lightboxNext();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lightboxStop, lightboxIndex]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, generatingItinerary]);

  // When activeDay changes, deselect stop
  useEffect(() => {
    setExpandedStop(null);
  }, [activeDay]);

  // Load data
  useEffect(() => {
    async function load() {
      const member = await getMemberForTrip(tripId);
      if (!member) { router.replace(`/trip/${tripId}/invite`); return; }
      setCurrentMember(member);
      const [tripRes, membersRes, daysRes, stopsRes, votesRes, proposalRes, convRes] = await Promise.all([
        supabase.from("trips").select("*").eq("id", tripId).single(),
        supabase.from("trip_members").select("*").eq("trip_id", tripId).order("joined_at"),
        supabase.from("days").select("*").eq("trip_id", tripId).order("day_number"),
        supabase.from("stops").select("*").eq("trip_id", tripId).is("version_owner", null).order("sort_order"),
        supabase.from("votes").select("*"),
        supabase.from("proposals").select("*").eq("trip_id", tripId).eq("status", "pending"),
        supabase.from("ai_conversations").select("*").eq("trip_id", tripId).eq("member_id", member.id).order("updated_at", { ascending: false }).limit(1),
      ]);
      if (tripRes.data) {
        setTrip(tripRes.data as Trip);
        // Show trip summary splash once per session
        const t = tripRes.data as Trip & { trip_summary?: string | null };
        if (t.trip_summary && typeof window !== "undefined") {
          const key = `splash_seen_${tripId}`;
          if (!sessionStorage.getItem(key)) {
            setShowTripSplash(true);
            sessionStorage.setItem(key, "1");
          }
        }
      }
      if (membersRes.data) setMembers(membersRes.data as TripMember[]);
      if (daysRes.data) setDays(daysRes.data as Day[]);
      if (stopsRes.data) setStops(stopsRes.data as Stop[]);
      if (votesRes.data) setVotes(votesRes.data as Vote[]);
      if (proposalRes.data) setProposals(proposalRes.data as Proposal[]);
      // Restore chat history
      if (convRes.data && convRes.data.length > 0) {
        const conv = convRes.data[0] as { id: string; messages: { role: "user" | "assistant"; content: string }[] };
        setConversationId(conv.id);
        if (conv.messages && Array.isArray(conv.messages)) {
          setChatMessages(conv.messages.map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content })));
        }
      }
      setLoading(false);
    }
    load();
  }, [tripId, router]);

  // Generate trip_summary if missing (for splash overlay)
  useEffect(() => {
    if (!trip || (trip as Trip & { trip_summary?: string | null }).trip_summary || days.length === 0) return;
    (async () => {
      const result = await askClaude({
        tripId,
        messages: [{ role: "user", content: "Write a single exciting paragraph (3-4 sentences) summarizing this entire trip. Text only, no tools." }],
        systemContext: "Generate a trip summary. Text only, no tools.",
      });
      if (result.text) {
        await supabase.from("trips").update({ trip_summary: result.text }).eq("id", tripId);
        setTrip(prev => prev ? { ...prev, trip_summary: result.text } as Trip : prev);
        // Show splash if not already seen
        if (typeof window !== "undefined" && !sessionStorage.getItem(`splash_seen_${tripId}`)) {
          setShowTripSplash(true);
          sessionStorage.setItem(`splash_seen_${tripId}`, "1");
        }
      }
    })();
  }, [trip, days.length, tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch all trips for the switcher (cached, never blocks dropdown)
  const tripsFetchedAt = useRef<number>(0);
  const loadAllTrips = useCallback(async () => {
    const tokens = getSessionTokens();
    if (tokens.length === 0) return;
    const memberRows: { trip_id: string; role: "organizer" | "member" }[] = [];
    for (const token of tokens) {
      const { data } = await supabase.from("trip_members").select("trip_id, role").eq("session_token", token);
      if (data) data.forEach((d) => memberRows.push(d as { trip_id: string; role: "organizer" | "member" }));
    }
    if (memberRows.length === 0) return;
    const tripIds = Array.from(new Set(memberRows.map(m => m.trip_id)));
    const { data: trips } = await supabase.from("trips").select("*").in("id", tripIds).order("updated_at", { ascending: false });
    if (!trips) return;
    const items: TripSwitcherItem[] = [];
    for (const t of trips as Trip[]) {
      const { count } = await supabase.from("trip_members").select("*", { count: "exact", head: true }).eq("trip_id", t.id);
      const membership = memberRows.find(m => m.trip_id === t.id);
      items.push({ trip: t, memberCount: count || 0, role: membership?.role || "member" });
    }
    items.sort((a, b) => {
      if (a.trip.id === tripId) return -1;
      if (b.trip.id === tripId) return 1;
      return 0;
    });
    setAllTrips(items);
    tripsFetchedAt.current = Date.now();
  }, [tripId]);

  // Pre-fetch trip list on mount, refresh on visibilitychange and staleness
  useEffect(() => {
    loadAllTrips();
    const onVisibility = () => {
      if (document.visibilityState === "visible") loadAllTrips();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const interval = setInterval(() => {
      if (Date.now() - tripsFetchedAt.current > 60_000) loadAllTrips();
    }, 10_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(interval);
    };
  }, [loadAllTrips]);

  const multiCity = useMemo(() => isMultiCityTrip(stops), [stops]);
  const routeData = useMemo(() => multiCity ? extractRouteCities(stops, days) : { cities: [], dayToCityIndex: new Map<number, number>() }, [stops, days, multiCity]);
  const routeCities = routeData.cities;
  const dayToCityIndex = routeData.dayToCityIndex;
  const activeCityIndex = dayToCityIndex.get(activeDay) ?? -1;

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3 animate-pulse">
          <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
          </svg>
        </div>
        <p className="text-gray-400 text-sm">Loading trip...</p>
      </div>
    </div>
  );

  if (!trip || !currentMember) return null;
  const currentDayStops = days[activeDay] ? stops.filter(s => s.day_id === days[activeDay].id) : [];
  const stopsWithCoords = stops.filter(s => s.latitude && s.longitude && s.stop_type !== "transit");

  const lightboxPhotos = lightboxStop?.photos ? (lightboxStop.photos as { url: string; attribution?: string }[]) : [];

  // ---------- Render-prop content for TripLayout ----------
  const renderLeftPanel = () => {
    const activeDayObj = days[activeDay];
    const dayColor = activeDayObj ? getDayColor(activeDay) : "#1D9E75";
    return (
      <>
        {showAddDay && (
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/60 flex-shrink-0">
            <div className="flex flex-col gap-1.5">
              <input
                type="text"
                value={newDayTitle}
                onChange={e => setNewDayTitle(e.target.value)}
                placeholder="Day title (e.g. Traverse City)"
                autoFocus
                className="text-[12px] px-2.5 py-1.5 rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-400"
                onKeyDown={e => e.key === "Enter" && handleAddDay()}
              />
              <div className="flex gap-1.5">
                <button
                  onClick={handleAddDay}
                  disabled={addingDay || !newDayTitle.trim()}
                  className="flex-1 px-2 py-1 rounded-md bg-emerald-500 text-white text-[11px] font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addingDay ? "Adding..." : "Add"}
                </button>
                <button
                  onClick={() => { setShowAddDay(false); setNewDayTitle(""); }}
                  className="px-2 py-1 rounded-md text-gray-400 text-[11px] hover:text-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {activeDayObj && (
          <div
            className="sticky top-0 z-10 bg-white px-3 py-3 border-b border-gray-100 flex-shrink-0"
            style={{ borderBottomWidth: 0.5 }}
          >
            <div className="text-[12px] font-semibold text-gray-900 leading-tight">
              Day {activeDayObj.day_number}{activeDayObj.title ? ` · ${activeDayObj.title}` : ""}
            </div>
            {activeDayObj.narrative && (
              <div className="text-[10px] text-gray-500 leading-snug mt-1.5 line-clamp-3">
                {activeDayObj.narrative}
              </div>
            )}
          </div>
        )}

        <div>
          {!activeDayObj && (
            <div className="px-3 py-10 text-center">
              <p className="text-gray-400 text-[11px]">No days yet</p>
            </div>
          )}
          {activeDayObj && currentDayStops.length === 0 && (
            <div className="px-3 py-10 text-center">
              <p className="text-gray-400 text-[11px]">No stops on this day yet</p>
            </div>
          )}
          {currentDayStops.map(stop => {
            if (stop.stop_type === "transit") {
              const tname = stop.name.toLowerCase();
              const icon = tname.includes("train") || tname.includes("rail") ? "🚆"
                : tname.includes("fly") || tname.includes("flight") ? "✈️"
                : tname.includes("ferry") || tname.includes("boat") ? "⛴️"
                : "🚗";
              const dur = stop.duration_minutes >= 60
                ? `${(stop.duration_minutes / 60).toFixed(stop.duration_minutes % 60 === 0 ? 0 : 1)}h`
                : `${stop.duration_minutes}m`;
              return (
                <div
                  key={stop.id}
                  ref={el => { if (el) stopRefs.current.set(stop.id, el); }}
                  className="flex items-center gap-2 px-3 py-2"
                >
                  <div className="flex-1 h-px" style={{ backgroundColor: dayColor, opacity: 0.25 }} />
                  <span className="text-[11px]">{icon}</span>
                  <span className="text-[10px] font-medium text-gray-600 truncate">{stop.name}</span>
                  <span className="text-[10px] text-gray-400 flex-shrink-0">· {dur}</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: dayColor, opacity: 0.25 }} />
                </div>
              );
            }
            const isSelected = expandedStop === stop.id;
            return (
              <div
                key={stop.id}
                ref={el => { if (el) stopRefs.current.set(stop.id, el); }}
                onClick={(e) => { e.stopPropagation(); handleStopCardClick(stop); }}
                className="flex items-stretch border-b border-gray-100 cursor-pointer transition-colors"
                style={{
                  backgroundColor: isSelected ? "#f9fafb" : "transparent",
                  borderBottomWidth: 0.5,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = "#fafafa";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                }}
              >
                <div className="flex-shrink-0" style={{ width: 4, backgroundColor: dayColor }} />
                <div className="flex-1 min-w-0 px-3 py-2.5 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-gray-900 truncate leading-tight">
                      {stop.name}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5 truncate">
                      {stop.stop_type} · {stop.duration_minutes} min
                    </div>
                  </div>
                  {stop.start_time && (
                    <div className="text-[10px] text-gray-400 whitespace-nowrap pt-0.5">
                      {formatTime12(stop.start_time)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {showAddStop && activeDayObj && (
          <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/60">
            <div className="text-[11px] font-medium text-gray-700 mb-1.5">New stop for Day {activeDayObj.day_number}</div>
            <div className="flex flex-col gap-1.5">
              <input
                type="text"
                value={newStop.name}
                onChange={e => setNewStop(s => ({ ...s, name: e.target.value }))}
                placeholder="Stop name *"
                autoFocus
                className="text-[11px] px-2 py-1.5 rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-400"
              />
              <input
                type="text"
                value={newStop.description}
                onChange={e => setNewStop(s => ({ ...s, description: e.target.value }))}
                placeholder="Description"
                className="text-[11px] px-2 py-1.5 rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-400"
              />
              <div className="flex gap-1.5">
                <input
                  type="time"
                  value={newStop.start_time}
                  onChange={e => setNewStop(s => ({ ...s, start_time: e.target.value }))}
                  className="flex-1 text-[11px] px-2 py-1.5 rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-400"
                />
                <input
                  type="number"
                  value={newStop.duration_minutes}
                  onChange={e => setNewStop(s => ({ ...s, duration_minutes: parseInt(e.target.value) || 0 }))}
                  min="0"
                  className="w-16 text-[11px] px-2 py-1.5 rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-400"
                />
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={handleAddStop}
                  disabled={addingStop || !newStop.name.trim()}
                  className="flex-1 px-2 py-1 rounded-md bg-emerald-500 text-white text-[11px] font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addingStop ? "Adding..." : "Add"}
                </button>
                <button
                  onClick={() => { setShowAddStop(false); setNewStop({ name: "", description: "", start_time: "", duration_minutes: 30, cost_estimate: "" }); }}
                  className="px-2 py-1 rounded-md text-gray-400 text-[11px] hover:text-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="px-3 py-2.5 mt-auto border-t border-gray-100 flex-shrink-0 flex flex-col gap-1.5" style={{ borderTopWidth: 0.5 }}>
          {!showAddStop && activeDayObj && (
            <button
              onClick={() => setShowAddStop(true)}
              className="w-full border border-dashed border-gray-300 rounded-lg py-1.5 text-[11px] text-gray-500 hover:border-emerald-400 hover:text-emerald-600 transition-colors"
            >
              + Add stop
            </button>
          )}
          {activeDayObj && (
            <button
              onClick={() => router.push(`/trip/${tripId}/vibe`)}
              className="w-full border border-dashed rounded-lg py-1.5 text-[11px] transition-colors hover:bg-purple-50"
              style={{ borderColor: "#A89BF1", color: "#534AB7" }}
            >
              Re-vibe this day
            </button>
          )}
        </div>
      </>
    );
  };

  const renderChat = () => (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
        {chatMessages.length === 0 && days.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="14" rx="3" />
                <path d="M7 10h10m-10 4h6" />
              </svg>
            </div>
            <h2 className="text-[15px] font-semibold text-gray-900 mb-1">Plan your trip with Claude</h2>
            <p className="text-[12px] text-gray-500 text-center max-w-[380px] mb-5 leading-relaxed">
              Tell me about your trip — where are you going, how long, and what does your family enjoy?
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-[460px]">
              {["Plan 9 days in Italy with kids", "Weekend trip to Northern Michigan", "5-day beach vacation in Florida", "Family road trip through national parks"].map(chip => (
                <button
                  key={chip}
                  onClick={() => handleChatSend(chip)}
                  className="px-3 py-1.5 rounded-full text-[11px] border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        )}

        {chatMessages.length === 0 && days.length > 0 && (
          <div className="flex flex-col items-center justify-center py-6 px-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="14" rx="3" />
                  <path d="M7 10h10" strokeLinecap="round" />
                </svg>
              </div>
              <span className="text-[12px] font-medium text-gray-600">Claude is ready</span>
            </div>
            <p className="text-[11px] text-gray-500 text-center max-w-[380px] mb-3">
              Ask anything about your trip — change a stop, suggest restaurants, rebalance the day.
            </p>
          </div>
        )}

        {chatMessages.map((msg, idx) => (
          <div key={idx} className={`mb-4 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "user" ? (
              <div className="max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] leading-[1.55] whitespace-pre-wrap" style={{ backgroundColor: "#F5F4F0", color: "#1f2937" }}>
                {msg.content}
              </div>
            ) : (
              <div className="max-w-[88%]">
                <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "#534AB7" }}>Claude</div>
                <div className="text-[13px] text-gray-800 leading-[1.6] chat-markdown">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        ))}

        {generatingItinerary && (
          <div className="mb-4 flex justify-start">
            <div className="max-w-[88%]">
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "#534AB7" }}>Claude</div>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: "#534AB7", animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: "#534AB7", animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: "#534AB7", animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {chatMessages.length === 0 && days.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2 flex-shrink-0">
          {getPromptChips(trip).map(chip => (
            <button
              key={chip}
              onClick={() => handleChatSend(chip)}
              className="px-2.5 py-1 rounded-full text-[11px] border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
              disabled={generatingItinerary}
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      <div
        className="flex gap-2 px-4 py-2.5 flex-shrink-0 border-t border-gray-100"
        style={{ borderTopWidth: 0.5 }}
      >
        <input
          type="text"
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          placeholder={days.length === 0 ? "Describe your dream trip..." : "Ask about your trip..."}
          className="flex-1 text-[13px] px-4 py-2.5 border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-300 transition-colors"
          style={{ borderRadius: 20 }}
          onKeyDown={e => e.key === "Enter" && handleChatSend()}
          disabled={generatingItinerary}
        />
        <button
          onClick={() => handleChatSend()}
          disabled={generatingItinerary || !chatInput.trim()}
          className="px-4 py-2.5 text-[12px] font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: "#534AB7", borderRadius: 20 }}
        >
          {generatingItinerary ? "..." : "Send"}
        </button>
      </div>
    </>
  );

  const renderRightPanel = () => {
    const activeDayObj = days[activeDay];
    return (
      <>
        {multiCity && routeCities.length >= 2 && stopsWithCoords.length > 0 && (
          <div className="px-3 py-2 border-b border-gray-100 bg-white flex-shrink-0 text-center" style={{ borderBottomWidth: 0.5 }}>
            <div className="text-[12px] font-medium text-gray-600 flex items-center justify-center gap-1 flex-wrap">
              {routeCities.map((city, i) => {
                const isActiveCity = i === activeCityIndex;
                const activeDayColor = dayColors[activeDay] || "#1D9E75";
                return (
                  <span key={`${city.name}-${i}`} className="whitespace-nowrap">
                    {i > 0 && <span className="text-gray-300 mx-1">→</span>}
                    <span style={{
                      fontWeight: isActiveCity ? 700 : 500,
                      color: isActiveCity ? activeDayColor : undefined,
                    }}>{city.name}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {multiCity && routeCities.length >= 2 && stopsWithCoords.length > 0 && (
          <RegionalMap
            routeCities={routeCities}
            activeCityIndex={activeCityIndex}
            activeDayColor={dayColors[activeDay] || "#1D9E75"}
            onSelectDay={setActiveDay}
          />
        )}
        <div className="flex-1 relative min-h-0">
          {stopsWithCoords.length > 0 ? (
            <>
              <TripMap
                stops={stops}
                days={days}
                activeDay={activeDay}
                dayColors={dayColors}
                pulsingStop={pulsingStop}
                selectedStop={expandedStop}
                onPinClick={handleMapPinClick}
              />
              {activeDayObj && (
                <div
                  className="absolute top-2 left-2 px-2.5 py-1 rounded-md shadow-sm pointer-events-none"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.95)",
                    zIndex: 500,
                    border: `1px solid ${dayColors[activeDay] || "#1D9E75"}`,
                  }}
                >
                  <div className="text-[10px] font-semibold" style={{ color: dayColors[activeDay] || "#1D9E75" }}>
                    Day {activeDayObj.day_number}{activeDayObj.title ? ` · ${activeDayObj.title}` : ""}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
              <div className="text-center px-4">
                <svg className="w-10 h-10 text-gray-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z" />
                </svg>
                <p className="text-gray-400 text-[11px]">Add stops with coordinates to see the map</p>
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <>
      {/* Trip summary splash overlay */}
      {showTripSplash && (trip as Trip & { trip_summary?: string | null }).trip_summary && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl max-w-lg mx-4 p-8 shadow-2xl">
            <h2 className="text-[20px] font-semibold text-gray-900 mb-4">{trip.name}</h2>
            <p className="text-[14px] text-gray-700 leading-relaxed mb-6">{(trip as Trip & { trip_summary?: string | null }).trip_summary}</p>
            <button onClick={() => setShowTripSplash(false)} className="w-full py-3 rounded-lg text-white font-medium text-[14px]" style={{ backgroundColor: "#1D9E75" }}>
              Dive in
            </button>
          </div>
        </div>
      )}

      {/* Lightbox overlay */}
      {lightboxStop && lightboxPhotos.length > 0 && (
        <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center" onClick={closeLightbox}>
          <div className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center" onClick={e => e.stopPropagation()}>
            <img src={lightboxPhotos[lightboxIndex]?.url} alt="" className="max-w-full max-h-[85vh] object-contain rounded-lg" />
            <button onClick={closeLightbox} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 text-lg">&times;</button>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-3 py-1 rounded-full">
              {lightboxIndex + 1} / {lightboxPhotos.length}
            </div>
            {lightboxPhotos.length > 1 && (
              <>
                <button onClick={lightboxPrev} className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 text-xl">&lsaquo;</button>
                <button onClick={lightboxNext} className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 text-xl">&rsaquo;</button>
              </>
            )}
          </div>
        </div>
      )}

      <TripLayout
        trip={trip}
        days={days}
        activeDay={activeDay}
        dayColors={dayColors}
        members={members}
        stops={stops}
        onSelectDay={setActiveDay}
        onAddDay={() => setShowAddDay(true)}
        trips={allTrips.map(item => item.trip)}
        onNewTrip={() => router.push("/")}
        onSwitchTrip={(id) => router.push(`/trip/${id}`)}
        renderLeftPanel={renderLeftPanel}
        renderChat={renderChat}
        renderRightPanel={renderRightPanel}
      />
    </>
  );
}
