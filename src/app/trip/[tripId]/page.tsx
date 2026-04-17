"use client";
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getMemberForTrip, getSessionTokens } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { askClaude, executeToolCall, getPromptChips } from "@/lib/claude";
import { geocodeAndUpdateStop } from "@/lib/geocode";
import { generateDayColors, formatTime12 } from "@/lib/tripHelpers";
import TripLayout from "@/components/TripLayout";
import TripTour from "@/components/TripTour";
import SortableStopRow from "@/components/SortableStopRow";
import Lightbox from "@/components/Lightbox";
import AnchorIcon from "@/components/AnchorIcon";
import PlacesAutocomplete from "@/components/PlacesAutocomplete";
import type { PlaceResult } from "@/components/PlacesAutocomplete";
import ReactMarkdown from "react-markdown";
import type { Trip, TripMember, Day, Stop, Vote, Proposal, Profile } from "@/lib/database.types";
import { extractRouteCities, isMultiCityTrip, type RouteCity } from "@/lib/routeCities";
import {
  DndContext, DragEndEvent, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

interface TripSwitcherItem {
  trip: Trip;
  memberCount: number;
  role: "organizer" | "member";
}

// --- Leaflet Maps (dynamic, SSR-safe) ---
const TripMap = dynamic(() => import("./TripMap"), { ssr: false, loading: () => (
  <div className="flex-1 bg-gray-100 flex items-center justify-center">
    <p className="text-gray-400 text-xs">Loading map...</p>
  </div>
)});
const RegionalMap = dynamic(() => import("./RegionalMap"), { ssr: false, loading: () => (
  <div className="w-full bg-gray-100" style={{ height: 209 }} />
)});

// Multi-city helpers (haversineKm, extractRouteCities, deriveCityName, isMultiCityTrip, RouteCity)
// have moved to src/lib/routeCities.ts and are imported above.

export default function TripDashboard() {
  const router = useRouter();
  const params = useParams();
  const tripId = params.tripId as string;
  const [loading, setLoading] = useState(true);
  const [currentMember, setCurrentMember] = useState<TripMember | null>(null);
  const [currentProfile, setCurrentProfile] = useState<{ id: string; display_name: string; avatar_color: string; avatar_initial: string; email: string } | undefined>(undefined);
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
  const [newStop, setNewStop] = useState({ name: "", description: "", start_time: "", duration_minutes: 30, cost_estimate: "", latitude: null as number | null, longitude: null as number | null, placeId: "" });
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
  // Trip tour slideshow
  const [showTripTour, setShowTripTour] = useState(false);
  // Trip switcher
  const [allTrips, setAllTrips] = useState<TripSwitcherItem[]>([]);
  // Accommodation
  const [accommEditing, setAccommEditing] = useState(false);
  const [accommForm, setAccommForm] = useState({ name: "", latitude: null as number | null, longitude: null as number | null, placeId: "" });
  const [accommSaving, setAccommSaving] = useState(false);
  const [selectedAccomm, setSelectedAccomm] = useState(false);
  const accommCardRef = useRef<HTMLDivElement>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const stopRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const dayColors = generateDayColors(days.length);

  const getDayColor = useCallback((dayIdx: number) => {
    return dayColors[dayIdx] || "hsl(145, 55%, 33%)";
  }, [dayColors]);

  const getDayIdxForStop = useCallback((stop: Stop) => {
    return days.findIndex(d => d.id === stop.day_id);
  }, [days]);

  const ITINERARY_SYSTEM_PROMPT = `You are this trip's Co-Pilot — the friend who's already been everywhere and has strong opinions about all of it. You've walked these streets, eaten at these restaurants, and you know which "must-see" spots are actually worth the line and which ones you'd skip for something better around the corner.

When the family describes their trip, build them something that feels like it was made by someone who's personally invested in them having an incredible time. Not a generic list — a real trip, with opinions.

You MUST respond with a friendly, personality-rich message (in your Co-Pilot voice — warm, specific, opinionated) followed by a JSON code block containing the itinerary. The JSON must be wrapped in \`\`\`json and \`\`\` markers.

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
- Make stops family-friendly and varied — but have opinions about each one
- Include food stops for meals, and pick places you'd actually send a friend to
- EVERY stop MUST have a description that sounds like you're standing outside it telling the family why you brought them here. Not what it is — why it matters to THEM. Use sensory details, reference the kids, be specific.
- Never write "popular attraction" or "highly rated" — talk like a person, not a brochure
- Each day MUST have a "narrative" field: 2-3 sentences setting the energy, like you're briefing the family at breakfast. "Okay, today's the big one — we're hitting the ancient highlights while the kids still have energy."
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
    if (chatInputRef.current) chatInputRef.current.style.height = "auto";
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
          // Build accommodation context for current and adjacent days
          let accommContext = "";
          if (ad.accommodation_name) {
            accommContext += `\nAccommodation: The traveler is staying at "${ad.accommodation_name}". Factor proximity to this accommodation when discussing logistics and travel times.`;
          }
          const prevDay = days[activeDay - 1];
          const nextDay = days[activeDay + 1];
          if (prevDay?.accommodation_name) accommContext += `\nPrevious night: ${prevDay.accommodation_name}`;
          if (ad.accommodation_name) accommContext += `\nTonight: ${ad.accommodation_name}`;
          if (nextDay?.accommodation_name) accommContext += `\nTomorrow night: ${nextDay.accommodation_name}`;

          dayContext = `SELECTED DAY: Day ${ad.day_number} (day_id: ${ad.id})${ad.title ? ` — ${ad.title}` : ""}
The user is currently viewing and interacting with Day ${ad.day_number}. This is their active focus. When they say "today", "this day", "here", "this one", "add a stop", "swap", "move", or make any request without specifying a day number, they mean Day ${ad.day_number}.
Stops on Day ${ad.day_number}:\n${adStops || "  (no stops yet)"}${accommContext}`;
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
          if (freshStops) {
            setStops(freshStops as Stop[]);
            // Geocode any new stops missing coordinates
            const dest = trip?.destination || undefined;
            for (const s of freshStops as Stop[]) {
              if (!s.latitude && !s.longitude && s.stop_type !== "transit") {
                geocodeAndUpdateStop(s.id, s.name, dest).then(coords => {
                  if (coords) setStops(prev => prev.map(x => x.id === s.id ? { ...x, ...coords } : x));
                });
              }
            }
          }
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
      latitude: newStop.latitude || null,
      longitude: newStop.longitude || null,
      sort_order: nextOrder, created_by: currentMember?.id || null,
    }).select().single();
    if (data && !error) {
      const stop = data as Stop;
      setStops(prev => [...prev, stop]);
      setNewStop({ name: "", description: "", start_time: "", duration_minutes: 30, cost_estimate: "", latitude: null, longitude: null, placeId: "" });
      setShowAddStop(false);
      // Only geocode if Places didn't provide coordinates
      if (!stop.latitude && !stop.longitude && stop.stop_type !== "transit") {
        geocodeAndUpdateStop(stop.id, stop.name, trip?.destination || undefined).then(coords => {
          if (coords) setStops(prev => prev.map(s => s.id === stop.id ? { ...s, ...coords } : s));
        });
      }
    }
    setAddingStop(false);
  }

  // Save accommodation for the active day + autofill same-city days
  async function handleSaveAccommodation() {
    const activeDayObj = days[activeDay];
    if (!activeDayObj) return;
    setAccommSaving(true);
    const name = accommForm.name.trim() || null;

    // Use Places coordinates if available, otherwise fall back to Nominatim
    let lat: number | null = accommForm.latitude;
    let lng: number | null = accommForm.longitude;
    if (name && lat == null && lng == null) {
      const query = [name, trip?.destination].filter(Boolean).join(", ");
      try {
        const res = await fetch(`/api/geocode?${new URLSearchParams({ q: query })}`);
        if (res.ok) {
          const geo = await res.json();
          if (geo.latitude != null && geo.longitude != null) {
            lat = geo.latitude;
            lng = geo.longitude;
          }
        }
      } catch { /* ignore geocode failure */ }
    }

    // Update current day
    await supabase.from("days").update({
      accommodation_name: name,
      accommodation_latitude: lat,
      accommodation_longitude: lng,
    }).eq("id", activeDayObj.id);

    // Autofill same-city days that have no accommodation
    if (name && activeDayObj.title) {
      await supabase.from("days").update({
        accommodation_name: name,
        accommodation_latitude: lat,
        accommodation_longitude: lng,
      }).eq("trip_id", tripId)
        .neq("id", activeDayObj.id)
        .is("accommodation_name", null)
        .ilike("title", activeDayObj.title);
    }

    // Refresh days
    const { data: freshDays } = await supabase.from("days").select("*").eq("trip_id", tripId).order("day_number");
    if (freshDays) setDays(freshDays as Day[]);

    setAccommEditing(false);
    setAccommSaving(false);
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
    setSelectedAccomm(false);
    triggerPulse(stop.id);
  }

  function handleAccommCardClick() {
    setSelectedAccomm(true);
    setExpandedStop(null);
  }

  async function handleToggleAnchor(stop: Stop) {
    const newVal = !stop.is_anchor;
    await supabase.from("stops").update({ is_anchor: newVal }).eq("id", stop.id);
    setStops(prev => prev.map(s => {
      if (s.id === stop.id) return { ...s, is_anchor: newVal };
      return s;
    }));
  }

  // Drag-and-drop reordering for the active day's non-transit stops
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  function handleDragStart(_e: DragStartEvent) { /* no-op for now */ }
  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeDayObj = days[activeDay];
    if (!activeDayObj) return;
    const dayStops = stops
      .filter(s => s.day_id === activeDayObj.id && s.stop_type !== "transit")
      .sort((a, b) => a.sort_order - b.sort_order);
    const oldIdx = dayStops.findIndex(s => s.id === active.id);
    const newIdx = dayStops.findIndex(s => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = [...dayStops];
    const [moved] = reordered.splice(oldIdx, 1);
    reordered.splice(newIdx, 0, moved);
    // Optimistic local update
    const newOrderById = new Map(reordered.map((s, i) => [s.id, i]));
    setStops(prev => prev.map(s => {
      const idx = newOrderById.get(s.id);
      return idx === undefined ? s : { ...s, sort_order: idx };
    }));
    // Persist
    for (let i = 0; i < reordered.length; i++) {
      await supabase.from("stops").update({ sort_order: i }).eq("id", reordered[i].id);
    }
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
      // Load profile if linked, otherwise fall back to member data so avatar always shows
      if (member.profile_id) {
        const { data: prof } = await supabase.from("profiles").select("id, display_name, avatar_color, avatar_initial, email").eq("id", member.profile_id).single();
        if (prof) setCurrentProfile(prof as { id: string; display_name: string; avatar_color: string; avatar_initial: string; email: string });
      } else {
        setCurrentProfile({
          id: member.id,
          display_name: member.display_name,
          avatar_color: member.avatar_color,
          avatar_initial: member.avatar_initial,
          email: "",
        });
      }
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
          const key = `tour_seen_${tripId}`;
          if (!sessionStorage.getItem(key)) {
            setShowTripTour(true);
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
        if (typeof window !== "undefined" && !sessionStorage.getItem(`tour_seen_${tripId}`)) {
          setShowTripTour(true);
          sessionStorage.setItem(`tour_seen_${tripId}`, "1");
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
              <div className="text-[17px] text-gray-500 leading-snug mt-1.5">
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
          <DndContext
            sensors={dndSensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={currentDayStops.filter(s => s.stop_type !== "transit").map(s => s.id)}
              strategy={verticalListSortingStrategy}
            >
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
                      <span className="text-[17px]">{icon}</span>
                      <span className="text-[15px] font-medium text-gray-600 truncate">{stop.name}</span>
                      <span className="text-[15px] text-gray-400 flex-shrink-0">· {dur}</span>
                      <div className="flex-1 h-px" style={{ backgroundColor: dayColor, opacity: 0.25 }} />
                    </div>
                  );
                }
                const isSelected = expandedStop === stop.id;
                return (
                  <SortableStopRow
                    key={stop.id}
                    stop={stop}
                    dayColor={dayColor}
                    isSelected={isSelected}
                    onClick={() => { handleStopCardClick(stop); }}
                    refSetter={(el) => { if (el) stopRefs.current.set(stop.id, el); }}
                    isAnchored={!!stop.is_anchor}
                    onToggleAnchor={() => handleToggleAnchor(stop)}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        </div>

        {/* Accommodation sub-card */}
        {activeDayObj && (
          <div className="px-3 py-2" ref={accommCardRef}>
            {accommEditing ? (
              <div style={{ border: "1.5px dashed #d1d5db", borderRadius: 8, padding: "10px 12px" }}>
                <PlacesAutocomplete
                  value={accommForm.name}
                  onChange={v => setAccommForm(f => ({ ...f, name: v, latitude: null, longitude: null, placeId: "" }))}
                  onPlaceSelect={place => setAccommForm({ name: place.name, latitude: place.latitude, longitude: place.longitude, placeId: place.placeId })}
                  placeholder="Hotel or Airbnb name"
                  autoFocus
                  className="w-full text-[12px] px-2.5 rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-400"
                  style={{ height: 36 }}
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={handleSaveAccommodation}
                    disabled={accommSaving}
                    className="px-3 py-1 rounded-md bg-emerald-500 text-white text-[11px] font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50"
                  >
                    {accommSaving ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={() => setAccommEditing(false)}
                    className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : activeDayObj.accommodation_name ? (
              <div
                onClick={handleAccommCardClick}
                className="cursor-pointer transition-all"
                style={{
                  border: selectedAccomm ? "1.5px solid #854F0B" : "0.5px solid #e5e7eb",
                  borderRadius: 8,
                  padding: "10px 12px",
                  backgroundColor: "#fafaf9",
                }}
              >
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="1" y="7" width="14" height="7" rx="1" stroke="#854F0B" strokeWidth="1.2"/>
                    <path d="M4 7V5a4 4 0 018 0v2" stroke="#854F0B" strokeWidth="1.2" strokeLinecap="round"/>
                    <rect x="5" y="9" width="2.5" height="2.5" rx="0.5" fill="#854F0B" opacity="0.4"/>
                    <rect x="8.5" y="9" width="2.5" height="2.5" rx="0.5" fill="#854F0B" opacity="0.4"/>
                  </svg>
                  <span className="text-[12px] font-medium text-gray-900 flex-1 truncate">{activeDayObj.accommodation_name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setAccommForm({
                        name: activeDayObj.accommodation_name || "",
                        latitude: activeDayObj.accommodation_latitude || null,
                        longitude: activeDayObj.accommodation_longitude || null,
                        placeId: "",
                      });
                      setAccommEditing(true);
                    }}
                    className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M10 1.5l2.5 2.5L4.5 12H2v-2.5L10 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => {
                  setAccommForm({ name: "", latitude: null, longitude: null, placeId: "" });
                  setAccommEditing(true);
                }}
                className="flex items-center gap-2 cursor-pointer hover:border-emerald-400 transition-colors"
                style={{ border: "1.5px dashed #d1d5db", borderRadius: 8, padding: "10px 12px" }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="1" y="7" width="14" height="7" rx="1" stroke="#9ca3af" strokeWidth="1.2"/>
                  <path d="M4 7V5a4 4 0 018 0v2" stroke="#9ca3af" strokeWidth="1.2" strokeLinecap="round"/>
                  <rect x="5" y="9" width="2.5" height="2.5" rx="0.5" fill="#9ca3af" opacity="0.4"/>
                  <rect x="8.5" y="9" width="2.5" height="2.5" rx="0.5" fill="#9ca3af" opacity="0.4"/>
                </svg>
                <span className="text-[12px] text-gray-400">Add accommodation</span>
              </div>
            )}
          </div>
        )}

        {showAddStop && activeDayObj && (
          <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/60">
            <div className="text-[11px] font-medium text-gray-700 mb-1.5">New stop for Day {activeDayObj.day_number}</div>
            <div className="flex flex-col gap-1.5">
              <PlacesAutocomplete
                value={newStop.name}
                onChange={v => setNewStop(s => ({ ...s, name: v, latitude: null, longitude: null, placeId: "" }))}
                onPlaceSelect={place => setNewStop(s => ({ ...s, name: place.name, latitude: place.latitude, longitude: place.longitude, placeId: place.placeId }))}
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
                  onClick={() => { setShowAddStop(false); setNewStop({ name: "", description: "", start_time: "", duration_minutes: 30, cost_estimate: "", latitude: null, longitude: null, placeId: "" }); }}
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
          {getPromptChips(trip, days[activeDay] || null, currentDayStops).map(chip => (
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
        className="flex items-end gap-2 px-4 py-2.5 flex-shrink-0 border-t border-gray-100"
        style={{ borderTopWidth: 0.5 }}
      >
        <textarea
          ref={chatInputRef}
          value={chatInput}
          onChange={e => { setChatInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px"; }}
          placeholder={days.length === 0 ? "Describe your dream trip..." : "Ask about your trip..."}
          className="flex-1 text-[13px] px-4 py-2.5 border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-300 transition-colors"
          style={{ borderRadius: 20, resize: "none", overflow: "hidden", minHeight: 40, maxHeight: 150 }}
          rows={1}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
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
          <>
            <RegionalMap
              routeCities={routeCities}
              activeCityIndex={activeCityIndex}
              activeDayColor={dayColors[activeDay] || "#1D9E75"}
              onSelectDay={setActiveDay}
            />
            <div className="flex-shrink-0 bg-white" style={{ height: 15 }} />
          </>
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
                accommodation={activeDayObj?.accommodation_name && activeDayObj?.accommodation_latitude && activeDayObj?.accommodation_longitude ? {
                  name: activeDayObj.accommodation_name,
                  latitude: activeDayObj.accommodation_latitude,
                  longitude: activeDayObj.accommodation_longitude,
                  selected: selectedAccomm,
                } : null}
                onAccommodationClick={() => {
                  setSelectedAccomm(true);
                  setExpandedStop(null);
                  accommCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
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
      {/* Trip tour slideshow overlay */}
      {showTripTour && days.length > 0 && stops.length > 0 && (
        <TripTour
          tripId={tripId}
          trip={trip}
          onComplete={() => setShowTripTour(false)}
          generationComplete={true}
        />
      )}

      {/* Lightbox overlay */}
      {lightboxStop && lightboxPhotos.length > 0 && (
        <Lightbox
          photos={lightboxPhotos}
          index={lightboxIndex}
          onClose={closeLightbox}
          onPrev={lightboxPrev}
          onNext={lightboxNext}
        />
      )}

      <TripLayout
        trip={trip}
        days={days}
        activeDay={activeDay}
        dayColors={dayColors}
        members={members}
        stops={stops}
        onSelectDay={(d: number) => { setActiveDay(d); setSelectedAccomm(false); setAccommEditing(false); }}
        onAddDay={() => setShowAddDay(true)}
        trips={allTrips.map(item => item.trip)}
        onNewTrip={() => router.push("/")}
        onSwitchTrip={(id) => router.push(`/trip/${id}`)}
        currentProfile={currentProfile}
        renderLeftPanel={renderLeftPanel}
        renderChat={renderChat}
        renderRightPanel={renderRightPanel}
      />
    </>
  );
}
