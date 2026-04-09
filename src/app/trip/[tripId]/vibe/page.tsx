"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getMemberForTrip } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { askClaude, executeToolCall } from "@/lib/claude";
import ReactMarkdown from "react-markdown";
import DayBar from "@/components/DayBar";
import type { Trip, TripMember, Day, Stop } from "@/lib/database.types";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const VibeMap = dynamic(() => import("./VibeMap"), { ssr: false, loading: () => <div className="w-full h-full bg-gray-100 rounded-lg" /> });

type VibeDay = Day & { vibe_status?: string | null; reasoning?: string | null };
type VibeTrip = Trip & { trip_summary?: string | null };
type VibeStop = Stop & { ai_note?: string | null; on_bench?: boolean | null };

function generateDayColors(count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return ["hsl(145, 55%, 33%)"];
  const H = [145, 165, 180, 195, 220, 250, 280, 310], S = [55, 60, 55, 50, 55, 50, 50, 45], L = [33, 38, 40, 42, 42, 40, 38, 38];
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1), idx = t * (H.length - 1), lo = Math.floor(idx), hi = Math.min(lo + 1, H.length - 1), f = idx - lo;
    return `hsl(${Math.round(H[lo] + (H[hi] - H[lo]) * f)}, ${Math.round(S[lo] + (S[hi] - S[lo]) * f)}%, ${Math.round(L[lo] + (L[hi] - L[lo]) * f)}%)`;
  });
}

function stopTypeColor(t: string) { return t === "food" ? "#A32D2D" : t === "visit" ? "#185FA5" : t === "walking" || t === "walk_by" ? "#0F6E56" : t === "experience" || t === "guided_tour" ? "#854F0B" : t === "transit" ? "#6B7280" : "#185FA5"; }
function stopTypeLabel(t: string) { return t === "food" ? "Food" : t === "visit" ? "Visit" : t === "walking" || t === "walk_by" ? "Walking" : t === "experience" ? "Experience" : t === "guided_tour" ? "Tour" : t === "transit" ? "Transit" : t; }
function getTimePeriod(startTime: string | null, sortOrder: number): string {
  if (!startTime) return sortOrder <= 1 ? "Morning" : sortOrder <= 3 ? "Mid-day" : sortOrder <= 5 ? "Afternoon" : "Evening";
  const m = startTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return "Morning";
  let h = parseInt(m[1]); if (m[3].toUpperCase() === "PM" && h !== 12) h += 12; if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
  return h < 12 ? "Morning" : h < 14 ? "Mid-day" : h < 17 ? "Afternoon" : "Evening";
}
function isValidCoord(s: Stop) { return s.latitude != null && s.longitude != null && !(s.latitude === 0 && s.longitude === 0); }

// --- Stop cards ---
function SortableStopCard({ stop, isBench, isHighlighted, onClick, showAiNote }: { stop: VibeStop; isBench?: boolean; isHighlighted?: boolean; onClick?: () => void; showAiNote?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : isBench ? 0.6 : 1 }} className="group">
      <StopCard stop={stop} dragListeners={listeners} dragAttributes={attributes} isBench={isBench} isHighlighted={isHighlighted} onClick={onClick} showAiNote={showAiNote} />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function StopCard({ stop, dragListeners, dragAttributes, isBench, isHighlighted, onClick, showAiNote }: {
  stop: VibeStop; dragListeners?: any; dragAttributes?: any; isBench?: boolean; isHighlighted?: boolean; onClick?: () => void; showAiNote?: boolean;
}) {
  const color = stopTypeColor(stop.stop_type);
  return (
    <div onClick={onClick}
      className={`rounded-lg border bg-white overflow-hidden transition-all shadow-sm ${isBench ? "hover:opacity-100" : ""} ${isHighlighted ? "ring-2 ring-amber-400 shadow-md" : ""} ${onClick ? "cursor-pointer" : ""}`}
      style={{ borderColor: isHighlighted ? "#f59e0b" : "#e5e7eb" }}>
      <div className="h-1.5" style={{ backgroundColor: color }} />
      <div className="p-3 flex gap-2">
        <div className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 pt-0.5" {...(dragListeners || {})} {...(dragAttributes || {})}>
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2" cy="2" r="1.5" /><circle cx="8" cy="2" r="1.5" /><circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="2" cy="14" r="1.5" /><circle cx="8" cy="14" r="1.5" /></svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[13px] font-medium text-gray-900 truncate">{stop.name}</span>
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: `${color}15`, color }}>{stopTypeLabel(stop.stop_type)}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1">
            <span>{stop.duration_minutes} min</span>
            {stop.cost_estimate != null && stop.cost_estimate > 0 && <span>· {stop.cost_currency}{stop.cost_estimate}</span>}
            {!isValidCoord(stop) && stop.stop_type !== "transit" && <span className="text-orange-500">· Location missing</span>}
          </div>
          {stop.description && <p className="text-[11px] text-gray-600 leading-relaxed line-clamp-2">{stop.description}</p>}
          {showAiNote && stop.ai_note && <p className="text-[10px] text-emerald-700 italic mt-1 line-clamp-1">{stop.ai_note}</p>}
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

function BenchSkeleton() {
  return (
    <div className="flex flex-col gap-2 animate-pulse">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="h-1.5 bg-gray-200" /><div className="p-3"><div className="h-3 bg-gray-200 rounded w-3/4 mb-2" /><div className="h-2.5 bg-gray-100 rounded w-1/2 mb-1" /><div className="h-2.5 bg-gray-100 rounded w-full" /></div>
        </div>
      ))}
    </div>
  );
}

// --- Main ---
export default function VibePlanningPage() {
  const router = useRouter();
  const params = useParams();
  const tripId = params.tripId as string;

  const [loading, setLoading] = useState(true);
  const [currentMember, setCurrentMember] = useState<TripMember | null>(null);
  const [trip, setTrip] = useState<VibeTrip | null>(null);
  const [days, setDays] = useState<VibeDay[]>([]);
  const [stops, setStops] = useState<VibeStop[]>([]);
  const [activeDay, setActiveDay] = useState(0);
  const [selectedVibe, setSelectedVibe] = useState<string | null>(null);
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [vibeLoading, setVibeLoading] = useState(false);
  const [benchLoading, setBenchLoading] = useState(false);
  const [highlightedStopId, setHighlightedStopId] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const stopCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const dayColors = useMemo(() => generateDayColors(days.length), [days.length]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // --- Load ---
  useEffect(() => {
    async function load() {
      const member = await getMemberForTrip(tripId);
      if (!member) { router.replace(`/trip/${tripId}/invite`); return; }
      setCurrentMember(member);
      const [tripRes, daysRes, stopsRes] = await Promise.all([
        supabase.from("trips").select("*").eq("id", tripId).maybeSingle(),
        supabase.from("days").select("*").eq("trip_id", tripId).order("day_number"),
        supabase.from("stops").select("*").eq("trip_id", tripId).order("sort_order"),
      ]);
      if (tripRes.data) { setTrip(tripRes.data as VibeTrip); if ((tripRes.data as VibeTrip).trip_summary) setShowSummary(true); }
      if (daysRes.data) setDays(daysRes.data as VibeDay[]);
      if (stopsRes.data) setStops(stopsRes.data as VibeStop[]);
      setLoading(false);
    }
    load();
  }, [tripId, router]);

  // --- Auto-assign vibe_status ---
  useEffect(() => {
    if (days.length === 0 || !trip) return;
    if (!days.some(d => !d.vibe_status)) return;
    async function assign() {
      for (const day of days) {
        if (day.vibe_status) continue;
        const dayStops = stops.filter(s => s.day_id === day.id);
        const hasTransit = dayStops.some(s => s.stop_type === "transit");
        const isCurated = hasTransit || dayStops.length <= 4 || day.day_number === 1 || day.day_number === days.length;
        await supabase.from("days").update({ vibe_status: isCurated ? "curated" : "collab" }).eq("id", day.id);
      }
      const { data } = await supabase.from("days").select("*").eq("trip_id", tripId).order("day_number");
      if (data) setDays(data as VibeDay[]);
    }
    assign();
  }, [days.length, stops.length, trip, tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Generate trip summary ---
  useEffect(() => {
    if (!trip || trip.trip_summary || days.length === 0) return;
    (async () => {
      const result = await askClaude({ tripId, messages: [{ role: "user", content: "Write a single exciting paragraph (3-4 sentences) summarizing this entire trip. Text only, no tools." }], systemContext: "Generate a trip summary. Text only, no tools." });
      if (result.text) { await supabase.from("trips").update({ trip_summary: result.text }).eq("id", tripId); setTrip(prev => prev ? { ...prev, trip_summary: result.text } : prev); setShowSummary(true); }
    })();
  }, [trip?.trip_summary, days.length, tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, isThinking]);

  // --- Derived ---
  const currentDay = days[activeDay] as VibeDay | undefined;
  const allStopsForDay = useMemo(() => currentDay ? stops.filter(s => s.day_id === currentDay.id).sort((a, b) => a.sort_order - b.sort_order) : [], [currentDay, stops]);
  const picksStops = useMemo(() => allStopsForDay.filter(s => s.stop_type !== "transit" && !s.on_bench), [allStopsForDay]);
  const benchStops = useMemo(() => allStopsForDay.filter(s => s.stop_type !== "transit" && s.on_bench), [allStopsForDay]);
  const lockedCount = days.filter(d => d.vibe_status === "locked").length;
  const allLocked = days.length > 0 && lockedCount === days.length;
  const isCurated = currentDay?.vibe_status === "curated";
  const isCollab = currentDay?.vibe_status === "collab";
  const isLocked = currentDay?.vibe_status === "locked";

  // --- Vibe pills (#9) ---
  const vibeButtons = useMemo(() => {
    if (!trip) return [];
    const pills: string[] = ["Slow morning", "Hidden gems", "Off the beaten path"];
    const gt = (trip.group_type || "").toLowerCase(), gd = (trip.group_detail || "").toLowerCase();
    const int = (trip.interests || "").toLowerCase(), notes = (trip.extra_notes || "").toLowerCase();
    if (gt === "family" && gd.match(/kid|child|toddler|teen|baby/)) { pills.unshift("Kid energy burn"); pills.push("Stroller-friendly"); }
    if (int.match(/food|cook|cuisine/)) { pills.unshift("Foodie deep dive"); pills.push("Cooking class"); }
    if (int.match(/history|culture|museum/)) { pills.push("History nerd mode"); pills.push("Museum day"); }
    if (notes.match(/dog|pet/)) pills.push("Dog-friendly");
    if (int.match(/outdoor|hike|nature/)) pills.push("Outdoors");
    return pills;
  }, [trip]);

  const anchors = useMemo(() => {
    if (!isCurated && !isLocked) return [];
    return [...picksStops].filter(s => s.stop_type !== "transit" && s.stop_type !== "food").sort((a, b) => b.duration_minutes - a.duration_minutes).slice(0, 3);
  }, [isCurated, isLocked, picksStops]);

  const groupedPicks = useMemo(() => {
    const groups: { period: string; stops: VibeStop[] }[] = [];
    const order = ["Morning", "Mid-day", "Afternoon", "Evening"];
    const byP = new Map<string, VibeStop[]>();
    for (const s of picksStops) { const p = getTimePeriod(s.start_time, s.sort_order); if (!byP.has(p)) byP.set(p, []); byP.get(p)!.push(s); }
    for (const p of order) { const ss = byP.get(p); if (ss?.length) groups.push({ period: p, stops: ss }); }
    return groups;
  }, [picksStops]);

  const reasoningText = useMemo(() => {
    if (!currentDay) return null;
    if (currentDay.reasoning) return currentDay.reasoning;
    return null; // Never show generic placeholder
  }, [currentDay]);

  // --- Actions ---
  async function reloadDays() { const { data } = await supabase.from("days").select("*").eq("trip_id", tripId).order("day_number"); if (data) setDays(data as VibeDay[]); return data as VibeDay[] | null; }
  async function reloadStops() { const { data } = await supabase.from("stops").select("*").eq("trip_id", tripId).order("sort_order"); if (data) setStops(data as VibeStop[]); }

  async function lockDay(dayId: string) {
    await supabase.from("days").update({ vibe_status: "locked" }).eq("id", dayId);
    const updated = await reloadDays();
    if (updated) { const next = updated.findIndex((d, i) => i > activeDay && d.vibe_status !== "locked"); if (next >= 0) { setActiveDay(next); setSelectedVibe(null); setHighlightedStopId(null); } }
  }
  async function unlockDay(dayId: string) { await supabase.from("days").update({ vibe_status: "collab" }).eq("id", dayId); await reloadDays(); fetchBenchAlternatives(); }
  async function vibeThisDay(dayId: string) { await supabase.from("days").update({ vibe_status: "collab" }).eq("id", dayId); await reloadDays(); fetchBenchAlternatives(); }

  async function fetchBenchAlternatives() {
    if (!currentDay) return;
    setBenchLoading(true);
    const result = await askClaude({
      tripId,
      messages: [{ role: "user", content: `Suggest 4-6 alternative stops for Day ${currentDay.day_number} (${currentDay.title || ""}). Include at least one restaurant/food option and one activity. These should connect to different directions this day could go. Return as JSON array in a code block: [{"name":"...","description":"...","stop_type":"food|visit|walking|experience","duration_minutes":60,"latitude":0,"longitude":0}]. Do NOT use tool calls.` }],
      systemContext: `Generate bench alternatives for Day ${currentDay.day_number} (day_id: ${currentDay.id}). Include a mix of food and activities. JSON array in a \`\`\`json block. No tool calls.`,
    });
    const jsonMatch = result.text.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const alts = JSON.parse(jsonMatch[1]);
        if (Array.isArray(alts)) {
          for (let i = 0; i < alts.length; i++) {
            const a = alts[i];
            await supabase.from("stops").insert({
              trip_id: tripId, day_id: currentDay.id, name: a.name || "Alternative",
              description: a.description || null, stop_type: a.stop_type || "visit",
              duration_minutes: a.duration_minutes || 60, latitude: a.latitude || null,
              longitude: a.longitude || null, sort_order: 100 + i, on_bench: true,
            });
          }
          await reloadStops();
        }
      } catch { /* parse failed */ }
    }
    setBenchLoading(false);
  }

  async function handleVibeSelect(vibe: string) {
    if (!currentDay) return;
    setSelectedVibe(vibe);
    setVibeLoading(true);
    // Send as chat message per spec #9
    const userMsg = { role: "user" as const, content: `I want to vibe this day toward: "${vibe}". Suggest changes to the current stops and bench accordingly.` };
    setChatMessages(prev => [...prev, userMsg]);
    const result = await askClaude({
      tripId,
      messages: [...chatMessages, userMsg].slice(-20),
      systemContext: `The user selected the "${vibe}" vibe for Day ${currentDay.day_number}. Reshape stops on day_id: ${currentDay.id} using tools. Only modify this day.`,
    });
    for (const tc of result.toolCalls) await executeToolCall(tripId, tc);
    await reloadStops();
    if (result.text) setChatMessages(prev => [...prev, { role: "assistant", content: result.text }]);
    setVibeLoading(false);
  }

  async function handleRefresh() {
    if (!currentDay) return;
    setVibeLoading(true);
    const result = await askClaude({
      tripId,
      messages: [{ role: "user", content: `Show different options for Day ${currentDay.day_number}. ${selectedVibe ? `Keep the "${selectedVibe}" vibe.` : ""}` }],
      systemContext: `Refresh Day ${currentDay.day_number} (day_id: ${currentDay.id}). Use tools.`,
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
    const ctx = currentDay ? `Viewing Day ${currentDay.day_number}${currentDay.title ? ` — ${currentDay.title}` : ""}. ${selectedVibe ? `Vibe: "${selectedVibe}".` : ""}` : undefined;
    const result = await askClaude({ tripId, messages: [...chatMessages, userMsg].slice(-20), systemContext: ctx });
    for (const tc of result.toolCalls) await executeToolCall(tripId, tc);
    if (result.toolCalls.length > 0) await reloadStops();
    if (result.text) setChatMessages(prev => [...prev, { role: "assistant", content: result.text }]);
    setIsThinking(false);
  }

  // --- DnD ---
  function handleDragStart(e: DragStartEvent) { setDragActiveId(e.active.id as string); }
  function handleDragEnd(e: DragEndEvent) {
    setDragActiveId(null);
    const { active, over } = e;
    if (!over || !currentDay) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    const activeStop = stops.find(s => s.id === activeId);
    if (!activeStop) return;
    const isFromBench = activeStop.on_bench;
    const overStop = stops.find(s => s.id === overId);
    const isOverBench = overId === "bench-droppable" || (overStop?.on_bench ?? false);

    if (isFromBench && !isOverBench) {
      // Promote from bench to picks
      (async () => { await supabase.from("stops").update({ on_bench: false, sort_order: picksStops.length }).eq("id", activeId); await reloadStops(); })();
    } else if (!isFromBench && isOverBench) {
      // Demote to bench
      (async () => { await supabase.from("stops").update({ on_bench: true, sort_order: 100 }).eq("id", activeId); await reloadStops(); })();
    }
  }

  const draggedStop = dragActiveId ? stops.find(s => s.id === dragActiveId) : null;

  function handlePinClick(stopId: string) { setHighlightedStopId(stopId); const el = stopCardRefs.current.get(stopId); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }
  function handleCardClick(stopId: string) { setHighlightedStopId(prev => prev === stopId ? null : stopId); }

  if (loading) return (<div className="h-screen flex items-center justify-center bg-white"><div className="text-center"><div className="w-10 h-10 rounded-full border-[3px] border-gray-200 border-t-purple-500 animate-spin mx-auto mb-4" /><p className="text-gray-400 text-sm">Loading vibe planning...</p></div></div>);
  if (!trip || !currentMember) return null;

  if (allLocked) return (
    <div className="h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5"><svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></div>
        <h1 className="text-[18px] font-medium text-gray-900 mb-1">{trip.name}</h1>
        <h2 className="text-[22px] font-semibold text-gray-900 mb-2">Your trip is set!</h2>
        <p className="text-[14px] text-gray-500 mb-8">{days.length} days, {stops.filter(s => s.stop_type !== "transit" && !s.on_bench).length} stops across {new Set(days.map(d => d.title).filter(Boolean)).size} cities</p>
        <button onClick={() => router.push(`/trip/${tripId}`)} className="px-6 py-3 rounded-lg text-white font-medium text-[14px]" style={{ backgroundColor: "#1D9E75" }}>View your itinerary</button>
      </div>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      {/* Summary overlay */}
      {showSummary && trip.trip_summary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl max-w-lg mx-4 p-8 shadow-2xl">
            <h2 className="text-[20px] font-semibold text-gray-900 mb-4">{trip.name}</h2>
            <p className="text-[14px] text-gray-700 leading-relaxed mb-6">{trip.trip_summary}</p>
            <button onClick={() => setShowSummary(false)} className="w-full py-3 rounded-lg text-white font-medium text-[14px]" style={{ backgroundColor: "#1D9E75" }}>Let&apos;s dive in</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push(`/trip/${tripId}`)} className="text-[13px] text-gray-500 hover:text-gray-700 flex items-center gap-1 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Dashboard
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

      {/* Day bar (#1) */}
      <DayBar days={days} activeDay={activeDay} dayColors={dayColors} onSelectDay={(idx) => { setActiveDay(idx); setSelectedVibe(null); setHighlightedStopId(null); }} />

      {/* Columns (#2, #3) */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex flex-1 min-h-0 overflow-hidden" style={{ transition: "all 0.3s ease" }}>

          {/* LEFT — Dialogue column */}
          <div className={`border-r border-gray-100 flex flex-col overflow-y-auto p-5 flex-shrink-0 transition-all duration-300 ${isCollab ? "w-[33.3%]" : "w-[50%]"}`}>
            <p className="text-[11px] text-gray-400 font-medium mb-1">Day {activeDay + 1} of {days.length}</p>
            <h2 className="text-[22px] font-semibold text-gray-900 mb-2">{currentDay?.title || `Day ${activeDay + 1}`}</h2>

            {/* Status badge */}
            {isCurated && <span className="inline-flex self-start px-2.5 py-1 rounded-full text-[11px] font-medium mb-3" style={{ backgroundColor: "#E1F5EE", color: "#085041" }}>Curated</span>}
            {isCollab && <span className="inline-flex self-start px-2.5 py-1 rounded-full text-[11px] font-medium mb-3" style={{ backgroundColor: "#EEEDFE", color: "#534AB7" }}>Collab</span>}
            {isLocked && <span className="inline-flex self-start px-2.5 py-1 rounded-full text-[11px] font-medium mb-3" style={{ backgroundColor: "#E1F5EE", color: "#085041" }}>Locked</span>}

            {/* Reasoning (#10, #11, #6) */}
            {reasoningText && (
              <div className="mb-4 border-l-2 border-gray-200 pl-3">
                <h3 className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-1">My read</h3>
                <div className="text-[12px] text-gray-600 leading-relaxed italic chat-markdown"><ReactMarkdown>{reasoningText}</ReactMarkdown></div>
              </div>
            )}

            {/* Map (#4, #8) */}
            <div className="rounded-lg overflow-hidden mb-4 flex-shrink-0" style={{ height: isCollab ? 140 : 200 }}>
              <VibeMap stops={picksStops} dayColor={dayColors[activeDay] || "#1D9E75"} highlightedStopId={highlightedStopId} onPinClick={handlePinClick} />
            </div>

            {/* Anchors (curated/locked) */}
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

            {/* Vibe pills (#9, #16) — collab and locked days */}
            {(isCollab || isLocked) && (
              <div className="mb-4">
                <h3 className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Vibes</h3>
                <div className="flex flex-wrap gap-1.5">
                  {vibeButtons.map(vibe => (
                    <button key={vibe} onClick={() => handleVibeSelect(vibe)} disabled={vibeLoading}
                      className="px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors disabled:opacity-50"
                      style={selectedVibe === vibe ? { backgroundColor: "#EEEDFE", border: "1.5px solid #534AB7", color: "#534AB7" } : { backgroundColor: "white", border: "1.5px solid #d1d5db", color: "#6b7280" }}>
                      {vibe}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons (#3) — ALL live here */}
            <div className="mb-4 flex flex-col gap-2">
              {isCurated && (
                <>
                  <button onClick={() => currentDay && lockDay(currentDay.id)} className="w-full py-2.5 rounded-lg text-white text-[13px] font-medium" style={{ backgroundColor: "#1D9E75" }}>Looks good — lock it in</button>
                  <button onClick={() => currentDay && vibeThisDay(currentDay.id)} className="w-full py-2.5 rounded-lg text-[13px] font-medium" style={{ border: "1.5px solid #534AB7", color: "#534AB7" }}>Vibe this day</button>
                </>
              )}
              {isCollab && <button onClick={() => currentDay && lockDay(currentDay.id)} className="w-full py-2.5 rounded-lg text-white text-[13px] font-medium" style={{ backgroundColor: "#1D9E75" }}>Love it — lock this day in</button>}
              {isLocked && (
                <>
                  <div className="text-center py-1 text-[12px] text-gray-400 flex items-center justify-center gap-1.5">
                    <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>Day locked
                  </div>
                  <button onClick={() => currentDay && unlockDay(currentDay.id)} className="w-full py-2 rounded-lg text-[12px] font-medium" style={{ border: "1.5px solid #534AB7", color: "#534AB7" }}>Vibe this day</button>
                </>
              )}
            </div>

            {/* Chat */}
            <div className="flex-1 flex flex-col min-h-0">
              {chatMessages.length > 0 && (
                <div className="flex-1 overflow-y-auto mb-2 min-h-0">
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`mb-2 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      {msg.role === "user"
                        ? <div className="max-w-[90%] rounded-lg px-2.5 py-1.5 bg-emerald-500 text-white text-[12px] leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                        : <div className="max-w-[90%] rounded-lg px-2.5 py-1.5 bg-gray-100 text-gray-800 text-[12px] leading-relaxed chat-markdown"><ReactMarkdown>{msg.content}</ReactMarkdown></div>}
                    </div>
                  ))}
                  {isThinking && (
                    <div className="mb-2 flex justify-start"><div className="bg-gray-100 rounded-lg px-2.5 py-1.5 text-[11px] text-gray-500 flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce" /><span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} /><span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div></div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
              <div className="flex gap-1.5 flex-shrink-0">
                <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Ask Claude..." className="flex-1 text-[12px] px-3 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200" onKeyDown={e => e.key === "Enter" && handleChatSend()} disabled={isThinking} />
                <button onClick={() => handleChatSend()} disabled={isThinking || !chatInput.trim()} className="px-3 py-2 rounded-lg bg-emerald-500 text-white text-[11px] font-medium disabled:opacity-50">Send</button>
              </div>
            </div>
          </div>

          {/* CENTER — Picks (#4, #5) */}
          <div className={`flex flex-col overflow-hidden transition-all duration-300 ${isCollab ? "w-[33.3%]" : "w-[50%]"}`} style={{ borderLeft: "1.5px solid #1D9E75", borderRight: isCollab ? "1.5px solid #1D9E75" : "none" }}>
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
                          <SortableStopCard stop={stop} isHighlighted={highlightedStopId === stop.id} onClick={() => handleCardClick(stop.id)} showAiNote={isCurated || isLocked} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </SortableContext>
              {picksStops.length === 0 && <div className="text-center py-10 text-gray-400 text-[13px]">{vibeLoading ? "Reshuffling..." : "Select a vibe to see picks"}</div>}
            </div>
          </div>

          {/* RIGHT — Bench (#5, #6, #7, #8) */}
          {isCollab && (
            <div className="w-[33.3%] flex flex-col overflow-hidden transition-all duration-300" style={{ borderLeft: "1px dashed #d1d5db" }}>
              <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 flex-shrink-0">
                <span className="text-[13px] font-medium text-gray-500">On the bench</span>
                <button onClick={fetchBenchAlternatives} disabled={benchLoading} className="text-[11px] text-gray-500 hover:text-gray-700 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors disabled:opacity-50">↻ Refresh</button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {benchLoading ? <BenchSkeleton /> : (
                  <SortableContext items={[...benchStops.map(s => s.id), "bench-droppable"]} strategy={verticalListSortingStrategy}>
                    {benchStops.map(stop => (
                      <div key={stop.id} className="mb-2">
                        <SortableStopCard stop={stop} isBench isHighlighted={highlightedStopId === stop.id} onClick={() => handleCardClick(stop.id)} />
                      </div>
                    ))}
                    {benchStops.length === 0 && <div className="text-center py-10 text-gray-400 text-[12px]">Claude is thinking of options...</div>}
                  </SortableContext>
                )}
              </div>
            </div>
          )}
        </div>
        <DragOverlay>{draggedStop ? <DragOverlayCard stop={draggedStop} /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
