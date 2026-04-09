"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getMemberForTrip } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { askClaude, executeToolCall } from "@/lib/claude";
import ReactMarkdown from "react-markdown";
import type { Trip, TripMember, Day, Stop } from "@/lib/database.types";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const VibeMap = dynamic(() => import("./VibeMap"), { ssr: false, loading: () => <div className="w-full h-full bg-gray-100 rounded-lg" /> });

// Extended day type for vibe columns
type VibeDay = Day & { vibe_status?: string | null; reasoning?: string | null };
type VibeTrip = Trip & { trip_summary?: string | null };

// --- Day color gradient ---
function generateDayColors(count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return ["hsl(145, 55%, 33%)"];
  const hueStops = [145, 165, 180, 195, 220, 250, 280, 310];
  const satStops = [55, 60, 55, 50, 55, 50, 50, 45];
  const litStops = [33, 38, 40, 42, 42, 40, 38, 38];
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const idx = t * (hueStops.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, hueStops.length - 1);
    const frac = idx - lo;
    colors.push(`hsl(${Math.round(hueStops[lo] + (hueStops[hi] - hueStops[lo]) * frac)}, ${Math.round(satStops[lo] + (satStops[hi] - satStops[lo]) * frac)}%, ${Math.round(litStops[lo] + (litStops[hi] - litStops[lo]) * frac)}%)`);
  }
  return colors;
}

function stopTypeColor(t: string): string {
  return t === "food" ? "#A32D2D" : t === "visit" ? "#185FA5" : t === "walking" || t === "walk_by" ? "#0F6E56" : t === "experience" || t === "guided_tour" ? "#854F0B" : t === "transit" ? "#6B7280" : "#185FA5";
}
function stopTypeLabel(t: string): string {
  return t === "food" ? "Food" : t === "visit" ? "Visit" : t === "walking" || t === "walk_by" ? "Walking" : t === "experience" ? "Experience" : t === "guided_tour" ? "Tour" : t === "transit" ? "Transit" : t;
}
function getTimePeriod(startTime: string | null, sortOrder: number): string {
  if (!startTime) return sortOrder <= 1 ? "Morning" : sortOrder <= 3 ? "Mid-day" : sortOrder <= 5 ? "Afternoon" : "Evening";
  const m = startTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return "Morning";
  let h = parseInt(m[1]);
  if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
  if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
  return h < 12 ? "Morning" : h < 14 ? "Mid-day" : h < 17 ? "Afternoon" : "Evening";
}
function isValidCoord(s: Stop): boolean {
  return s.latitude != null && s.longitude != null && !(s.latitude === 0 && s.longitude === 0);
}

// --- Sortable stop card ---
function SortableStopCard({ stop, isBench, isHighlighted, onClick }: { stop: Stop; isBench?: boolean; isHighlighted?: boolean; onClick?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : isBench ? 0.6 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="group">
      <StopCard stop={stop} dragListeners={listeners} dragAttributes={attributes} isBench={isBench} isHighlighted={isHighlighted} onClick={onClick} />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function StopCard({ stop, dragListeners, dragAttributes, isBench, isHighlighted, onClick }: {
  stop: Stop; dragListeners?: any; dragAttributes?: any; isBench?: boolean; isHighlighted?: boolean; onClick?: () => void;
}) {
  const color = stopTypeColor(stop.stop_type);
  const hasValidLocation = isValidCoord(stop);
  return (
    <div
      onClick={onClick}
      className={`rounded-lg border bg-white overflow-hidden transition-all ${isBench ? "hover:opacity-100" : ""} ${isHighlighted ? "ring-2 ring-emerald-400 shadow-md" : ""} ${onClick ? "cursor-pointer" : ""}`}
      style={{ borderColor: isHighlighted ? "#5DCAA5" : "#e5e7eb" }}
    >
      <div className="h-1.5" style={{ backgroundColor: color }} />
      <div className="p-3 flex gap-2">
        <div className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 pt-0.5" {...(dragListeners || {})} {...(dragAttributes || {})}>
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
            <circle cx="2" cy="2" r="1.5" /><circle cx="8" cy="2" r="1.5" /><circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="2" cy="14" r="1.5" /><circle cx="8" cy="14" r="1.5" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[13px] font-medium text-gray-900 truncate">{stop.name}</span>
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: `${color}15`, color }}>{stopTypeLabel(stop.stop_type)}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1">
            <span>{stop.duration_minutes} min</span>
            {stop.cost_estimate != null && stop.cost_estimate > 0 && <span>· {stop.cost_currency}{stop.cost_estimate}</span>}
            {!hasValidLocation && <span className="text-orange-500">· Location missing</span>}
          </div>
          {stop.description && <p className="text-[11px] text-gray-600 leading-relaxed line-clamp-2">{stop.description}</p>}
        </div>
      </div>
    </div>
  );
}

function DragOverlayCard({ stop }: { stop: Stop }) {
  return (
    <div className="w-72 shadow-xl rounded-lg border border-gray-200 bg-white overflow-hidden opacity-90">
      <div className="h-1.5" style={{ backgroundColor: stopTypeColor(stop.stop_type) }} />
      <div className="p-3"><span className="text-[13px] font-medium text-gray-900">{stop.name}</span></div>
    </div>
  );
}

// Skeleton loader for bench
function BenchSkeleton() {
  return (
    <div className="flex flex-col gap-2 animate-pulse">
      {[1, 2, 3].map(i => (
        <div key={i} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="h-1.5 bg-gray-200" />
          <div className="p-3">
            <div className="h-3 bg-gray-200 rounded w-3/4 mb-2" />
            <div className="h-2.5 bg-gray-100 rounded w-1/2 mb-1" />
            <div className="h-2.5 bg-gray-100 rounded w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Main vibe planning page ---
export default function VibePlanningPage() {
  const router = useRouter();
  const params = useParams();
  const tripId = params.tripId as string;

  const [loading, setLoading] = useState(true);
  const [currentMember, setCurrentMember] = useState<TripMember | null>(null);
  const [trip, setTrip] = useState<VibeTrip | null>(null);
  const [days, setDays] = useState<VibeDay[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [activeDay, setActiveDay] = useState(0);
  const [selectedVibe, setSelectedVibe] = useState<string | null>(null);
  const [benchStopIds, setBenchStopIds] = useState<Set<string>>(new Set());
  const [pinnedStopIds, setPinnedStopIds] = useState<Set<string>>(new Set());
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [vibeLoading, setVibeLoading] = useState(false);
  const [benchLoading, setBenchLoading] = useState(false);
  const [highlightedStopId, setHighlightedStopId] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [benchAlternatives, setBenchAlternatives] = useState<Stop[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const stopCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const dayColors = useMemo(() => generateDayColors(days.length), [days.length]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // --- Load data ---
  useEffect(() => {
    async function load() {
      const member = await getMemberForTrip(tripId);
      if (!member) { router.replace(`/trip/${tripId}/invite`); return; }
      setCurrentMember(member);
      const [tripRes, daysRes, stopsRes] = await Promise.all([
        supabase.from("trips").select("*").eq("id", tripId).maybeSingle(),
        supabase.from("days").select("*").eq("trip_id", tripId).order("day_number"),
        supabase.from("stops").select("*").eq("trip_id", tripId).is("version_owner", null).order("sort_order"),
      ]);
      if (tripRes.data) {
        setTrip(tripRes.data as VibeTrip);
        // Show summary overlay on first load if exists
        if ((tripRes.data as VibeTrip).trip_summary) setShowSummary(true);
      }
      if (daysRes.data) setDays(daysRes.data as VibeDay[]);
      if (stopsRes.data) setStops(stopsRes.data as Stop[]);
      setLoading(false);
    }
    load();
  }, [tripId, router]);

  // --- Auto-assign vibe_status after load ---
  useEffect(() => {
    if (days.length === 0 || !trip) return;
    const needsAssignment = days.some(d => !d.vibe_status);
    if (!needsAssignment) return;
    async function assignVibeStatuses() {
      for (const day of days) {
        if (day.vibe_status) continue;
        const dayStops = stops.filter(s => s.day_id === day.id);
        const hasTransit = dayStops.some(s => s.stop_type === "transit");
        const hasIconicStops = dayStops.length <= 4;
        const isCurated = hasTransit || hasIconicStops || day.day_number === 1 || day.day_number === days.length;
        await supabase.from("days").update({ vibe_status: isCurated ? "curated" : "collab" }).eq("id", day.id);
      }
      const { data } = await supabase.from("days").select("*").eq("trip_id", tripId).order("day_number");
      if (data) setDays(data as VibeDay[]);
    }
    assignVibeStatuses();
  }, [days.length, stops.length, trip, tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Generate trip summary if missing ---
  useEffect(() => {
    if (!trip || trip.trip_summary || days.length === 0) return;
    async function genSummary() {
      const result = await askClaude({
        tripId,
        messages: [{ role: "user", content: "Write a single exciting paragraph (3-4 sentences) summarizing this entire trip — the destination, highlights, and what makes it special for this group. Do NOT use tool calls, just respond with text." }],
        systemContext: "Generate a trip summary blurb. Text only, no tools.",
      });
      if (result.text) {
        await supabase.from("trips").update({ trip_summary: result.text }).eq("id", tripId);
        setTrip(prev => prev ? { ...prev, trip_summary: result.text } : prev);
        setShowSummary(true);
      }
    }
    genSummary();
  }, [trip?.trip_summary, days.length, tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, isThinking]);

  // --- Derived state ---
  const currentDay = days[activeDay] as VibeDay | undefined;
  const currentDayStops = useMemo(() =>
    currentDay ? stops.filter(s => s.day_id === currentDay.id).sort((a, b) => a.sort_order - b.sort_order) : [],
    [currentDay, stops]
  );
  const picksStops = useMemo(() =>
    currentDayStops.filter(s => s.stop_type !== "transit" && !benchStopIds.has(s.id)),
    [currentDayStops, benchStopIds]
  );
  const benchStops = useMemo(() => {
    const fromDay = currentDayStops.filter(s => s.stop_type !== "transit" && benchStopIds.has(s.id));
    return [...fromDay, ...benchAlternatives];
  }, [currentDayStops, benchStopIds, benchAlternatives]);

  const lockedCount = days.filter(d => d.vibe_status === "locked").length;
  const allLocked = days.length > 0 && lockedCount === days.length;

  const isCurated = currentDay?.vibe_status === "curated";
  const isCollab = currentDay?.vibe_status === "collab";
  const isLocked = currentDay?.vibe_status === "locked";
  const showBench = isCollab;

  // --- Dynamic vibe buttons ---
  const vibeButtons = useMemo(() => {
    if (!trip) return [];
    const buttons = ["Take it easy", "Deep culture", "Food-focused", "Outdoors", "Sleep in"];
    const gt = (trip.group_type || "").toLowerCase();
    const gd = (trip.group_detail || "").toLowerCase();
    const int = (trip.interests || "").toLowerCase();
    const notes = (trip.extra_notes || "").toLowerCase();
    const dates = (trip.travel_dates || "").toLowerCase();
    if (gt === "family" && gd.match(/kid|child|toddler|teen|baby/)) buttons.push("Kid energy burn");
    if (notes.match(/dog|pet/)) buttons.push("Dog-friendly");
    if (gt === "couple" || gd.match(/^2\s*(adult|people)/)) buttons.push("Romantic");
    if (int.match(/food|cuisine|culinary/)) buttons.push("Culinary deep dive");
    if (dates.match(/jun|jul|aug|june|july|august|summer/)) buttons.push("Beat the heat");
    buttons.push("Hidden gems");
    return buttons;
  }, [trip]);

  // --- Anchors ---
  const anchors = useMemo(() => {
    if (!isCurated) return [];
    return [...picksStops].filter(s => s.stop_type !== "transit" && s.stop_type !== "food")
      .sort((a, b) => b.duration_minutes - a.duration_minutes).slice(0, 3);
  }, [isCurated, picksStops]);

  // --- Group picks by time ---
  const groupedPicks = useMemo(() => {
    const groups: { period: string; stops: Stop[] }[] = [];
    const periodOrder = ["Morning", "Mid-day", "Afternoon", "Evening"];
    const byPeriod = new Map<string, Stop[]>();
    for (const s of picksStops) {
      const p = getTimePeriod(s.start_time, s.sort_order);
      if (!byPeriod.has(p)) byPeriod.set(p, []);
      byPeriod.get(p)!.push(s);
    }
    for (const p of periodOrder) {
      const ss = byPeriod.get(p);
      if (ss && ss.length > 0) groups.push({ period: p, stops: ss });
    }
    return groups;
  }, [picksStops]);

  // --- Reasoning text ---
  const reasoningText = useMemo(() => {
    if (!currentDay) return null;
    if (currentDay.reasoning) return currentDay.reasoning;
    if (isCollab) return "This day is wide open — tell me what you\u2019re in the mood for.";
    return null;
  }, [currentDay, isCollab]);

  // --- Actions ---
  async function reloadDays() {
    const { data } = await supabase.from("days").select("*").eq("trip_id", tripId).order("day_number");
    if (data) setDays(data as VibeDay[]);
    return data as VibeDay[] | null;
  }
  async function reloadStops() {
    const { data } = await supabase.from("stops").select("*").eq("trip_id", tripId).is("version_owner", null).order("sort_order");
    if (data) setStops(data as Stop[]);
  }

  async function lockDay(dayId: string) {
    await supabase.from("days").update({ vibe_status: "locked" }).eq("id", dayId);
    const updated = await reloadDays();
    if (updated) {
      const nextUnlocked = updated.findIndex((d, i) => i > activeDay && d.vibe_status !== "locked");
      if (nextUnlocked >= 0) { setActiveDay(nextUnlocked); setBenchStopIds(new Set()); setSelectedVibe(null); setBenchAlternatives([]); }
    }
  }

  async function unlockDay(dayId: string) {
    await supabase.from("days").update({ vibe_status: "collab" }).eq("id", dayId);
    await reloadDays();
    fetchBenchAlternatives();
  }

  async function vibeThisDay(dayId: string) {
    await supabase.from("days").update({ vibe_status: "collab" }).eq("id", dayId);
    await reloadDays();
    fetchBenchAlternatives();
  }

  async function fetchBenchAlternatives() {
    if (!currentDay) return;
    setBenchLoading(true);
    setBenchAlternatives([]);
    const result = await askClaude({
      tripId,
      messages: [{ role: "user", content: `Suggest 3-5 alternative stops for Day ${currentDay.day_number} (${currentDay.title || ""}), including at least one restaurant/food option and one activity. Return them as a JSON array in a code block: [{"name":"...","description":"...","stop_type":"food|visit|walking|experience","duration_minutes":60,"latitude":0,"longitude":0}]. Do NOT use tool calls.` }],
      systemContext: `Generate bench alternatives for Day ${currentDay.day_number} (day_id: ${currentDay.id}). Respond with a JSON array of stop suggestions in a \`\`\`json code block. Include at least one food and one activity option. No tool calls.`,
    });
    // Parse alternatives from response
    const jsonMatch = result.text.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const alts = JSON.parse(jsonMatch[1]);
        if (Array.isArray(alts)) {
          const benchItems: Stop[] = alts.map((a: Record<string, unknown>, i: number) => ({
            id: `bench-${currentDay.id}-${i}-${Date.now()}`,
            trip_id: tripId,
            day_id: currentDay.id,
            name: (a.name as string) || "Alternative",
            description: (a.description as string) || null,
            stop_type: (a.stop_type as string) || "visit",
            duration_minutes: (a.duration_minutes as number) || 60,
            latitude: (a.latitude as number) || null,
            longitude: (a.longitude as number) || null,
            sort_order: 99 + i,
            cost_estimate: null, cost_currency: "USD", notes: null, transit_note: null,
            transit_minutes: null, tags: [], photos: [], google_place_id: null,
            start_time: null, version_owner: null, master_stop_id: null,
            created_by: null, created_at: "", updated_at: "",
          } as Stop));
          setBenchAlternatives(benchItems);
        }
      } catch { /* parse failed */ }
    }
    setBenchLoading(false);
  }

  async function handleVibeSelect(vibe: string) {
    if (!currentDay) return;
    setSelectedVibe(vibe);
    setVibeLoading(true);
    const result = await askClaude({
      tripId,
      messages: [{ role: "user", content: `Reshape Day ${currentDay.day_number} (${currentDay.title || ""}) for a "${vibe}" vibe. Use tools to swap, add, or remove stops. Keep any pinned stops.` }],
      systemContext: `The user selected the "${vibe}" vibe for Day ${currentDay.day_number}. Only modify stops on day_id: ${currentDay.id}.`,
    });
    for (const tc of result.toolCalls) await executeToolCall(tripId, tc);
    await reloadStops();
    if (result.text) setChatMessages(prev => [...prev, { role: "assistant", content: result.text }]);
    setVibeLoading(false);
  }

  async function handleRefresh() {
    if (!currentDay) return;
    setVibeLoading(true);
    const vibeNote = selectedVibe ? `Keep the "${selectedVibe}" vibe but show different options.` : "Show different options for this day.";
    const result = await askClaude({
      tripId,
      messages: [{ role: "user", content: `Show me different options for Day ${currentDay.day_number}. ${vibeNote}` }],
      systemContext: `Refresh Day ${currentDay.day_number} (day_id: ${currentDay.id}) with new stop suggestions. Use tools.`,
    });
    for (const tc of result.toolCalls) await executeToolCall(tripId, tc);
    await reloadStops();
    if (result.text) setChatMessages(prev => [...prev, { role: "assistant", content: result.text }]);
    setVibeLoading(false);
  }

  async function handleChatSend(message?: string) {
    const text = message || chatInput.trim();
    if (!text || isThinking) return;
    const userMsg = { role: "user" as const, content: text };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setIsThinking(true);
    const dayContext = currentDay ? `Viewing Day ${currentDay.day_number}${currentDay.title ? ` — ${currentDay.title}` : ""}. ${selectedVibe ? `Vibe: "${selectedVibe}".` : ""}` : undefined;
    const result = await askClaude({ tripId, messages: [...chatMessages, userMsg].slice(-20), systemContext: dayContext });
    for (const tc of result.toolCalls) await executeToolCall(tripId, tc);
    if (result.toolCalls.length > 0) await reloadStops();
    if (result.text) setChatMessages(prev => [...prev, { role: "assistant", content: result.text }]);
    setIsThinking(false);
  }

  // --- Drag and drop ---
  function handleDragStart(event: DragStartEvent) { setDragActiveId(event.active.id as string); }
  function handleDragEnd(event: DragEndEvent) {
    setDragActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    const isFromBench = benchStopIds.has(activeId) || benchAlternatives.some(s => s.id === activeId);
    const isOverBench = overId === "bench-droppable" || benchStopIds.has(overId) || benchAlternatives.some(s => s.id === overId);
    if (isFromBench && !isOverBench) {
      // Promote from bench to picks
      const benchAlt = benchAlternatives.find(s => s.id === activeId);
      if (benchAlt && currentDay) {
        // Insert as real stop in Supabase
        (async () => {
          await supabase.from("stops").insert({
            trip_id: tripId, day_id: currentDay.id, name: benchAlt.name,
            description: benchAlt.description, stop_type: benchAlt.stop_type,
            duration_minutes: benchAlt.duration_minutes, latitude: benchAlt.latitude,
            longitude: benchAlt.longitude, sort_order: picksStops.length,
          });
          setBenchAlternatives(prev => prev.filter(s => s.id !== activeId));
          await reloadStops();
        })();
      } else {
        setBenchStopIds(prev => { const n = new Set(prev); n.delete(activeId); return n; });
        setPinnedStopIds(prev => new Set(prev).add(activeId));
      }
    } else if (!isFromBench && isOverBench) {
      setBenchStopIds(prev => new Set(prev).add(activeId));
      setPinnedStopIds(prev => { const n = new Set(prev); n.delete(activeId); return n; });
    }
  }

  const draggedStop = dragActiveId ? [...stops, ...benchAlternatives].find(s => s.id === dragActiveId) : null;

  // --- Map/card interaction ---
  function handlePinClick(stopId: string) {
    setHighlightedStopId(stopId);
    const el = stopCardRefs.current.get(stopId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function handleCardClick(stopId: string) {
    setHighlightedStopId(prev => prev === stopId ? null : stopId);
  }

  // --- Loading ---
  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <div className="w-10 h-10 rounded-full border-[3px] border-gray-200 border-t-purple-500 animate-spin mx-auto mb-4" />
        <p className="text-gray-400 text-sm">Loading vibe planning...</p>
      </div>
    </div>
  );

  if (!trip || !currentMember) return null;

  // --- All days locked → completion ---
  if (allLocked) return (
    <div className="h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-[18px] font-medium text-gray-900 mb-1">{trip.name}</h1>
        <h2 className="text-[22px] font-semibold text-gray-900 mb-2">Your trip is set!</h2>
        <p className="text-[14px] text-gray-500 mb-8">
          {days.length} days, {stops.filter(s => s.stop_type !== "transit").length} stops across{" "}
          {new Set(days.map(d => d.title).filter(Boolean)).size} cities
        </p>
        <button onClick={() => router.push(`/trip/${tripId}`)} className="px-6 py-3 rounded-lg text-white font-medium text-[14px]" style={{ backgroundColor: "#1D9E75" }}>
          View your itinerary
        </button>
      </div>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      {/* Trip summary overlay (#9) */}
      {showSummary && trip.trip_summary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl max-w-lg mx-4 p-8 shadow-2xl">
            <h2 className="text-[20px] font-semibold text-gray-900 mb-4">{trip.name}</h2>
            <p className="text-[14px] text-gray-700 leading-relaxed mb-6">{trip.trip_summary}</p>
            <button onClick={() => setShowSummary(false)} className="w-full py-3 rounded-lg text-white font-medium text-[14px]" style={{ backgroundColor: "#1D9E75" }}>
              Let&apos;s dive in
            </button>
          </div>
        </div>
      )}

      {/* Header with back link (#18) */}
      <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push(`/trip/${tripId}`)} className="text-[13px] text-gray-500 hover:text-gray-700 flex items-center gap-1 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Back to dashboard
          </button>
          <h1 className="text-[18px] font-semibold text-gray-900">Vibe planning</h1>
        </div>
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#5DCAA5" }} /><span className="text-[10px] text-gray-500">Curated</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#AFA9EC" }} /><span className="text-[10px] text-gray-500">Collab</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#9FE1CB" }} /><span className="text-[10px] text-gray-500">Locked</span></div>
          </div>
          <span className="text-[13px] text-gray-500 font-medium">{lockedCount} of {days.length} decided</span>
        </div>
      </div>

      {/* Day bar (#1, #2) */}
      <div className="px-4 py-2.5 flex gap-2 overflow-x-auto border-b border-gray-100 flex-shrink-0">
        {days.map((day, idx) => {
          const status = day.vibe_status || "curated";
          const isActive = idx === activeDay;
          const isCollabDay = status === "collab";
          const activeBorderColor = isCollabDay ? "#534AB7" : "#1D9E75";
          const chipStyle = status === "locked"
            ? { bg: "#E1F5EE", border: "#9FE1CB", dot: "#9FE1CB" }
            : isCollabDay
            ? { bg: "#EEEDFE", border: "#AFA9EC", dot: "#AFA9EC" }
            : { bg: "#E1F5EE", border: "#5DCAA5", dot: "#5DCAA5" };
          const vibeSnippet = day.narrative ? day.narrative.slice(0, 30) + (day.narrative.length > 30 ? "..." : "") : "";
          return (
            <button key={day.id} onClick={() => { setActiveDay(idx); setBenchStopIds(new Set()); setSelectedVibe(null); setBenchAlternatives([]); setHighlightedStopId(null); }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg whitespace-nowrap flex-shrink-0 transition-all"
              style={{
                background: chipStyle.bg,
                border: isActive ? `2px solid ${activeBorderColor}` : `1px solid ${chipStyle.border}`,
                padding: isActive ? "7px 11px" : "8px 12px",
              }}
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: chipStyle.dot }} />
              <span className="text-[12px] font-semibold text-gray-800">Day {day.day_number}</span>
              {day.title && <span className="text-[11px] text-gray-600 font-medium">{day.title}</span>}
              {vibeSnippet && <span className="text-[10px] text-gray-400 hidden lg:inline">— {vibeSnippet}</span>}
            </button>
          );
        })}
      </div>

      {/* Three-column layout (#3, #5) */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* LEFT — Claude's reasoning (25%) */}
          <div className="w-[25%] border-r border-gray-100 flex flex-col overflow-y-auto p-5 flex-shrink-0">
            <p className="text-[11px] text-gray-400 font-medium mb-1">Day {activeDay + 1} of {days.length}</p>
            <h2 className="text-[22px] font-semibold text-gray-900 mb-2">{currentDay?.title || `Day ${activeDay + 1}`}</h2>

            {/* Status badge */}
            {isCurated && <span className="inline-flex self-start px-2.5 py-1 rounded-full text-[11px] font-medium mb-3" style={{ backgroundColor: "#E1F5EE", color: "#085041" }}>Curated</span>}
            {isCollab && <span className="inline-flex self-start px-2.5 py-1 rounded-full text-[11px] font-medium mb-3" style={{ backgroundColor: "#EEEDFE", color: "#534AB7" }}>Collab</span>}
            {isLocked && <span className="inline-flex self-start px-2.5 py-1 rounded-full text-[11px] font-medium mb-3" style={{ backgroundColor: "#E1F5EE", color: "#085041" }}>Locked</span>}

            {/* Reasoning (#10, #11) */}
            {reasoningText && (
              <div className="mb-4 border-l-2 border-gray-200 pl-3">
                <h3 className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-1">My read</h3>
                <div className="text-[12px] text-gray-600 leading-relaxed italic chat-markdown">
                  <ReactMarkdown>{reasoningText}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* Mini map (#12, #13) */}
            <div className="rounded-lg overflow-hidden mb-4 flex-shrink-0" style={{ height: showBench ? 150 : 200 }}>
              <VibeMap stops={picksStops} dayColor={dayColors[activeDay] || "#1D9E75"} highlightedStopId={highlightedStopId} onPinClick={handlePinClick} />
            </div>

            {/* Anchors (curated/locked only) */}
            {(isCurated || isLocked) && anchors.length > 0 && (
              <div className="mb-4">
                <h3 className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Anchors</h3>
                <div className="flex flex-col gap-2">
                  {anchors.map(s => (
                    <div key={s.id} className="rounded-lg p-2.5 border-l-[3px] cursor-pointer hover:bg-gray-50" style={{ borderColor: "#1D9E75", backgroundColor: "#f8fffe" }} onClick={() => handleCardClick(s.id)}>
                      <p className="text-[12px] font-medium text-gray-900">{s.name}</p>
                      {s.description && <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{s.description}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Vibe buttons — in LEFT column (#16, #17) */}
            {(isCollab || isLocked) && (
              <div className="mb-4">
                <h3 className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-2">What&apos;s this day&apos;s vibe?</h3>
                <div className="flex flex-wrap gap-1.5">
                  {vibeButtons.map(vibe => {
                    const isSel = selectedVibe === vibe;
                    return (
                      <button key={vibe} onClick={() => handleVibeSelect(vibe)} disabled={vibeLoading}
                        className="px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors disabled:opacity-50"
                        style={isSel ? { backgroundColor: "#EEEDFE", border: "1.5px solid #534AB7", color: "#534AB7" } : { backgroundColor: "white", border: "1.5px solid #d1d5db", color: "#6b7280" }}>
                        {vibe}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Chat */}
            <div className="flex-1 flex flex-col min-h-0 mt-2">
              {chatMessages.length > 0 && (
                <div className="flex-1 overflow-y-auto mb-2 min-h-0">
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`mb-2 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      {msg.role === "user" ? (
                        <div className="max-w-[90%] rounded-lg px-2.5 py-1.5 bg-emerald-500 text-white text-[12px] leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                      ) : (
                        <div className="max-w-[90%] rounded-lg px-2.5 py-1.5 bg-gray-100 text-gray-800 text-[12px] leading-relaxed chat-markdown"><ReactMarkdown>{msg.content}</ReactMarkdown></div>
                      )}
                    </div>
                  ))}
                  {isThinking && (
                    <div className="mb-2 flex justify-start">
                      <div className="bg-gray-100 rounded-lg px-2.5 py-1.5 text-[11px] text-gray-500 flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce" /><span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} /><span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
              <div className="flex gap-1.5 flex-shrink-0">
                <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Ask Claude..."
                  className="flex-1 text-[12px] px-3 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200"
                  onKeyDown={e => e.key === "Enter" && handleChatSend()} disabled={isThinking} />
                <button onClick={() => handleChatSend()} disabled={isThinking || !chatInput.trim()} className="px-3 py-2 rounded-lg bg-emerald-500 text-white text-[11px] font-medium disabled:opacity-50">Send</button>
              </div>
            </div>
          </div>

          {/* CENTER — Claude's picks (#3, #4, #5) */}
          <div className={`flex flex-col overflow-hidden ${showBench ? "w-[37.5%]" : "flex-1"}`} style={{ borderLeft: "1.5px solid #1D9E75", borderRight: showBench ? "1.5px solid #1D9E75" : "none" }}>
            <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-gray-700">{selectedVibe || (isCurated || isLocked ? "Claude\u2019s picks" : "Picks")}</span>
                {vibeLoading && <span className="w-3 h-3 border-2 border-gray-200 border-t-emerald-500 rounded-full animate-spin" />}
              </div>
              <button onClick={handleRefresh} disabled={vibeLoading} className="text-[11px] text-gray-500 hover:text-gray-700 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors disabled:opacity-50">↻ Refresh</button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              <SortableContext items={picksStops.map(s => s.id)} strategy={verticalListSortingStrategy}>
                {groupedPicks.map(group => (
                  <div key={group.period} className="mb-4">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{group.period}</p>
                    <div className="flex flex-col gap-2">
                      {group.stops.map(stop => (
                        <div key={stop.id} ref={el => { if (el) stopCardRefs.current.set(stop.id, el); }}>
                          <SortableStopCard stop={stop} isHighlighted={highlightedStopId === stop.id} onClick={() => handleCardClick(stop.id)} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </SortableContext>
              {picksStops.length === 0 && (
                <div className="text-center py-10 text-gray-400 text-[13px]">{vibeLoading ? "Reshuffling stops..." : "Select a vibe to see picks"}</div>
              )}
            </div>

            {/* Action buttons (#6, #15) */}
            <div className="px-4 py-3 border-t border-gray-100 flex-shrink-0 flex flex-col gap-2">
              {isCurated && (
                <>
                  <button onClick={() => currentDay && lockDay(currentDay.id)} className="w-full py-2.5 rounded-lg text-white text-[13px] font-medium" style={{ backgroundColor: "#1D9E75" }}>Looks good — lock it in</button>
                  <button onClick={() => currentDay && vibeThisDay(currentDay.id)} className="w-full py-2.5 rounded-lg text-[13px] font-medium text-gray-500" style={{ border: "1.5px dashed #d1d5db" }}>Vibe this day</button>
                </>
              )}
              {isCollab && (
                <button onClick={() => currentDay && lockDay(currentDay.id)} className="w-full py-2.5 rounded-lg text-white text-[13px] font-medium" style={{ backgroundColor: "#1D9E75" }}>Love it — lock this day in</button>
              )}
              {isLocked && (
                <>
                  <div className="text-center py-1 text-[12px] text-gray-400 flex items-center justify-center gap-1.5">
                    <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    Day locked
                  </div>
                  <button onClick={() => currentDay && unlockDay(currentDay.id)} className="w-full py-2 rounded-lg text-[12px] font-medium text-gray-500" style={{ border: "1.5px dashed #d1d5db" }}>Vibe this day</button>
                </>
              )}
            </div>
          </div>

          {/* RIGHT — On the bench (#5, #6, #7, #8) */}
          {showBench ? (
            <div className="w-[37.5%] flex flex-col overflow-hidden" style={{ borderLeft: "1px dashed #d1d5db" }}>
              <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 flex-shrink-0">
                <span className="text-[13px] font-medium text-gray-500">On the bench</span>
                <button onClick={fetchBenchAlternatives} disabled={benchLoading} className="text-[11px] text-gray-500 hover:text-gray-700 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors disabled:opacity-50">↻ Refresh</button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {benchLoading ? (
                  <BenchSkeleton />
                ) : (
                  <SortableContext items={[...benchStops.map(s => s.id), "bench-droppable"]} strategy={verticalListSortingStrategy}>
                    {benchStops.map(stop => (
                      <div key={stop.id} className="mb-2">
                        <SortableStopCard stop={stop} isBench isHighlighted={highlightedStopId === stop.id} onClick={() => handleCardClick(stop.id)} />
                      </div>
                    ))}
                    {benchStops.length === 0 && !benchLoading && (
                      <div className="text-center py-10 text-gray-400 text-[12px]">Drag stops here to bench them, or Claude will populate alternatives when you pick a vibe.</div>
                    )}
                  </SortableContext>
                )}
              </div>
            </div>
          ) : (
            /* Hidden bench — expand center (#5) */
            null
          )}
        </div>

        <DragOverlay>{draggedStop ? <DragOverlayCard stop={draggedStop} /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
