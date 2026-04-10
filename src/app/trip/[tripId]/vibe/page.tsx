"use client";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getMemberForTrip } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { askClaude, executeToolCall } from "@/lib/claude";
import ReactMarkdown from "react-markdown";
import TripLayout from "@/components/TripLayout";
import type { Trip, TripMember, Day, Stop } from "@/lib/database.types";
import { extractRouteCities, isMultiCityTrip, type RouteCity } from "@/lib/routeCities";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCenter, useDroppable,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const VibeMap = dynamic(() => import("./VibeMap"), { ssr: false, loading: () => <div className="w-full h-full bg-gray-100" /> });
const RegionalMap = dynamic(() => import("../RegionalMap"), { ssr: false, loading: () => (
  <div className="w-full bg-gray-100" style={{ height: 209 }} />
)});

// Multi-city helpers live in src/lib/routeCities.ts and are imported above.

type VibeDay = Day & { vibe_status?: string | null; reasoning?: string | null };
type VibeTrip = Trip & { trip_summary?: string | null };
type VibeStop = Stop & { ai_note?: string | null; on_bench?: boolean | null };

interface OptionStop {
  name: string;
  stop_type?: string;
  duration_minutes?: number;
  latitude?: number;
  longitude?: number;
  ai_note?: string;
}
interface OptionItem {
  label: string;
  summary: string;
  stops: OptionStop[];
}
interface OptionsPayload {
  options: OptionItem[];
}

const OPTIONS_SYSTEM_HINT = `When the user asks for other options or you want to present multiple day plan alternatives, respond with a JSON block wrapped in \`\`\`options\`\`\` markers (no other code fence type):

\`\`\`options
{
  "options": [
    {
      "label": "Short option name",
      "summary": "One-line summary of this option",
      "stops": [
        {"name": "Place", "stop_type": "food|visit|walking|experience", "duration_minutes": 60, "latitude": 0, "longitude": 0, "ai_note": "Why this stop"}
      ]
    }
  ]
}
\`\`\`

Provide 2-3 options. Each option should have 4-6 stops with realistic coordinates. Always include this options block when the user asks for other options, alternatives, or different choices for the day.`;

const SOURCE_BORDER = ["#3B82F6", "#EC4899", "#A855F7", "#F59E0B"];
const SOURCE_BG = ["#DBEAFE", "#FCE7F3", "#F3E8FF", "#FEF3C7"];
const SOURCE_LABELS = ["A", "B", "C", "D"];

function generateDayColors(count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return ["hsl(145, 55%, 33%)"];
  const H = [145, 165, 180, 195, 220, 250, 280, 310], S = [55, 60, 55, 50, 55, 50, 50, 45], L = [33, 38, 40, 42, 42, 40, 38, 38];
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1), idx = t * (H.length - 1), lo = Math.floor(idx), hi = Math.min(lo + 1, H.length - 1), f = idx - lo;
    return `hsl(${Math.round(H[lo] + (H[hi] - H[lo]) * f)}, ${Math.round(S[lo] + (S[hi] - S[lo]) * f)}%, ${Math.round(L[lo] + (L[hi] - L[lo]) * f)}%)`;
  });
}

function formatTime12(time: string | null): string {
  if (!time) return "TBD";
  const parts = time.slice(0, 5).split(":");
  let h = parseInt(parts[0], 10);
  const m = parts[1] || "00";
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

const LOCKED_PREFIX = "__LOCKED__:";

interface StopRowProps {
  sortableId: string;
  name: string;
  stopType?: string | null;
  durationMinutes?: number;
  startTime?: string | null;
  dayColor: string;
  isHighlighted?: boolean;
  isAdded?: boolean;
  compact?: boolean;
  showTime?: boolean;
  onClick?: () => void;
}

function SortableStopRow(props: StopRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: props.sortableId });
  const style: React.CSSProperties = {
    transform: isDragging
      ? `${CSS.Transform.toString(transform) || ""} scale(1.02)`
      : CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : (props.isAdded ? 0.45 : 1),
    border: isDragging ? "1.5px solid #534AB7" : "1.5px solid transparent",
    borderRadius: isDragging ? 6 : 0,
    backgroundColor: isDragging ? "white" : undefined,
    boxShadow: isDragging ? "0 4px 12px rgba(83, 74, 183, 0.18)" : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: "relative",
  };
  const padClass = props.compact ? "py-1.5" : "py-2.5";
  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={props.onClick}
      className="flex items-stretch border-b border-gray-100 cursor-pointer transition-colors"
    >
      {isOver && !isDragging && (
        <div
          className="absolute left-0 right-0 pointer-events-none"
          style={{ top: -1, height: 2, backgroundColor: "#534AB7", zIndex: 5 }}
        />
      )}
      <div
        className="flex-shrink-0 flex items-center justify-center text-gray-300 hover:text-gray-500"
        style={{ width: 18, cursor: isDragging ? "grabbing" : "grab" }}
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
          <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
          <circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" />
          <circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" />
        </svg>
      </div>
      <div className="flex-shrink-0" style={{ width: 4, backgroundColor: props.dayColor }} />
      <div
        className={`flex-1 min-w-0 px-3 ${padClass} flex items-start gap-2`}
        style={{ backgroundColor: props.isHighlighted ? "#f9fafb" : "transparent" }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[18px] font-medium text-gray-900 truncate leading-tight">{props.name}</div>
          <div className="text-[15px] text-gray-500 mt-0.5 truncate">
            {props.stopType || "visit"} · {props.durationMinutes || 60} min
            {props.isAdded && <span className="ml-1.5 text-emerald-600 font-semibold">· Added</span>}
          </div>
        </div>
        {props.showTime && props.startTime && (
          <div className="text-[15px] text-gray-400 whitespace-nowrap pt-0.5">{formatTime12(props.startTime)}</div>
        )}
      </div>
    </div>
  );
}

function StopRowOverlay({
  name,
  stopType,
  durationMinutes,
  dayColor,
  compact,
}: {
  name: string;
  stopType?: string | null;
  durationMinutes?: number;
  dayColor: string;
  compact?: boolean;
}) {
  const padClass = compact ? "py-1.5" : "py-2.5";
  return (
    <div
      className="flex items-stretch bg-white"
      style={{
        width: 280,
        borderRadius: 6,
        border: "1.5px solid #534AB7",
        boxShadow: "0 6px 16px rgba(83,74,183,0.25)",
        opacity: 0.95,
      }}
    >
      <div className="flex-shrink-0 flex items-center justify-center text-gray-400" style={{ width: 18 }}>
        <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
          <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
          <circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" />
          <circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" />
        </svg>
      </div>
      <div className="flex-shrink-0" style={{ width: 4, backgroundColor: dayColor }} />
      <div className={`flex-1 min-w-0 px-3 ${padClass}`}>
        <div className="text-[18px] font-medium text-gray-900 truncate leading-tight">{name}</div>
        <div className="text-[15px] text-gray-500 mt-0.5 truncate">{stopType || "visit"} · {durationMinutes || 60} min</div>
      </div>
    </div>
  );
}

function DroppableZone({
  id,
  children,
  className,
  style,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={className}
      style={{
        ...style,
        outline: isOver ? "1.5px solid #534AB7" : "1.5px solid transparent",
        outlineOffset: -1,
        borderRadius: 6,
        transition: "outline-color 0.15s",
      }}
    >
      {children}
    </div>
  );
}

type ParsedDragId =
  | { type: "day-stop"; id: string }
  | { type: "option-stop"; optIdx: number; stopIdx: number }
  | { type: "day-zone" }
  | { type: "option-zone"; optIdx: number };

function parseDragId(id: string): ParsedDragId {
  if (id === "day-stops") return { type: "day-zone" };
  const optZone = id.match(/^option-(\d+)$/);
  if (optZone) return { type: "option-zone", optIdx: parseInt(optZone[1], 10) };
  const optStop = id.match(/^opt-(\d+)-(\d+)$/);
  if (optStop) return { type: "option-stop", optIdx: parseInt(optStop[1], 10), stopIdx: parseInt(optStop[2], 10) };
  return { type: "day-stop", id };
}

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
  const [highlightedStopId, setHighlightedStopId] = useState<string | null>(null);
  const [pulsingStopId, setPulsingStopId] = useState<string | null>(null);
  const [allTrips, setAllTrips] = useState<Trip[]>([]);

  // Options overlay — keyed by day_id so each day keeps its own options
  // Persisted to localStorage so options survive refresh and day switches
  const [optionsByDay, setOptionsByDay] = useState<Record<string, OptionsPayload>>({});
  // selectedOption: -1 = curated (current day stops), 0..N = option index
  const [selectedOption, setSelectedOption] = useState<number>(-1);
  const [cherryPickMode, setCherryPickMode] = useState(false);
  const [cherryPicks, setCherryPicks] = useState<Set<string>>(new Set());
  // Map view mode when options are present: "all" shows curated + every option, "selected" shows only the focused source
  const [optionsViewMode, setOptionsViewMode] = useState<"all" | "selected">("all");
  const optionsStorageKey = `vibe_options_${tripId}`;

  const chatEndRef = useRef<HTMLDivElement>(null);

  const dayColors = useMemo(() => generateDayColors(days.length), [days.length]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    async function load() {
      const member = await getMemberForTrip(tripId);
      if (!member) { router.replace(`/trip/${tripId}/invite`); return; }
      setCurrentMember(member);
      const [tripRes, daysRes, stopsRes, allTripsRes] = await Promise.all([
        supabase.from("trips").select("*").eq("id", tripId).maybeSingle(),
        supabase.from("days").select("*").eq("trip_id", tripId).order("day_number"),
        supabase.from("stops").select("*").eq("trip_id", tripId).order("sort_order"),
        supabase.from("trips").select("*").order("updated_at", { ascending: false }),
      ]);
      if (tripRes.data) setTrip(tripRes.data as VibeTrip);
      if (daysRes.data) setDays(daysRes.data as VibeDay[]);
      if (stopsRes.data) setStops(stopsRes.data as VibeStop[]);
      if (allTripsRes.data) setAllTrips(allTripsRes.data as Trip[]);
      setLoading(false);
    }
    load();
  }, [tripId, router]);

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

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, isThinking]);

  const currentDay = days[activeDay] as VibeDay | undefined;
  const allStopsForDay = useMemo(
    () => currentDay ? stops.filter(s => s.day_id === currentDay.id).sort((a, b) => a.sort_order - b.sort_order) : [],
    [currentDay, stops]
  );
  const picksStops = useMemo(() => allStopsForDay.filter(s => !s.on_bench), [allStopsForDay]);
  const isCurated = currentDay?.vibe_status === "curated";
  const isCollab = currentDay?.vibe_status === "collab";
  const isLocked = currentDay?.vibe_status === "locked";
  const dayColor = dayColors[activeDay] || "#1D9E75";
  const optionsData: OptionsPayload | null = currentDay ? optionsByDay[currentDay.id] || null : null;

  // Load persisted options on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(optionsStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") setOptionsByDay(parsed);
      }
    } catch { /* ignore */ }
  }, [optionsStorageKey]);

  // Persist options whenever they change
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (Object.keys(optionsByDay).length === 0) {
        window.localStorage.removeItem(optionsStorageKey);
      } else {
        window.localStorage.setItem(optionsStorageKey, JSON.stringify(optionsByDay));
      }
    } catch { /* ignore */ }
  }, [optionsByDay, optionsStorageKey]);

  const vibeButtons = useMemo(() => {
    if (!trip) return [];
    const pills: string[] = ["Slow morning", "Hidden gems", "Off the beaten path"];
    const gt = (trip.group_type || "").toLowerCase(), gd = (trip.group_detail || "").toLowerCase();
    const int = (trip.interests || "").toLowerCase(), notes = (trip.extra_notes || "").toLowerCase();
    if (gt === "family" && gd.match(/kid|child|toddler|teen|baby/)) { pills.unshift("Kid energy burn"); pills.push("Stroller-friendly"); }
    if (int.match(/food|cook|cuisine/)) { pills.unshift("Foodie deep dive"); }
    if (int.match(/history|culture|museum/)) pills.push("History nerd mode");
    if (notes.match(/dog|pet/)) pills.push("Dog-friendly");
    if (int.match(/outdoor|hike|nature/)) pills.push("Outdoors");
    return pills;
  }, [trip]);

  // Map preview stops: when options are present, the view mode controls which sources are pinned
  const previewMapStops: VibeStop[] = useMemo(() => {
    if (!optionsData) return picksStops;
    if (cherryPickMode) {
      const flat: VibeStop[] = [];
      optionsData.options.forEach((opt, optIdx) => {
        opt.stops.forEach((s, stopIdx) => {
          const key = `${optIdx}-${stopIdx}`;
          if (cherryPicks.has(key)) flat.push(optionStopToVibeStop(s, key));
        });
      });
      return flat;
    }
    if (optionsViewMode === "all") {
      const flat: VibeStop[] = [...picksStops];
      optionsData.options.forEach((opt, optIdx) => {
        opt.stops.forEach((s, i) => flat.push(optionStopToVibeStop(s, `prev-${optIdx}-${i}`)));
      });
      return flat;
    }
    // selected mode
    if (selectedOption === -1) return picksStops;
    const opt = optionsData.options[selectedOption];
    if (!opt) return picksStops;
    return opt.stops.map((s, i) => optionStopToVibeStop(s, `prev-${selectedOption}-${i}`));
  }, [optionsData, optionsViewMode, selectedOption, cherryPickMode, cherryPicks, picksStops]);

  // Per-stop colors so curated and each option get distinct pin colors
  const previewStopColors: Record<string, string> = useMemo(() => {
    const colors: Record<string, string> = {};
    if (!optionsData) return colors;
    // Curated stops use the day color
    picksStops.forEach(s => { colors[s.id] = dayColor; });
    // Each option uses its source color
    optionsData.options.forEach((opt, optIdx) => {
      const c = SOURCE_BORDER[optIdx % SOURCE_BORDER.length];
      opt.stops.forEach((_, i) => {
        colors[`prev-${optIdx}-${i}`] = c;
        colors[`${optIdx}-${i}`] = c; // cherry-pick id pattern
      });
    });
    return colors;
  }, [optionsData, picksStops, dayColor]);

  // Multi-city route data — drives the regional map strip above the local map (parity with dashboard)
  const multiCity = useMemo(() => isMultiCityTrip(stops), [stops]);
  const routeData = useMemo(
    () => multiCity ? extractRouteCities(stops, days) : { cities: [] as RouteCity[], dayToCityIndex: new Map<number, number>() },
    [stops, days, multiCity]
  );
  const routeCities = routeData.cities;
  const dayToCityIndex = routeData.dayToCityIndex;
  const activeCityIndex = dayToCityIndex.get(activeDay) ?? -1;
  const allCoordStops = useMemo(
    () => stops.filter(s => s.latitude && s.longitude && s.stop_type !== "transit"),
    [stops]
  );

  function optionStopToVibeStop(s: OptionStop, id: string): VibeStop {
    return {
      id,
      trip_id: tripId,
      day_id: currentDay?.id || "",
      name: s.name,
      stop_type: s.stop_type || "visit",
      duration_minutes: s.duration_minutes || 60,
      latitude: s.latitude ?? null,
      longitude: s.longitude ?? null,
      sort_order: 0,
      start_time: null,
      ai_note: s.ai_note ?? null,
    } as unknown as VibeStop;
  }

  async function reloadDays() {
    const { data } = await supabase.from("days").select("*").eq("trip_id", tripId).order("day_number");
    if (data) setDays(data as VibeDay[]);
    return data as VibeDay[] | null;
  }
  async function reloadStops() {
    const { data } = await supabase.from("stops").select("*").eq("trip_id", tripId).order("sort_order");
    if (data) setStops(data as VibeStop[]);
  }

  function pushLockedMessage(day: VibeDay) {
    setChatMessages(prev => [
      ...prev,
      { role: "assistant", content: `${LOCKED_PREFIX}Day ${day.day_number}${day.title ? ` — ${day.title}` : ""}` },
    ]);
  }

  async function lockDay(dayId: string) {
    await supabase.from("days").update({ vibe_status: "locked" }).eq("id", dayId);
    const updated = await reloadDays();
    const lockedDay = updated?.find(d => d.id === dayId);
    if (lockedDay) pushLockedMessage(lockedDay);
    if (updated) {
      const next = updated.findIndex((d, i) => i > activeDay && d.vibe_status !== "locked");
      if (next >= 0) {
        setActiveDay(next);
        setSelectedVibe(null);
        setHighlightedStopId(null);
      }
    }
  }
  async function unlockDay(dayId: string) {
    await supabase.from("days").update({ vibe_status: "collab" }).eq("id", dayId);
    await reloadDays();
  }

  function dismissOptions() {
    if (currentDay) {
      setOptionsByDay(prev => {
        if (!(currentDay.id in prev)) return prev;
        const next = { ...prev };
        delete next[currentDay.id];
        return next;
      });
    }
    setSelectedOption(-1);
    setOptionsViewMode("all");
    setCherryPickMode(false);
    setCherryPicks(new Set());
  }

  async function goWithOption(optIdx: number) {
    if (!currentDay || !optionsData) return;
    const opt = optionsData.options[optIdx];
    if (!opt) return;
    await supabase.from("stops").delete().eq("day_id", currentDay.id);
    let order = 0;
    for (const s of opt.stops) {
      await supabase.from("stops").insert({
        trip_id: tripId,
        day_id: currentDay.id,
        name: s.name,
        stop_type: s.stop_type || "visit",
        duration_minutes: s.duration_minutes || 60,
        latitude: s.latitude ?? null,
        longitude: s.longitude ?? null,
        sort_order: order++,
      });
    }
    await supabase.from("days").update({ vibe_status: "locked" }).eq("id", currentDay.id);
    const updated = await reloadDays();
    await reloadStops();
    const lockedDay = updated?.find(d => d.id === currentDay.id);
    if (lockedDay) pushLockedMessage(lockedDay);
    dismissOptions();
  }

  async function lockInPicks() {
    if (!currentDay || !optionsData) return;
    await supabase.from("stops").delete().eq("day_id", currentDay.id);
    let order = 0;
    for (let optIdx = 0; optIdx < optionsData.options.length; optIdx++) {
      const opt = optionsData.options[optIdx];
      for (let stopIdx = 0; stopIdx < opt.stops.length; stopIdx++) {
        const key = `${optIdx}-${stopIdx}`;
        if (!cherryPicks.has(key)) continue;
        const s = opt.stops[stopIdx];
        await supabase.from("stops").insert({
          trip_id: tripId,
          day_id: currentDay.id,
          name: s.name,
          stop_type: s.stop_type || "visit",
          duration_minutes: s.duration_minutes || 60,
          latitude: s.latitude ?? null,
          longitude: s.longitude ?? null,
          sort_order: order++,
        });
      }
    }
    await supabase.from("days").update({ vibe_status: "locked" }).eq("id", currentDay.id);
    const updated = await reloadDays();
    await reloadStops();
    const lockedDay = updated?.find(d => d.id === currentDay.id);
    if (lockedDay) pushLockedMessage(lockedDay);
    dismissOptions();
  }

  async function handleChatSend(message?: string) {
    const text = message || chatInput.trim();
    if (!text || isThinking) return;
    const userMsg = { role: "user" as const, content: text };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setIsThinking(true);
    const dayCtx = currentDay
      ? `Viewing Day ${currentDay.day_number}${currentDay.title ? ` — ${currentDay.title}` : ""}. ${selectedVibe ? `Vibe: "${selectedVibe}".` : ""}`
      : "";
    const ctx = `${dayCtx}\n\n${OPTIONS_SYSTEM_HINT}`;
    const result = await askClaude({
      tripId,
      messages: [...chatMessages, userMsg].slice(-20),
      systemContext: ctx,
    });
    for (const tc of result.toolCalls) await executeToolCall(tripId, tc);
    if (result.toolCalls.length > 0) await reloadStops();

    const optionsMatch = result.text.match(/```options\s*([\s\S]*?)```/);
    if (optionsMatch && currentDay) {
      try {
        const parsed = JSON.parse(optionsMatch[1]);
        if (parsed && Array.isArray(parsed.options) && parsed.options.length > 0) {
          const dayId = currentDay.id;
          setOptionsByDay(prev => ({ ...prev, [dayId]: parsed as OptionsPayload }));
          setSelectedOption(0);
          setOptionsViewMode("all");
          setCherryPickMode(false);
          setCherryPicks(new Set());
        }
      } catch {
        /* parse failed, fall through */
      }
    }

    const displayText = result.text.replace(/```options[\s\S]*?```/g, "").trim();
    if (displayText) setChatMessages(prev => [...prev, { role: "assistant", content: displayText }]);
    setIsThinking(false);
  }

  function handleVibePillClick(vibe: string) {
    setSelectedVibe(vibe);
    handleChatSend(`Vibe this day toward: ${vibe}`);
  }

  function handleShowOptions() {
    handleChatSend("Show me other options for this day");
  }

  function handleDragStart(e: DragStartEvent) { setDragActiveId(e.active.id as string); }
  async function handleDragEnd(e: DragEndEvent) {
    setDragActiveId(null);
    const { active, over } = e;
    if (!over || !currentDay) return;
    const activeParsed = parseDragId(active.id as string);
    const overParsed = parseDragId(over.id as string);

    // option stop → day-stops zone or any day stop = add to working day
    if (activeParsed.type === "option-stop" && (overParsed.type === "day-zone" || overParsed.type === "day-stop")) {
      let insertIdx = picksStops.length;
      if (overParsed.type === "day-stop") {
        const idx = picksStops.findIndex(s => s.id === overParsed.id);
        if (idx >= 0) insertIdx = idx;
      }
      await addOptionStopToDay(activeParsed.optIdx, activeParsed.stopIdx, insertIdx);
      return;
    }

    // day stop → option zone or option stop = remove from working day
    if (activeParsed.type === "day-stop" && (overParsed.type === "option-zone" || overParsed.type === "option-stop")) {
      await removeDayStopById(activeParsed.id);
      return;
    }

    // day stop → day stop = reorder within day
    if (activeParsed.type === "day-stop" && overParsed.type === "day-stop" && active.id !== over.id) {
      const oldIdx = picksStops.findIndex(s => s.id === activeParsed.id);
      const newIdx = picksStops.findIndex(s => s.id === overParsed.id);
      if (oldIdx < 0 || newIdx < 0) return;
      const reordered = [...picksStops];
      const [moved] = reordered.splice(oldIdx, 1);
      reordered.splice(newIdx, 0, moved);
      setStops(prev => prev.map(s => {
        const idx = reordered.findIndex(r => r.id === s.id);
        if (idx >= 0) return { ...s, sort_order: idx };
        return s;
      }));
      for (let i = 0; i < reordered.length; i++) {
        await supabase.from("stops").update({ sort_order: i }).eq("id", reordered[i].id);
      }
      return;
    }

    // option-stop → option-stop or option-zone = no-op (options are read-only)
  }

  async function addOptionStopToDay(optIdx: number, stopIdx: number, insertIdx: number) {
    if (!currentDay || !optionsData) return;
    const optStop = optionsData.options[optIdx]?.stops[stopIdx];
    if (!optStop) return;
    // Bump sort_order of stops at >= insertIdx
    for (const s of picksStops) {
      if (s.sort_order >= insertIdx) {
        await supabase.from("stops").update({ sort_order: s.sort_order + 1 }).eq("id", s.id);
      }
    }
    await supabase.from("stops").insert({
      trip_id: tripId,
      day_id: currentDay.id,
      name: optStop.name,
      stop_type: optStop.stop_type || "visit",
      duration_minutes: optStop.duration_minutes || 60,
      latitude: optStop.latitude ?? null,
      longitude: optStop.longitude ?? null,
      sort_order: insertIdx,
    });
    await reloadStops();
  }

  async function removeDayStopById(stopId: string) {
    await supabase.from("stops").delete().eq("id", stopId);
    await reloadStops();
  }

  // Names of stops already added to the working day, used to mark option rows
  const addedOptionNames = useMemo(() => {
    const set = new Set<string>();
    picksStops.forEach(s => set.add(s.name.toLowerCase().trim()));
    return set;
  }, [picksStops]);

  // Look up the dragged item's display info for the DragOverlay
  const draggedRender = useMemo(() => {
    if (!dragActiveId) return null;
    const parsed = parseDragId(dragActiveId);
    if (parsed.type === "day-stop") {
      const s = stops.find(x => x.id === parsed.id);
      if (!s) return null;
      return { name: s.name, stopType: s.stop_type, durationMinutes: s.duration_minutes, compact: false };
    }
    if (parsed.type === "option-stop" && optionsData) {
      const s = optionsData.options[parsed.optIdx]?.stops[parsed.stopIdx];
      if (!s) return null;
      return { name: s.name, stopType: s.stop_type, durationMinutes: s.duration_minutes, compact: true };
    }
    return null;
  }, [dragActiveId, stops, optionsData]);

  function toggleCherryPick(key: string) {
    setCherryPicks(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function highlightStop(id: string | null) {
    if (id === null) {
      setHighlightedStopId(null);
      return;
    }
    setHighlightedStopId(prev => prev === id ? null : id);
    setPulsingStopId(id);
    setTimeout(() => setPulsingStopId(p => p === id ? null : p), 800);
  }

  function highlightOptionStop(optIdx: number, stopIdx: number) {
    if (selectedOption !== optIdx) {
      setSelectedOption(optIdx);
      setCherryPickMode(false);
    }
    const id = `prev-${optIdx}-${stopIdx}`;
    setHighlightedStopId(id);
    setPulsingStopId(id);
    setTimeout(() => setPulsingStopId(p => p === id ? null : p), 800);
  }

  // ---------- Render functions ----------
  const renderLeftPanel = () => {
    if (!currentDay) {
      return <div className="px-4 py-10 text-center text-gray-400 text-[11px]">No days yet</div>;
    }

    if (cherryPickMode && optionsData) {
      const allOptionStops: { key: string; stop: OptionStop; sourceIdx: number }[] = [];
      optionsData.options.forEach((opt, optIdx) => {
        opt.stops.forEach((stop, stopIdx) => {
          allOptionStops.push({ key: `${optIdx}-${stopIdx}`, stop, sourceIdx: optIdx });
        });
      });
      return (
        <>
          <div
            className="sticky top-0 z-10 bg-white px-3 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-shrink-0"
            style={{ borderBottomWidth: 0.5 }}
          >
            <div className="text-[12px] font-semibold text-gray-900">Your picks</div>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-medium"
              style={{ backgroundColor: "#EEEDFE", color: "#534AB7" }}
            >
              Building custom
            </span>
          </div>
          <div className="flex flex-col">
            {allOptionStops.map(({ key, stop, sourceIdx }) => {
              const checked = cherryPicks.has(key);
              const isHL = highlightedStopId === key;
              return (
                <div
                  key={key}
                  onClick={() => {
                    toggleCherryPick(key);
                    highlightStop(key);
                  }}
                  className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 cursor-pointer hover:bg-gray-50"
                  style={{
                    opacity: checked ? 1 : 0.35,
                    borderBottomWidth: 0.5,
                    backgroundColor: isHL ? "#f9fafb" : "transparent",
                  }}
                >
                  <div
                    className="flex-shrink-0 flex items-center justify-center"
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      backgroundColor: checked ? "#1D9E75" : "transparent",
                      border: checked ? "1px solid #1D9E75" : "1.5px solid #d1d5db",
                    }}
                  >
                    {checked && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={4}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span
                    className="flex-shrink-0 px-1.5 rounded text-[9px] font-bold"
                    style={{
                      backgroundColor: SOURCE_BG[sourceIdx % SOURCE_BG.length],
                      color: SOURCE_BORDER[sourceIdx % SOURCE_BORDER.length],
                    }}
                  >
                    {SOURCE_LABELS[sourceIdx % SOURCE_LABELS.length]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[18px] font-medium text-gray-900 truncate">{stop.name}</div>
                    <div className="text-[15px] text-gray-500 truncate">
                      {stop.stop_type || "visit"} · {stop.duration_minutes || 60} min
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-3 py-3 mt-auto border-t border-gray-100 flex flex-col gap-2 flex-shrink-0" style={{ borderTopWidth: 0.5 }}>
            <button
              onClick={lockInPicks}
              disabled={cherryPicks.size === 0}
              className="w-full py-2 rounded-lg text-white text-[12px] font-medium disabled:opacity-50"
              style={{ backgroundColor: "#1D9E75" }}
            >
              Lock in picks ({cherryPicks.size})
            </button>
            <button
              onClick={() => setCherryPicks(new Set())}
              className="w-full text-[10px] text-gray-500 hover:text-gray-700 transition-colors"
            >
              Clear all
            </button>
          </div>
        </>
      );
    }

    const optionsActive = optionsData !== null;
    const curatedSelected = optionsActive && selectedOption === -1 && !cherryPickMode;
    return (
      <>
        <div
          className="sticky top-0 z-10 bg-white px-3 py-3 border-b border-gray-100 flex-shrink-0"
          style={{
            borderBottomWidth: 0.5,
            borderLeft: curatedSelected ? `3px solid ${dayColor}` : "3px solid transparent",
            backgroundColor: curatedSelected ? "#FAFFFD" : "white",
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <button
              onClick={() => {
                if (!optionsActive) return;
                setSelectedOption(-1);
                setCherryPickMode(false);
              }}
              title={optionsActive ? "Show curated stops on the map" : undefined}
              className="text-[12px] font-semibold text-gray-900 leading-tight flex-1 min-w-0 truncate text-left"
              style={{
                cursor: optionsActive ? "pointer" : "default",
                color: curatedSelected ? dayColor : undefined,
                textDecoration: optionsActive && !curatedSelected ? "underline dotted #cbd5e1" : "none",
                textUnderlineOffset: 3,
              }}
            >
              Day {currentDay.day_number}{currentDay.title ? ` — ${currentDay.title}` : ""}
            </button>
            {isCurated && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0" style={{ backgroundColor: "#E1F5EE", color: "#0F6E56" }}>
                Curated
              </span>
            )}
            {isCollab && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0" style={{ backgroundColor: "#EEEDFE", color: "#534AB7" }}>
                Collab
              </span>
            )}
            {isLocked && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 inline-flex items-center gap-1" style={{ backgroundColor: "#E1F5EE", color: "#0F6E56" }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Locked
              </span>
            )}
          </div>
          {currentDay.narrative && (
            <div className="text-[19px] text-gray-500 leading-[1.5] line-clamp-3">{currentDay.narrative}</div>
          )}
          {currentDay.reasoning && (
            <div className="text-[19px] text-gray-400 italic leading-[1.5] mt-1.5 line-clamp-3">
              {currentDay.reasoning}
            </div>
          )}
        </div>

        <DroppableZone id="day-stops" className="flex flex-col" style={{ minHeight: 60 }}>
          <SortableContext items={picksStops.map(s => s.id)} strategy={verticalListSortingStrategy}>
            {picksStops.length === 0 ? (
              <div className="px-3 py-10 text-center text-gray-400 text-[11px]">Drag a stop here, or no stops yet</div>
            ) : (
              picksStops.map(stop => (
                <SortableStopRow
                  key={stop.id}
                  sortableId={stop.id}
                  name={stop.name}
                  stopType={stop.stop_type}
                  durationMinutes={stop.duration_minutes}
                  startTime={stop.start_time}
                  dayColor={dayColor}
                  isHighlighted={highlightedStopId === stop.id}
                  showTime
                  onClick={() => highlightStop(stop.id)}
                />
              ))
            )}
          </SortableContext>
        </DroppableZone>

          {(isCurated || isCollab) && (
            <div className="flex gap-1.5 px-3 py-2.5 flex-shrink-0">
              <button
                onClick={() => currentDay && lockDay(currentDay.id)}
                className="flex-1 py-1.5 rounded-md text-white text-[11px] font-medium"
                style={{ backgroundColor: "#1D9E75" }}
              >
                {isCurated ? "Looks good" : "Love it"}
              </button>
              <button
                onClick={handleShowOptions}
                disabled={isThinking}
                className="flex-1 py-1.5 rounded-md text-[11px] font-medium border border-dashed transition-colors hover:bg-purple-50 disabled:opacity-50"
                style={{ borderColor: "#A89BF1", color: "#534AB7" }}
              >
                Other options
              </button>
            </div>
          )}

        {isLocked && (
          <div className="px-3 py-3 mt-auto border-t border-gray-100 flex flex-col gap-2 flex-shrink-0" style={{ borderTopWidth: 0.5 }}>
            <button
              onClick={() => currentDay && unlockDay(currentDay.id)}
              className="w-full py-2 rounded-lg text-[12px] font-medium border transition-colors hover:bg-purple-50"
              style={{ borderColor: "#534AB7", color: "#534AB7" }}
            >
              Vibe this day
            </button>
          </div>
        )}
      </>
    );
  };

  const renderChat = () => (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
        {chatMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 px-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full bg-purple-100 flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#534AB7" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="14" rx="3" />
                  <path d="M7 10h10" strokeLinecap="round" />
                </svg>
              </div>
              <span className="text-[12px] font-medium text-gray-600">Vibe planning with Claude</span>
            </div>
            <p className="text-[11px] text-gray-500 text-center max-w-[380px]">
              Pick a day and shape it — try a vibe pill, ask for other options, or chat directly.
            </p>
          </div>
        )}
        {chatMessages.map((msg, idx) => {
          if (msg.role === "assistant" && msg.content.startsWith(LOCKED_PREFIX)) {
            const label = msg.content.slice(LOCKED_PREFIX.length);
            return (
              <div key={idx} className="mb-3 flex justify-center">
                <div
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium"
                  style={{ backgroundColor: "#f0faf5", color: "#0F6E56" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#1D9E75" }} />
                  {label} locked
                </div>
              </div>
            );
          }
          return (
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
          );
        })}
        {isThinking && (
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

      {isCollab && vibeButtons.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2 flex-shrink-0">
          {vibeButtons.map(vibe => {
            const isSelected = selectedVibe === vibe;
            return (
              <button
                key={vibe}
                onClick={() => handleVibePillClick(vibe)}
                disabled={isThinking}
                className="transition-colors disabled:opacity-50"
                style={{
                  borderRadius: 16,
                  padding: "5px 12px",
                  fontSize: 11,
                  backgroundColor: isSelected ? "#534AB7" : "transparent",
                  color: isSelected ? "white" : "#6b7280",
                  border: isSelected ? "1px solid #534AB7" : "1px solid #d1d5db",
                }}
              >
                {vibe}
              </button>
            );
          })}
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
          placeholder="Ask Claude about this day..."
          className="flex-1 text-[13px] px-4 py-2.5 border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-purple-200 focus:border-purple-300 transition-colors"
          style={{ borderRadius: 20 }}
          onKeyDown={e => e.key === "Enter" && handleChatSend()}
          disabled={isThinking}
        />
        <button
          onClick={() => handleChatSend()}
          disabled={isThinking || !chatInput.trim()}
          className="px-4 py-2.5 text-[12px] font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: "#534AB7", borderRadius: 20 }}
        >
          {isThinking ? "..." : "Send"}
        </button>
      </div>
    </>
  );

  const renderRightPanel = () => {
    const labelColor =
      cherryPickMode || optionsViewMode === "all" || selectedOption === -1
        ? dayColor
        : SOURCE_BORDER[selectedOption % SOURCE_BORDER.length];
    let labelSuffix = "";
    if (cherryPickMode) {
      labelSuffix = ` · Custom (${cherryPicks.size})`;
    } else if (optionsData) {
      if (optionsViewMode === "all") labelSuffix = " · All sources";
      else if (selectedOption === -1) labelSuffix = " · Curated";
      else labelSuffix = ` · Option ${SOURCE_LABELS[selectedOption % SOURCE_LABELS.length]}`;
    }
    return (
      <>
        {multiCity && routeCities.length >= 2 && allCoordStops.length > 0 && (
          <div className="px-3 py-2 border-b border-gray-100 bg-white flex-shrink-0 text-center" style={{ borderBottomWidth: 0.5 }}>
            <div className="text-[12px] font-medium text-gray-600 flex items-center justify-center gap-1 flex-wrap">
              {routeCities.map((city, i) => {
                const isActiveCity = i === activeCityIndex;
                return (
                  <span key={`${city.name}-${i}`} className="whitespace-nowrap">
                    {i > 0 && <span className="text-gray-300 mx-1">→</span>}
                    <span style={{
                      fontWeight: isActiveCity ? 700 : 500,
                      color: isActiveCity ? dayColor : undefined,
                    }}>{city.name}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {multiCity && routeCities.length >= 2 && allCoordStops.length > 0 && (
          <>
            <RegionalMap
              routeCities={routeCities}
              activeCityIndex={activeCityIndex}
              activeDayColor={dayColor}
              onSelectDay={(idx) => {
                setActiveDay(idx);
                setSelectedVibe(null);
                setHighlightedStopId(null);
                setPulsingStopId(null);
                setSelectedOption(-1);
                setOptionsViewMode("all");
                setCherryPickMode(false);
                setCherryPicks(new Set());
              }}
            />
            <div className="flex-shrink-0 bg-white" style={{ height: 15 }} />
          </>
        )}
        <div className="flex-1 relative min-h-0">
          <VibeMap
            stops={previewMapStops as Stop[]}
            dayColor={dayColor}
            highlightedStopId={highlightedStopId}
            pulsingStopId={pulsingStopId}
            stopColors={previewStopColors}
            onPinClick={(id: string) => highlightStop(id)}
          />
          {currentDay && (
            <div
              className="absolute top-2 left-2 px-2.5 py-1 rounded-md shadow-sm pointer-events-none"
              style={{
                backgroundColor: "rgba(255,255,255,0.95)",
                zIndex: 500,
                border: `1px solid ${labelColor}`,
              }}
            >
              <div className="text-[10px] font-semibold" style={{ color: labelColor }}>
                Day {currentDay.day_number}{currentDay.title ? ` · ${currentDay.title}` : ""}
                {labelSuffix}
              </div>
            </div>
          )}
          {optionsData && !cherryPickMode && (
            <button
              onClick={() => setOptionsViewMode(m => m === "all" ? "selected" : "all")}
              className="absolute top-2 right-2 px-2.5 py-1 rounded-md shadow-sm text-[11px] font-medium transition-colors"
              style={{
                backgroundColor: "rgba(255,255,255,0.95)",
                zIndex: 500,
                border: "1px solid #e5e7eb",
                color: "#374151",
              }}
            >
              {optionsViewMode === "all" ? "Selected only" : "All sources"}
            </button>
          )}
        </div>
      </>
    );
  };

  const renderChatOverlay = () => {
    if (!optionsData) return null;
    return (
      <div
        className="flex-shrink-0 border-b border-gray-100 bg-white"
        style={{ borderBottomWidth: 0.5 }}
      >
        <div className="flex gap-3 px-4 py-3 items-stretch">
          {optionsData.options.map((opt, optIdx) => {
            const isSelected = selectedOption === optIdx && !cherryPickMode;
            return (
              <div
                key={optIdx}
                onClick={() => { setSelectedOption(optIdx); setCherryPickMode(false); }}
                className="flex flex-col cursor-pointer transition-all"
                style={{
                  flex: "1 1 0",
                  minWidth: 0,
                  border: isSelected ? "2px solid #534AB7" : "0.5px solid #e5e7eb",
                  borderRadius: 12,
                  backgroundColor: isSelected ? "#FAFAFE" : "white",
                  padding: 14,
                }}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="text-[14px] font-semibold text-gray-900 leading-tight flex-1 min-w-0">
                    {opt.label}
                  </div>
                  <span
                    className="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] font-bold"
                    style={{
                      backgroundColor: SOURCE_BG[optIdx % SOURCE_BG.length],
                      color: SOURCE_BORDER[optIdx % SOURCE_BORDER.length],
                    }}
                  >
                    {SOURCE_LABELS[optIdx % SOURCE_LABELS.length]}
                  </span>
                </div>
                <div
                  className="text-[11px] mb-2.5 px-2 py-0.5 rounded inline-block self-start leading-snug"
                  style={{ backgroundColor: "#EEEDFE", color: "#534AB7" }}
                >
                  {opt.summary}
                </div>
                <DroppableZone
                  id={`option-${optIdx}`}
                  className="flex flex-col mb-3 flex-1"
                  style={{ minHeight: 60 }}
                >
                  <SortableContext
                    items={opt.stops.map((_, i) => `opt-${optIdx}-${i}`)}
                    strategy={verticalListSortingStrategy}
                  >
                    {opt.stops.map((s, i) => {
                      const sortableId = `opt-${optIdx}-${i}`;
                      const previewId = `prev-${optIdx}-${i}`;
                      const isHL = highlightedStopId === previewId && selectedOption === optIdx && !cherryPickMode;
                      const alreadyAdded = addedOptionNames.has(s.name.toLowerCase().trim());
                      return (
                        <SortableStopRow
                          key={sortableId}
                          sortableId={sortableId}
                          name={s.name}
                          stopType={s.stop_type}
                          durationMinutes={s.duration_minutes}
                          dayColor={dayColor}
                          isHighlighted={isHL}
                          isAdded={alreadyAdded}
                          compact
                          onClick={() => highlightOptionStop(optIdx, i)}
                        />
                      );
                    })}
                  </SortableContext>
                </DroppableZone>
                <button
                  onClick={(e) => { e.stopPropagation(); goWithOption(optIdx); }}
                  className="w-full py-2 rounded-lg text-white text-[13px] font-medium"
                  style={{ backgroundColor: "#1D9E75" }}
                >
                  Go with this
                </button>
              </div>
            );
          })}
        </div>
        <div className="text-center pb-3">
          <button
            onClick={() => {
              setCherryPickMode(true);
              setCherryPicks(new Set());
            }}
            className="text-[12px] text-gray-500 hover:text-purple-600 underline"
          >
            Or pick stops from each option
          </button>
          <button
            onClick={dismissOptions}
            className="text-[12px] text-gray-400 hover:text-gray-600 ml-4"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <div className="w-10 h-10 rounded-full border-[3px] border-gray-200 border-t-purple-500 animate-spin mx-auto mb-4" />
        <p className="text-gray-400 text-sm">Loading vibe planning...</p>
      </div>
    </div>
  );
  if (!trip || !currentMember) return null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <TripLayout
        trip={trip}
        days={days}
        activeDay={activeDay}
        dayColors={dayColors}
        stops={stops}
        onSelectDay={(idx) => {
          setActiveDay(idx);
          setSelectedVibe(null);
          setHighlightedStopId(null);
          setPulsingStopId(null);
          setSelectedOption(-1);
          setOptionsViewMode("all");
          setCherryPickMode(false);
          setCherryPicks(new Set());
        }}
        trips={allTrips}
        onNewTrip={() => router.push("/")}
        onSwitchTrip={(id) => router.push(`/trip/${id}`)}
        renderLeftPanel={renderLeftPanel}
        renderChat={renderChat}
        renderRightPanel={renderRightPanel}
        renderChatOverlay={renderChatOverlay}
      />
      <DragOverlay>
        {draggedRender ? (
          <StopRowOverlay
            name={draggedRender.name}
            stopType={draggedRender.stopType}
            durationMinutes={draggedRender.durationMinutes}
            dayColor={dayColor}
            compact={draggedRender.compact}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
