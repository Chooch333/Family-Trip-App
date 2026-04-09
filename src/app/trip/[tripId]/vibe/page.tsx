"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getMemberForTrip } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { askClaude, executeToolCall, getPromptChips } from "@/lib/claude";
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

// --- Day color gradient (same as dashboard) ---
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
    const h = hueStops[lo] + (hueStops[hi] - hueStops[lo]) * frac;
    const s = satStops[lo] + (satStops[hi] - satStops[lo]) * frac;
    const l = litStops[lo] + (litStops[hi] - litStops[lo]) * frac;
    colors.push(`hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`);
  }
  return colors;
}

// --- Stop type color map ---
function stopTypeColor(stopType: string): string {
  switch (stopType) {
    case "food": return "#A32D2D";
    case "visit": return "#185FA5";
    case "walking": case "walk_by": return "#0F6E56";
    case "experience": case "guided_tour": return "#854F0B";
    case "transit": return "#6B7280";
    default: return "#185FA5";
  }
}

function stopTypeLabel(stopType: string): string {
  switch (stopType) {
    case "food": return "Food";
    case "visit": return "Visit";
    case "walking": case "walk_by": return "Walking";
    case "experience": return "Experience";
    case "guided_tour": return "Tour";
    case "transit": return "Transit";
    default: return stopType;
  }
}

// --- Time period grouping ---
function getTimePeriod(startTime: string | null, sortOrder: number): string {
  if (!startTime) {
    if (sortOrder <= 1) return "Morning";
    if (sortOrder <= 3) return "Mid-day";
    if (sortOrder <= 5) return "Afternoon";
    return "Evening";
  }
  const match = startTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return "Morning";
  let hour = parseInt(match[1]);
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  if (hour < 12) return "Morning";
  if (hour < 14) return "Mid-day";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

// --- Sortable stop card ---
function SortableStopCard({ stop, isBench }: { stop: Stop; isBench?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stop.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : isBench ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group">
      <StopCard stop={stop} dragListeners={listeners} dragAttributes={attributes} isBench={isBench} />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function StopCard({ stop, dragListeners, dragAttributes, isBench }: {
  stop: Stop;
  dragListeners?: any;
  dragAttributes?: any;
  isBench?: boolean;
}) {
  const color = stopTypeColor(stop.stop_type);
  return (
    <div className={`rounded-lg border border-gray-200 bg-white overflow-hidden transition-opacity ${isBench ? "hover:opacity-100" : ""}`}>
      <div className="h-1" style={{ backgroundColor: color }} />
      <div className="p-3 flex gap-2">
        <div
          className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 pt-0.5"
          {...(dragListeners || {})}
          {...(dragAttributes || {})}
        >
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
            <circle cx="2" cy="2" r="1.5" /><circle cx="8" cy="2" r="1.5" />
            <circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" />
            <circle cx="2" cy="14" r="1.5" /><circle cx="8" cy="14" r="1.5" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[13px] font-medium text-gray-900 truncate">{stop.name}</span>
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: `${color}15`, color }}>
              {stopTypeLabel(stop.stop_type)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1">
            <span>{stop.duration_minutes} min</span>
            {stop.cost_estimate != null && stop.cost_estimate > 0 && (
              <span>· {stop.cost_currency}{stop.cost_estimate}</span>
            )}
          </div>
          {stop.description && (
            <p className="text-[11px] text-gray-600 leading-relaxed line-clamp-2">{stop.description}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Drag overlay card (no sortable hooks)
function DragOverlayCard({ stop }: { stop: Stop }) {
  return (
    <div className="w-72 shadow-xl rounded-lg border border-gray-200 bg-white overflow-hidden opacity-90">
      <div className="h-1" style={{ backgroundColor: stopTypeColor(stop.stop_type) }} />
      <div className="p-3">
        <span className="text-[13px] font-medium text-gray-900">{stop.name}</span>
      </div>
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
  const [trip, setTrip] = useState<Trip | null>(null);
  const [days, setDays] = useState<Day[]>([]);
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
  const chatEndRef = useRef<HTMLDivElement>(null);

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
      if (tripRes.data) setTrip(tripRes.data as Trip);
      if (daysRes.data) setDays(daysRes.data as Day[]);
      if (stopsRes.data) setStops(stopsRes.data as Stop[]);
      setLoading(false);
    }
    load();
  }, [tripId, router]);

  // --- Auto-assign vibe_status after load ---
  useEffect(() => {
    if (days.length === 0 || !trip) return;
    const needsAssignment = days.some(d => !(d as Day & { vibe_status?: string }).vibe_status);
    if (!needsAssignment) return;

    async function assignVibeStatuses() {
      for (const day of days) {
        const d = day as Day & { vibe_status?: string };
        if (d.vibe_status) continue;
        const dayStops = stops.filter(s => s.day_id === day.id);
        const hasTransit = dayStops.some(s => s.stop_type === "transit");
        const hasIconicStops = dayStops.length <= 4;
        // Curated: travel days, short days, first/last day
        const isCurated = hasTransit || hasIconicStops || day.day_number === 1 || day.day_number === days.length;
        const status = isCurated ? "curated" : "collab";
        await supabase.from("days").update({ vibe_status: status }).eq("id", day.id);
      }
      // Reload days
      const { data } = await supabase.from("days").select("*").eq("trip_id", tripId).order("day_number");
      if (data) setDays(data as Day[]);
    }
    assignVibeStatuses();
  }, [days.length, stops.length, trip, tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isThinking]);

  // --- Derived state ---
  const currentDay = days[activeDay] as (Day & { vibe_status?: string; reasoning?: string }) | undefined;
  const currentDayStops = useMemo(() =>
    currentDay ? stops.filter(s => s.day_id === currentDay.id).sort((a, b) => a.sort_order - b.sort_order) : [],
    [currentDay, stops]
  );
  const picksStops = useMemo(() =>
    currentDayStops.filter(s => s.stop_type !== "transit" && !benchStopIds.has(s.id)),
    [currentDayStops, benchStopIds]
  );
  const benchStops = useMemo(() =>
    currentDayStops.filter(s => s.stop_type !== "transit" && benchStopIds.has(s.id)),
    [currentDayStops, benchStopIds]
  );

  const lockedCount = days.filter(d => (d as Day & { vibe_status?: string }).vibe_status === "locked").length;
  const allLocked = days.length > 0 && lockedCount === days.length;

  // --- Build dynamic vibe buttons ---
  const vibeButtons = useMemo(() => {
    if (!trip) return [];
    const buttons = ["Take it easy", "Deep culture", "Food-focused", "Outdoors", "Sleep in"];
    const groupType = (trip.group_type || "").toLowerCase();
    const groupDetail = (trip.group_detail || "").toLowerCase();
    const interests = (trip.interests || "").toLowerCase();
    const notes = (trip.extra_notes || "").toLowerCase();
    const dates = (trip.travel_dates || "").toLowerCase();

    if (groupType === "family" && groupDetail.match(/kid|child|toddler|teen|baby/)) buttons.push("Kid energy burn");
    if (notes.match(/dog|pet/)) buttons.push("Dog-friendly");
    if ((groupType === "couple" || groupType === "solo") || groupDetail.match(/^2\s*(adult|people)/)) buttons.push("Romantic");
    if (interests.match(/food|cuisine|culinary/)) buttons.push("Culinary deep dive");
    if (dates.match(/jun|jul|aug|june|july|august|summer/)) buttons.push("Beat the heat");
    return buttons;
  }, [trip]);

  // --- Lock a day ---
  async function lockDay(dayId: string) {
    await supabase.from("days").update({ vibe_status: "locked" }).eq("id", dayId);
    const { data } = await supabase.from("days").select("*").eq("trip_id", tripId).order("day_number");
    if (data) {
      setDays(data as Day[]);
      // Advance to next unlocked day
      const updatedDays = data as (Day & { vibe_status?: string })[];
      const nextUnlocked = updatedDays.findIndex((d, i) => i > activeDay && d.vibe_status !== "locked");
      if (nextUnlocked >= 0) setActiveDay(nextUnlocked);
    }
  }

  // --- Convert curated to collab ---
  async function vibeThisDay(dayId: string) {
    await supabase.from("days").update({ vibe_status: "collab" }).eq("id", dayId);
    const { data } = await supabase.from("days").select("*").eq("trip_id", tripId).order("day_number");
    if (data) setDays(data as Day[]);
  }

  // --- Handle vibe selection ---
  async function handleVibeSelect(vibe: string) {
    if (!currentDay) return;
    setSelectedVibe(vibe);
    setVibeLoading(true);

    const result = await askClaude({
      tripId,
      messages: [{ role: "user", content: `Reshape Day ${currentDay.day_number} (${currentDay.title || ""}) for a "${vibe}" vibe. Use tools to swap, add, or remove stops to match this vibe. Keep any stops the user manually pinned.` }],
      systemContext: `The user selected the "${vibe}" vibe for Day ${currentDay.day_number}. Reshape the stops using replace_stop, add_stop, and remove_stop tools. Only modify stops on day_id: ${currentDay.id}. Do NOT touch stops on other days.`,
    });

    for (const tc of result.toolCalls) {
      await executeToolCall(tripId, tc);
    }

    // Refresh stops
    const { data: freshStops } = await supabase.from("stops").select("*").eq("trip_id", tripId).is("version_owner", null).order("sort_order");
    if (freshStops) setStops(freshStops as Stop[]);

    if (result.text) {
      setChatMessages(prev => [...prev, { role: "assistant", content: result.text }]);
    }
    setVibeLoading(false);
  }

  // --- Refresh picks ---
  async function handleRefresh() {
    if (!currentDay) return;
    setVibeLoading(true);
    const vibeNote = selectedVibe ? `Keep the "${selectedVibe}" vibe but show different options.` : "Show different options for this day.";
    const result = await askClaude({
      tripId,
      messages: [{ role: "user", content: `Show me different options for Day ${currentDay.day_number}. ${vibeNote}` }],
      systemContext: `Refresh Day ${currentDay.day_number} (day_id: ${currentDay.id}) with new stop suggestions. Use tools to swap stops.`,
    });
    for (const tc of result.toolCalls) {
      await executeToolCall(tripId, tc);
    }
    const { data: freshStops } = await supabase.from("stops").select("*").eq("trip_id", tripId).is("version_owner", null).order("sort_order");
    if (freshStops) setStops(freshStops as Stop[]);
    if (result.text) {
      setChatMessages(prev => [...prev, { role: "assistant", content: result.text }]);
    }
    setVibeLoading(false);
  }

  // --- Chat send ---
  async function handleChatSend(message?: string) {
    const text = message || chatInput.trim();
    if (!text || isThinking) return;
    const userMsg = { role: "user" as const, content: text };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setIsThinking(true);

    const dayContext = currentDay
      ? `The user is currently viewing Day ${currentDay.day_number}${currentDay.title ? ` — ${currentDay.title}` : ""}. ${selectedVibe ? `Selected vibe: "${selectedVibe}".` : ""}`
      : undefined;

    const result = await askClaude({
      tripId,
      messages: [...chatMessages, userMsg].slice(-20),
      systemContext: dayContext,
    });

    for (const tc of result.toolCalls) {
      await executeToolCall(tripId, tc);
    }

    if (result.toolCalls.length > 0) {
      const { data: freshStops } = await supabase.from("stops").select("*").eq("trip_id", tripId).is("version_owner", null).order("sort_order");
      if (freshStops) setStops(freshStops as Stop[]);
    }

    if (result.text) {
      setChatMessages(prev => [...prev, { role: "assistant", content: result.text }]);
    }
    setIsThinking(false);
  }

  // --- Drag and drop ---
  function handleDragStart(event: DragStartEvent) {
    setDragActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    const isFromBench = benchStopIds.has(activeId);
    const isOverBench = overId === "bench-droppable" || benchStopIds.has(overId);

    if (isFromBench && !isOverBench) {
      // Move from bench to picks
      setBenchStopIds(prev => { const n = new Set(prev); n.delete(activeId); return n; });
      setPinnedStopIds(prev => new Set(prev).add(activeId));
    } else if (!isFromBench && isOverBench) {
      // Move from picks to bench
      setBenchStopIds(prev => new Set(prev).add(activeId));
      setPinnedStopIds(prev => { const n = new Set(prev); n.delete(activeId); return n; });
    }
  }

  const draggedStop = dragActiveId ? stops.find(s => s.id === dragActiveId) : null;

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

  // --- Anchors (top 2-3 stops by duration for curated days) ---
  const anchors = useMemo(() => {
    if (!currentDay || (currentDay as Day & { vibe_status?: string }).vibe_status !== "curated") return [];
    return [...picksStops]
      .filter(s => s.stop_type !== "transit" && s.stop_type !== "food")
      .sort((a, b) => b.duration_minutes - a.duration_minutes)
      .slice(0, 3);
  }, [currentDay, picksStops]);

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

  // --- All days locked ---
  if (allLocked) return (
    <div className="h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-[18px] font-medium text-gray-900 mb-2">Your trip is set</h1>
        <p className="text-[14px] text-gray-500 mb-8">
          {days.length} days, {stops.filter(s => s.stop_type !== "transit").length} stops across{" "}
          {new Set(days.map(d => d.title).filter(Boolean)).size} cities
        </p>
        <button
          onClick={() => router.push(`/trip/${tripId}`)}
          className="px-6 py-3 rounded-lg text-white font-medium text-[14px]"
          style={{ backgroundColor: "#1D9E75" }}
        >
          View your itinerary
        </button>
      </div>
    </div>
  );

  const isCurated = currentDay && (currentDay as Day & { vibe_status?: string }).vibe_status === "curated";
  const isCollab = currentDay && (currentDay as Day & { vibe_status?: string }).vibe_status === "collab";
  const isLocked = currentDay && (currentDay as Day & { vibe_status?: string }).vibe_status === "locked";
  const showBench = isCollab || (isCurated && benchStops.length > 0);

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <h1 className="text-[18px] font-semibold text-gray-900">Vibe planning</h1>
        <span className="text-[14px] text-gray-500 font-medium">{lockedCount} of {days.length} decided</span>
      </div>

      {/* Legend */}
      <div className="px-6 py-2 flex items-center gap-5 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#5DCAA5" }} /><span className="text-[11px] text-gray-500">Curated</span></div>
        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#AFA9EC" }} /><span className="text-[11px] text-gray-500">Collab</span></div>
        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#9FE1CB" }} /><span className="text-[11px] text-gray-500">Locked</span></div>
      </div>

      {/* Day bar */}
      <div className="px-4 py-3 flex gap-2 overflow-x-auto border-b border-gray-100 flex-shrink-0">
        {days.map((day, idx) => {
          const d = day as Day & { vibe_status?: string };
          const status = d.vibe_status || "curated";
          const isActive = idx === activeDay;
          const chipStyle = status === "locked"
            ? { background: "#E1F5EE", borderColor: "#9FE1CB", dotColor: "#9FE1CB" }
            : status === "collab"
            ? { background: "#EEEDFE", borderColor: "#AFA9EC", dotColor: "#AFA9EC" }
            : { background: "#E1F5EE", borderColor: "#5DCAA5", dotColor: "#5DCAA5" };
          return (
            <button key={day.id} onClick={() => { setActiveDay(idx); setBenchStopIds(new Set()); setSelectedVibe(null); }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg whitespace-nowrap flex-shrink-0 transition-all"
              style={{
                background: chipStyle.background,
                border: `${isActive ? 2 : 1}px solid ${chipStyle.borderColor}`,
              }}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: chipStyle.dotColor }} />
              <span className="text-[12px] font-medium text-gray-800">Day {day.day_number}</span>
              {day.title && <span className="text-[11px] text-gray-500">{day.title}</span>}
            </button>
          );
        })}
      </div>

      {/* Three-column layout */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* LEFT — Claude's reasoning */}
          <div className="w-[25%] border-r border-gray-100 flex flex-col overflow-y-auto p-5">
            <p className="text-[11px] text-gray-400 font-medium mb-1">Day {activeDay + 1} of {days.length}</p>
            <h2 className="text-[22px] font-semibold text-gray-900 mb-3">{currentDay?.title || `Day ${activeDay + 1}`}</h2>

            {/* Status badge */}
            {isCurated && <span className="inline-flex self-start px-2.5 py-1 rounded-full text-[11px] font-medium mb-4" style={{ backgroundColor: "#E1F5EE", color: "#085041" }}>Curated</span>}
            {isCollab && <span className="inline-flex self-start px-2.5 py-1 rounded-full text-[11px] font-medium mb-4" style={{ backgroundColor: "#EEEDFE", color: "#534AB7" }}>Collab</span>}
            {isLocked && <span className="inline-flex self-start px-2.5 py-1 rounded-full text-[11px] font-medium mb-4" style={{ backgroundColor: "#E1F5EE", color: "#085041" }}>Locked</span>}

            {/* Mini map */}
            <div className="rounded-lg overflow-hidden mb-4 flex-shrink-0" style={{ height: 160 }}>
              <VibeMap stops={picksStops} dayColor={dayColors[activeDay] || "#1D9E75"} />
            </div>

            {/* My read */}
            {(currentDay as Day & { reasoning?: string })?.reasoning && (
              <div className="mb-4">
                <h3 className="text-[13px] font-semibold text-gray-700 mb-2">My read</h3>
                <div className="text-[12px] text-gray-600 leading-relaxed chat-markdown">
                  <ReactMarkdown>{(currentDay as Day & { reasoning?: string }).reasoning || ""}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* Anchors (curated only) */}
            {isCurated && anchors.length > 0 && (
              <div className="mb-4">
                <h3 className="text-[13px] font-semibold text-gray-700 mb-2">Anchors</h3>
                <div className="flex flex-col gap-2">
                  {anchors.map(s => (
                    <div key={s.id} className="rounded-lg p-2.5 border-l-[3px]" style={{ borderColor: "#1D9E75", backgroundColor: "#f8fffe" }}>
                      <p className="text-[12px] font-medium text-gray-900">{s.name}</p>
                      {s.description && <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{s.description}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Vibe buttons (collab only) */}
            {isCollab && (
              <div className="mb-4">
                <h3 className="text-[13px] font-semibold text-gray-700 mb-2">What&apos;s this day&apos;s vibe?</h3>
                <div className="flex flex-wrap gap-1.5">
                  {vibeButtons.map(vibe => {
                    const isSelected = selectedVibe === vibe;
                    return (
                      <button key={vibe}
                        onClick={() => handleVibeSelect(vibe)}
                        disabled={vibeLoading}
                        className="px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors disabled:opacity-50"
                        style={isSelected
                          ? { backgroundColor: "#EEEDFE", border: "1.5px solid #534AB7", color: "#534AB7" }
                          : { backgroundColor: "white", border: "1.5px solid #d1d5db", color: "#6b7280" }
                        }
                      >
                        {vibe}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Chat area */}
            <div className="flex-1 flex flex-col min-h-0 mt-2">
              {chatMessages.length > 0 && (
                <div className="flex-1 overflow-y-auto mb-2 min-h-0">
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`mb-2 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      {msg.role === "user" ? (
                        <div className="max-w-[90%] rounded-lg px-2.5 py-1.5 bg-emerald-500 text-white text-[12px] leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                      ) : (
                        <div className="max-w-[90%] rounded-lg px-2.5 py-1.5 bg-gray-100 text-gray-800 text-[12px] leading-relaxed chat-markdown">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  ))}
                  {isThinking && (
                    <div className="mb-2 flex justify-start">
                      <div className="bg-gray-100 rounded-lg px-2.5 py-1.5 text-[11px] text-gray-500 flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
              <div className="flex gap-1.5 flex-shrink-0">
                <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                  placeholder="Ask Claude..."
                  className="flex-1 text-[12px] px-3 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200"
                  onKeyDown={e => e.key === "Enter" && handleChatSend()}
                  disabled={isThinking} />
                <button onClick={() => handleChatSend()} disabled={isThinking || !chatInput.trim()}
                  className="px-3 py-2 rounded-lg bg-emerald-500 text-white text-[11px] font-medium disabled:opacity-50">
                  Send
                </button>
              </div>
            </div>
          </div>

          {/* CENTER — Claude's picks */}
          <div className="w-[40%] flex flex-col overflow-hidden" style={{ border: "1.5px solid #1D9E75" }}>
            <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-gray-700">
                  {selectedVibe ? selectedVibe : isCurated ? "Claude\u2019s picks" : "Picks"}
                </span>
                {vibeLoading && <span className="w-3 h-3 border-2 border-gray-200 border-t-emerald-500 rounded-full animate-spin" />}
              </div>
              <button onClick={handleRefresh} disabled={vibeLoading}
                className="text-[11px] text-gray-500 hover:text-gray-700 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors disabled:opacity-50">
                ↻ Refresh
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              <SortableContext items={picksStops.map(s => s.id)} strategy={verticalListSortingStrategy}>
                {groupedPicks.map(group => (
                  <div key={group.period} className="mb-4">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{group.period}</p>
                    <div className="flex flex-col gap-2">
                      {group.stops.map(stop => (
                        <SortableStopCard key={stop.id} stop={stop} />
                      ))}
                    </div>
                  </div>
                ))}
              </SortableContext>
              {picksStops.length === 0 && (
                <div className="text-center py-10 text-gray-400 text-[13px]">
                  {vibeLoading ? "Reshuffling stops..." : "Select a vibe to see picks"}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="px-4 py-3 border-t border-gray-100 flex-shrink-0 flex flex-col gap-2">
              {isCurated && (
                <>
                  <button onClick={() => currentDay && lockDay(currentDay.id)}
                    className="w-full py-2.5 rounded-lg text-white text-[13px] font-medium"
                    style={{ backgroundColor: "#1D9E75" }}>
                    Looks good — lock it in
                  </button>
                  <button onClick={() => currentDay && vibeThisDay(currentDay.id)}
                    className="w-full py-2.5 rounded-lg text-[13px] font-medium text-gray-500"
                    style={{ border: "1.5px dashed #d1d5db" }}>
                    Vibe this day
                  </button>
                </>
              )}
              {isCollab && (
                <button onClick={() => currentDay && lockDay(currentDay.id)}
                  className="w-full py-2.5 rounded-lg text-white text-[13px] font-medium"
                  style={{ backgroundColor: "#1D9E75" }}>
                  Love it — lock this day in
                </button>
              )}
              {isLocked && (
                <div className="text-center py-2 text-[12px] text-gray-400 flex items-center justify-center gap-1.5">
                  <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Day locked
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — On the bench */}
          <div className="w-[35%] flex flex-col overflow-hidden" style={{ borderLeft: showBench ? "1px dashed #d1d5db" : "1px solid #e5e7eb" }}>
            {showBench ? (
              <>
                <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 flex-shrink-0">
                  <span className="text-[13px] font-medium text-gray-500">On the bench</span>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3">
                  <SortableContext items={[...benchStops.map(s => s.id), "bench-droppable"]} strategy={verticalListSortingStrategy}>
                    {benchStops.map(stop => (
                      <div key={stop.id} className="mb-2">
                        <SortableStopCard stop={stop} isBench />
                      </div>
                    ))}
                    {benchStops.length === 0 && (
                      <div className="text-center py-10 text-gray-400 text-[12px]">
                        Drag stops here to bench them, or Claude will populate alternatives when you pick a vibe.
                      </div>
                    )}
                  </SortableContext>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <p className="text-[13px] text-gray-500 mb-1">Lock this day or click &ldquo;Vibe this day&rdquo;</p>
                <p className="text-[11px] text-gray-400">to see alternatives</p>
              </div>
            )}
          </div>
        </div>

        <DragOverlay>
          {draggedStop ? <DragOverlayCard stop={draggedStop} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
