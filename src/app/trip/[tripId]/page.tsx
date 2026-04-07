"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getMemberForTrip } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { Trip, TripMember, Day, Stop, Vote, Proposal } from "@/lib/database.types";

type ViewId = "itinerary" | "map" | "votes" | "ai" | "journal";

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

// --- Leaflet Map (dynamic, SSR-safe) ---
const TripMap = dynamic(() => import("./TripMap"), { ssr: false, loading: () => (
  <div className="flex-1 bg-gray-100 flex items-center justify-center">
    <p className="text-gray-400 text-xs">Loading map...</p>
  </div>
)});

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
  const [activeView, setActiveView] = useState<ViewId>("itinerary");
  const [activeDay, setActiveDay] = useState<number>(0);
  const [isSandbox, setIsSandbox] = useState(false);
  const [showAddDay, setShowAddDay] = useState(false);
  const [newDayTitle, setNewDayTitle] = useState("");
  const [addingDay, setAddingDay] = useState(false);
  const [showAddStop, setShowAddStop] = useState(false);
  const [newStop, setNewStop] = useState({ name: "", description: "", start_time: "", duration_minutes: 30, cost_estimate: "" });
  const [addingStop, setAddingStop] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [generatingItinerary, setGeneratingItinerary] = useState(false);
  const [itinerarySaved, setItinerarySaved] = useState(false);
  const [expandedStop, setExpandedStop] = useState<string | null>(null);
  const [pulsingStop, setPulsingStop] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [mapFitMode, setMapFitMode] = useState<"day" | "all">("day");
  // Lightbox state
  const [lightboxStop, setLightboxStop] = useState<Stop | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);

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
      "stops": [
        {
          "name": "Place name",
          "description": "Brief description of what to do here",
          "latitude": 42.1234,
          "longitude": -85.1234,
          "start_time": "09:00",
          "duration_minutes": 90,
          "cost_estimate": 25.00
        }
      ]
    }
  ]
}

Rules:
- Include 3-6 stops per day with realistic times starting around 8-9am
- Include real coordinates (latitude/longitude) for each stop
- Include cost estimates in USD (0 for free activities)
- Duration in minutes
- start_time in HH:MM 24-hour format
- Make stops family-friendly and varied (mix of activities, food, sightseeing)
- Include breakfast/lunch/dinner stops`;

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
      const fullContent: string = data.content || "";
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
    } catch {
      const errorMsgs = [...chatMessages, { role: "user" as const, content: text }, { role: "assistant" as const, content: "Sorry, something went wrong. Please try again." }];
      setChatMessages(errorMsgs);
      await saveChatMessages(errorMsgs);
    } finally {
      setGeneratingItinerary(false);
    }
  }

  async function saveItinerary(itineraryDays: Array<{ day_number: number; title: string; stops: Array<{ name: string; description?: string; latitude?: number; longitude?: number; start_time?: string; duration_minutes?: number; cost_estimate?: number }> }>) {
    const colors = generateDayColors(itineraryDays.length);
    const createdDays: Day[] = [];
    for (const dayData of itineraryDays) {
      const color = colors[(dayData.day_number - 1) % colors.length];
      const { data: dayRow } = await supabase.from("days").insert({
        trip_id: tripId, day_number: dayData.day_number, title: dayData.title, color,
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
        const { data: stopRow } = await supabase.from("stops").insert({
          trip_id: tripId, day_id: savedDay.id, name: stopData.name,
          description: stopData.description || null,
          latitude: stopData.latitude || null, longitude: stopData.longitude || null,
          start_time: stopData.start_time || null,
          duration_minutes: stopData.duration_minutes || 60,
          cost_estimate: stopData.cost_estimate ?? null,
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
    setMapFitMode("day");
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

  // When activeDay changes, set map to day fit mode
  useEffect(() => {
    setMapFitMode("day");
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
      if (tripRes.data) setTrip(tripRes.data as Trip);
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
  const isOrganizer = currentMember.role === "organizer";
  const currentDayStops = days[activeDay] ? stops.filter(s => s.day_id === days[activeDay].id) : [];
  const onlineMembers = members.filter(m => m.is_online);
  const stopsWithCoords = stops.filter(s => s.latitude && s.longitude);

  const lightboxPhotos = lightboxStop?.photos ? (lightboxStop.photos as { url: string; attribution?: string }[]) : [];

  return (
    <div className="h-screen flex bg-white overflow-hidden">
      {/* Lightbox overlay */}
      {lightboxStop && lightboxPhotos.length > 0 && (
        <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center" onClick={closeLightbox}>
          <div className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center" onClick={e => e.stopPropagation()}>
            <img src={lightboxPhotos[lightboxIndex]?.url} alt="" className="max-w-full max-h-[85vh] object-contain rounded-lg" />
            {/* Close button */}
            <button onClick={closeLightbox} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 text-lg">&times;</button>
            {/* Counter */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-3 py-1 rounded-full">
              {lightboxIndex + 1} / {lightboxPhotos.length}
            </div>
            {/* Prev/Next */}
            {lightboxPhotos.length > 1 && (
              <>
                <button onClick={lightboxPrev} className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 text-xl">&lsaquo;</button>
                <button onClick={lightboxNext} className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 text-xl">&rsaquo;</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div className="hidden md:flex w-[52px] flex-col items-center py-3 gap-1 border-r border-gray-100 bg-gray-50/50 flex-shrink-0">
        {([
          { id: "itinerary" as ViewId, label: "Itinerary", d: "M12 4a8 8 0 100 16 8 8 0 000-16zm0 4a4 4 0 110 8 4 4 0 010-8z" },
          { id: "map" as ViewId, label: "Map", d: "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z" },
          { id: "votes" as ViewId, label: "Votes", d: "M12 3l3 6 6.5.75-4.75 4.5 1.25 6.75L12 17.5 5.5 21l1.25-6.75L2 9.75 8.5 9z" },
          { id: "ai" as ViewId, label: "AI", d: "M3 4h18v14H3V4zm4 6h10m-10 4h6" },
          { id: "journal" as ViewId, label: "Journal", d: "M4 2h16v20H4V2zm4 5h8m-8 4h8m-8 4h4" },
        ] as const).map(item => (
          <button key={item.id} onClick={() => setActiveView(item.id)} title={item.label}
            className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${activeView === item.id ? "bg-emerald-100" : "hover:bg-gray-100"}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={activeView === item.id ? "#0F6E56" : "#888"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d={item.d} />
            </svg>
            {item.id === "votes" && proposals.length > 0 && <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">{proposals.length}</span>}
          </button>
        ))}
        <div className="flex-1" />
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold relative" style={{ backgroundColor: currentMember.avatar_color }} title={currentMember.display_name}>
          {currentMember.avatar_initial}
          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white" />
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 flex-shrink-0 z-10 bg-white">
          <div className="flex items-center gap-2.5">
            <button onClick={() => router.push("/")} className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center hover:bg-emerald-600 transition-colors flex-shrink-0" title="Home">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
              </svg>
            </button>
            <div>
              <h1 className="text-[15px] font-semibold text-gray-900">{trip.name}</h1>
              <p className="text-[11px] text-gray-500">{members.length} travelers · {stops.length} stops</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isOrganizer && <div className="flex gap-1">
              <button onClick={() => setIsSandbox(false)} className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${!isSandbox ? "bg-emerald-100 text-emerald-700" : "bg-white border border-gray-200 text-gray-500"}`}>Master</button>
              <button onClick={() => setIsSandbox(true)} className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${isSandbox ? "bg-blue-100 text-blue-700" : "bg-white border border-gray-200 text-gray-500"}`}>My sandbox</button>
            </div>}
            <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/trip/${tripId}/invite`); }} className="px-2.5 py-1 rounded-md text-[10px] border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">Share link</button>
          </div>
        </div>

        {/* Day tabs — full width across both panels */}
        <div className="flex gap-1.5 px-3 py-2.5 overflow-x-auto border-b border-gray-100 flex-shrink-0 items-center bg-white" style={{ zIndex: 5 }}>
          {days.map((day, idx) => {
            const color = getDayColor(idx);
            const isActive = idx === activeDay;
            return (
              <button key={day.id} onClick={() => setActiveDay(idx)}
                className="px-3 py-1.5 rounded-full text-[11px] whitespace-nowrap transition-all flex-shrink-0 font-medium"
                style={{
                  backgroundColor: color,
                  color: "white",
                  opacity: isActive ? 1 : 0.7,
                  fontWeight: isActive ? 700 : 500,
                  boxShadow: isActive ? "0 2px 8px rgba(0,0,0,0.15)" : "none",
                  transform: isActive ? "scale(1.05)" : "scale(1)",
                }}>
                Day {day.day_number}{day.title ? ` \u00b7 ${day.title}` : ""}
              </button>
            );
          })}
          {days.length === 0 && <span className="text-[11px] text-gray-400 py-1">No days yet — create your itinerary to get started</span>}
          <button onClick={() => setShowAddDay(true)} className="px-2.5 py-1.5 rounded-full text-[11px] whitespace-nowrap transition-colors flex-shrink-0 border border-dashed border-gray-300 text-gray-500 hover:border-emerald-400 hover:text-emerald-600">+ Add Day</button>
        </div>

        {showAddDay && (
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/50 flex-shrink-0">
            <div className="flex gap-2 items-center">
              <input type="text" value={newDayTitle} onChange={e => setNewDayTitle(e.target.value)} placeholder="Day title (e.g. Traverse City)" autoFocus
                className="flex-1 text-[12px] px-3 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-400"
                onKeyDown={e => e.key === "Enter" && handleAddDay()} />
              <button onClick={handleAddDay} disabled={addingDay || !newDayTitle.trim()}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[11px] font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {addingDay ? "Adding..." : "Add"}
              </button>
              <button onClick={() => { setShowAddDay(false); setNewDayTitle(""); }} className="px-2 py-1.5 rounded-lg text-gray-400 text-[11px] hover:text-gray-600 transition-colors">Cancel</button>
            </div>
          </div>
        )}

        <div className="flex flex-1 min-h-0">
          {/* Left panel */}
          <div className="w-full md:w-[55%] md:border-r border-gray-100 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {days.length === 0 ? (
                /* AI Chat — empty trip experience */
                <div className="flex flex-col h-full">
                  <div className="flex-1 overflow-y-auto">
                    {chatMessages.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-8 px-4">
                        <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="14" rx="3" /><path d="M7 10h10m-10 4h6" />
                          </svg>
                        </div>
                        <h2 className="text-[15px] font-semibold text-gray-900 mb-1">Plan your trip with Claude</h2>
                        <p className="text-[12px] text-gray-500 text-center max-w-[300px] mb-5 leading-relaxed">
                          Tell me about your trip — where are you going, how long, and what does your family enjoy?
                        </p>
                        <div className="flex flex-wrap gap-2 justify-center max-w-[380px]">
                          {["Plan 9 days in Italy with kids", "Weekend trip to Northern Michigan", "5-day beach vacation in Florida", "Family road trip through national parks"].map(chip => (
                            <button key={chip} onClick={() => handleChatSend(chip)}
                              className="px-3 py-1.5 rounded-full text-[11px] border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors">
                              {chip}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {chatMessages.map((msg, idx) => (
                      <div key={idx} className={`mb-3 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap ${
                          msg.role === "user" ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-800"
                        }`}>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    {generatingItinerary && (
                      <div className="mb-3 flex justify-start">
                        <div className="bg-gray-100 rounded-xl px-3 py-2 text-[12px] text-gray-500 flex items-center gap-2">
                          <div className="flex gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                          </div>
                          Planning your itinerary...
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-gray-100 mt-auto">
                    <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                      placeholder="Describe your dream trip..."
                      className="flex-1 text-[12px] px-3 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-400"
                      onKeyDown={e => e.key === "Enter" && handleChatSend()}
                      disabled={generatingItinerary} />
                    <button onClick={() => handleChatSend()} disabled={generatingItinerary || !chatInput.trim()}
                      className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-[11px] font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                      {generatingItinerary ? "Planning..." : "Send"}
                    </button>
                  </div>
                </div>
              ) : (
                /* Normal itinerary view */
                <>
                  {itinerarySaved && (
                    <div className="mb-2 px-3 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center gap-2">
                      <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-[12px] text-emerald-700">Your itinerary is ready! Check out your days above.</span>
                      <button onClick={() => setItinerarySaved(false)} className="ml-auto text-emerald-400 hover:text-emerald-600 text-[14px] leading-none">&times;</button>
                    </div>
                  )}
                  {currentDayStops.length === 0 && !itinerarySaved && (
                    <div className="text-center py-10"><p className="text-gray-400 text-sm mb-2">No stops on this day yet</p></div>
                  )}
                  {currentDayStops.map((stop, idx) => {
                    const stopVotes = votes.filter(v => v.stop_id === stop.id);
                    const upVotes = stopVotes.filter(v => v.vote === 1);
                    const isExpanded = expandedStop === stop.id;
                    const activeDayColor = getDayColor(activeDay);
                    const badge = getStopBadge(stop);
                    const photos = stop.photos && Array.isArray(stop.photos) ? (stop.photos as { url: string; attribution?: string }[]) : [];
                    return (
                      <div key={stop.id} ref={el => { if (el) stopRefs.current.set(stop.id, el); }}>
                        {idx > 0 && stop.transit_note && (
                          <div className="flex items-center gap-2 py-1 px-2">
                            <div className="flex-1 h-px bg-gray-100" /><span className="text-[10px] text-gray-400">{stop.transit_note}</span><div className="flex-1 h-px bg-gray-100" />
                          </div>
                        )}
                        <div
                          className={`bg-white rounded-lg border transition-colors mb-1.5 overflow-hidden cursor-pointer ${isExpanded ? "border-gray-300 shadow-sm" : "border-gray-100 hover:border-gray-200"}`}
                          onClick={() => handleStopCardClick(stop)}
                        >
                          {/* Collapsed header */}
                          <div className="flex items-center gap-2 px-3 py-2.5">
                            <span className="text-gray-300 text-[10px] drag-handle">&#x2630;</span>
                            <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: activeDayColor }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-[13px] text-gray-900 truncate">{stop.name}</span>
                                {badge && (
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${badge.bg} ${badge.text} flex-shrink-0`}>{badge.label}</span>
                                )}
                              </div>
                              <div className="text-[10px] text-gray-500">
                                {stop.start_time ? stop.start_time.slice(0, 5) : "TBD"} · {stop.duration_minutes} min
                                {stop.cost_estimate != null && Number(stop.cost_estimate) > 0 && ` · $${Number(stop.cost_estimate).toFixed(0)}`}
                              </div>
                            </div>
                            <div className="flex gap-0.5 flex-shrink-0">
                              {members.map(m => {
                                const hasVoted = upVotes.some(v => v.member_id === m.id);
                                return <div key={m.id} className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[7px] font-semibold"
                                  style={hasVoted ? { backgroundColor: m.avatar_color, color: "white" } : { border: "1.5px dashed #d1d1d1", color: "#999" }}>{m.avatar_initial}</div>;
                              })}
                            </div>
                            <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>

                          {/* Expanded content */}
                          {isExpanded && (
                            <div className="px-3 pb-3 border-t border-gray-50" onClick={e => e.stopPropagation()}>
                              {stop.description && (
                                <p className="text-[12px] text-gray-600 leading-relaxed mt-2 mb-2">{stop.description}</p>
                              )}
                              {/* Details row */}
                              <div className="flex flex-wrap gap-3 text-[11px] text-gray-500 mb-3">
                                {stop.start_time && (
                                  <span className="flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="1.5"/><path strokeLinecap="round" strokeWidth="1.5" d="M12 6v6l4 2"/></svg>
                                    {stop.start_time.slice(0, 5)}
                                  </span>
                                )}
                                <span className="flex items-center gap-1">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeWidth="1.5" d="M12 8v4m0 0v4m0-4h4m-4 0H8"/></svg>
                                  {stop.duration_minutes} min
                                </span>
                                {stop.cost_estimate != null && (
                                  <span className="flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeWidth="1.5" d="M12 1v22m5-18H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H7"/></svg>
                                    ${Number(stop.cost_estimate).toFixed(2)}
                                  </span>
                                )}
                                {stop.latitude && stop.longitude && (
                                  <span className="flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeWidth="1.5" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeWidth="1.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                                    {stop.latitude.toFixed(4)}, {stop.longitude.toFixed(4)}
                                  </span>
                                )}
                              </div>
                              {/* Photo gallery — horizontal scroll */}
                              {photos.length > 0 ? (
                                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                                  {photos.map((photo, pIdx) => (
                                    <div key={pIdx} className="flex-shrink-0 w-36 h-24 rounded-lg overflow-hidden cursor-pointer border border-gray-200 hover:border-gray-400 transition-colors"
                                      onClick={() => openLightbox(stop, pIdx)}>
                                      <img src={photo.url} alt={`${stop.name} ${pIdx + 1}`} className="w-full h-full object-cover" />
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="w-full h-20 rounded-lg bg-gray-100 flex items-center justify-center">
                                  <div className="text-center">
                                    <svg className="w-5 h-5 text-gray-300 mx-auto mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    <p className="text-[9px] text-gray-400">No photos yet</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {!showAddStop && (
                    <button onClick={() => setShowAddStop(true)} className="w-full border border-dashed border-gray-200 rounded-lg py-2 text-center cursor-pointer hover:border-emerald-400 hover:text-emerald-600 transition-colors mt-1">
                      <span className="text-gray-400 text-[11px] hover:text-emerald-600">+ Add stop</span>
                    </button>
                  )}
                  {showAddStop && days[activeDay] && (
                    <div className="border border-gray-200 rounded-lg p-3 mt-1 bg-gray-50/50">
                      <div className="text-[12px] font-medium text-gray-700 mb-2">New stop for Day {days[activeDay].day_number}</div>
                      <div className="space-y-2">
                        <input type="text" value={newStop.name} onChange={e => setNewStop(s => ({ ...s, name: e.target.value }))} placeholder="Stop name *" autoFocus
                          className="w-full text-[12px] px-3 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-400" />
                        <input type="text" value={newStop.description} onChange={e => setNewStop(s => ({ ...s, description: e.target.value }))} placeholder="Description (optional)"
                          className="w-full text-[12px] px-3 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-400" />
                        <div className="flex gap-2">
                          <input type="time" value={newStop.start_time} onChange={e => setNewStop(s => ({ ...s, start_time: e.target.value }))}
                            className="flex-1 text-[12px] px-3 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-400" />
                          <div className="flex items-center gap-1 flex-1">
                            <input type="number" value={newStop.duration_minutes} onChange={e => setNewStop(s => ({ ...s, duration_minutes: parseInt(e.target.value) || 0 }))} min="0"
                              className="w-full text-[12px] px-3 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-400" />
                            <span className="text-[10px] text-gray-400 whitespace-nowrap">min</span>
                          </div>
                          <div className="flex items-center gap-1 flex-1">
                            <span className="text-[10px] text-gray-400">$</span>
                            <input type="number" value={newStop.cost_estimate} onChange={e => setNewStop(s => ({ ...s, cost_estimate: e.target.value }))} placeholder="Cost" min="0" step="0.01"
                              className="w-full text-[12px] px-3 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-400" />
                          </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button onClick={handleAddStop} disabled={addingStop || !newStop.name.trim()}
                            className="px-4 py-1.5 rounded-lg bg-emerald-500 text-white text-[11px] font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                            {addingStop ? "Adding..." : "Add Stop"}
                          </button>
                          <button onClick={() => { setShowAddStop(false); setNewStop({ name: "", description: "", start_time: "", duration_minutes: 30, cost_estimate: "" }); }}
                            className="px-3 py-1.5 rounded-lg text-gray-400 text-[11px] hover:text-gray-600 transition-colors">Cancel</button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-1 px-3 py-2 border-t border-gray-100 flex-shrink-0">
              {members.map(m => (
                <div key={m.id} className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-semibold relative" style={{ backgroundColor: m.avatar_color }} title={m.display_name}>
                  {m.avatar_initial}
                  {m.is_online && <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-white" />}
                </div>
              ))}
              <span className="text-[10px] text-gray-400 ml-2">{onlineMembers.length} online</span>
            </div>
          </div>

          {/* Right panel — Map + Claude */}
          <div className="hidden md:flex md:w-[45%] flex-col overflow-hidden">
            <div className="flex-1 relative">
              {stopsWithCoords.length > 0 ? (
                <>
                  <TripMap
                    stops={stops}
                    days={days}
                    activeDay={activeDay}
                    dayColors={dayColors}
                    pulsingStop={pulsingStop}
                    selectedStop={expandedStop}
                    fitMode={mapFitMode}
                    onPinClick={handleMapPinClick}
                  />
                  {/* Full map button */}
                  <button
                    onClick={() => setMapFitMode("all")}
                    className="absolute top-3 right-3 z-[1000] px-2.5 py-1.5 rounded-lg bg-white/90 backdrop-blur-sm border border-gray-200 text-[11px] font-medium text-gray-700 hover:bg-white hover:border-gray-300 transition-colors shadow-sm"
                  >
                    Full map
                  </button>
                </>
              ) : (
                <div className="flex-1 h-full bg-gray-100 flex items-center justify-center">
                  <div className="text-center">
                    <svg className="w-10 h-10 text-gray-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z" /></svg>
                    <p className="text-gray-400 text-xs">Add stops with coordinates to see the map</p>
                  </div>
                </div>
              )}
            </div>
            <div className="border-t border-gray-100 bg-white p-3 flex-shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2"><rect x="3" y="4" width="18" height="14" rx="3" /><path d="M7 10h10" strokeLinecap="round" /></svg>
                </div>
                <span className="text-[12px] font-medium text-gray-900">Claude</span>
                <span className="text-[10px] text-emerald-600">· Ready</span>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5 text-[11px] text-gray-500 leading-relaxed mb-2">Ask me anything about your trip — restaurant picks, route optimization, or activity ideas for the kids.</div>
              <div className="flex gap-2">
                <input type="text" placeholder="Ask about your trip..." className="flex-1 text-[11px] px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-emerald-200" />
                <button className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 text-[11px] font-medium hover:bg-emerald-200 transition-colors">Send</button>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile bottom tabs */}
        <div className="md:hidden flex border-t border-gray-100 bg-white flex-shrink-0 safe-area-bottom">
          {(["Plan", "Map", "Claude", "Votes", "Journal"] as const).map((label, i) => {
            const ids: ViewId[] = ["itinerary", "map", "ai", "votes", "journal"];
            return <button key={label} onClick={() => setActiveView(ids[i])} className={`flex-1 py-2 text-[10px] font-medium transition-colors ${activeView === ids[i] ? "text-emerald-600" : "text-gray-400"}`}>{label}</button>;
          })}
        </div>
      </div>
    </div>
  );
}
