"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import type { Day } from "@/lib/database.types";

type VibeDay = Day & { vibe_status?: string | null };

interface DayBarProps {
  days: VibeDay[];
  activeDay: number;
  dayColors: string[];
  onSelectDay: (idx: number) => void;
  showAddDay?: boolean;
  onAddDay?: () => void;
  dimmed?: boolean;
}

export default function DayBar({ days, activeDay, dayColors, onSelectDay, showAddDay, onAddDay, dimmed }: DayBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  const recalc = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > 0);
    setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    recalc();
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, [recalc, days.length]);

  function scrollByPx(delta: number) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: "smooth" });
  }

  return (
    <div
      className="relative flex-shrink-0 bg-white border-b border-gray-100"
      style={{ zIndex: 5, opacity: dimmed ? 0.4 : 1, transition: "opacity 0.2s", pointerEvents: dimmed ? "none" : "auto" }}
    >
      <style>{`
        .day-bar-scroll::-webkit-scrollbar { display: none; }
      `}</style>
      <div
        ref={scrollRef}
        onScroll={recalc}
        className="day-bar-scroll flex gap-2 px-4 py-2.5 overflow-x-auto items-end"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {showLeft && (
          <button
            onClick={() => scrollByPx(-240)}
            aria-label="Scroll days left"
            className="flex items-center justify-center transition-colors"
            style={{
              position: "sticky",
              left: 0,
              zIndex: 2,
              width: 28,
              alignSelf: "stretch",
              flexShrink: 0,
              marginRight: -28,
              background: "linear-gradient(to right, white 60%, rgba(255,255,255,0))",
              cursor: "pointer",
              border: "none",
              padding: 0,
              fontSize: 14,
              fontWeight: 500,
              color: "#6b7280",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#111827"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#6b7280"; }}
          >
            ‹
          </button>
        )}

        {days.map((day, idx) => {
          const isActive = idx === activeDay;
          const color = dayColors[idx] || "hsl(145, 55%, 33%)";
          const status = day.vibe_status || null;
          const dotColor = status === "locked" ? "#9FE1CB" : status === "collab" ? "#AFA9EC" : status === "curated" ? "#5DCAA5" : null;
          return (
            <button
              key={day.id}
              onClick={() => onSelectDay(idx)}
              className="rounded-full whitespace-nowrap transition-all flex-shrink-0 font-medium flex items-center gap-1.5"
              style={{
                backgroundColor: color,
                color: "white",
                opacity: isActive ? 1 : 0.5,
                fontWeight: isActive ? 700 : 500,
                padding: isActive ? "8px 16px" : "6px 13px",
                fontSize: isActive ? "13.5px" : "12.3px",
                boxShadow: isActive ? "0 2px 10px rgba(0,0,0,0.2)" : "none",
                transform: isActive ? "translateY(-2px)" : "translateY(0)",
              }}
            >
              {dotColor && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor, border: "1px solid rgba(255,255,255,0.5)" }} />}
              Day {day.day_number}{day.title ? ` · ${day.title}` : ""}
            </button>
          );
        })}

        {days.length === 0 && <span className="text-[12px] text-gray-400 py-1">No days yet — create your itinerary to get started</span>}

        {showAddDay && onAddDay && (
          <button
            onClick={onAddDay}
            className="px-3 py-2 rounded-full text-[12px] whitespace-nowrap transition-colors flex-shrink-0 border border-dashed border-gray-300 text-gray-500 hover:border-emerald-400 hover:text-emerald-600"
          >
            + Add Day
          </button>
        )}

        {showRight && (
          <button
            onClick={() => scrollByPx(240)}
            aria-label="Scroll days right"
            className="flex items-center justify-center transition-colors"
            style={{
              position: "sticky",
              right: 0,
              zIndex: 2,
              width: 28,
              alignSelf: "stretch",
              flexShrink: 0,
              marginLeft: -28,
              background: "linear-gradient(to left, white 60%, rgba(255,255,255,0))",
              cursor: "pointer",
              border: "none",
              padding: 0,
              fontSize: 14,
              fontWeight: 500,
              color: "#6b7280",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#111827"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#6b7280"; }}
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}
