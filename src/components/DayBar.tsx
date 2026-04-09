"use client";
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
  return (
    <div
      className="flex gap-2 px-4 py-2.5 overflow-x-auto border-b border-gray-100 flex-shrink-0 items-end bg-white"
      style={{ zIndex: 5, opacity: dimmed ? 0.4 : 1, transition: "opacity 0.2s", pointerEvents: dimmed ? "none" : "auto" }}
    >
      {days.map((day, idx) => {
        const isActive = idx === activeDay;
        const color = dayColors[idx] || "hsl(145, 55%, 33%)";
        const status = day.vibe_status || null;

        // Vibe status dot color
        const dotColor = status === "locked" ? "#9FE1CB" : status === "collab" ? "#AFA9EC" : status === "curated" ? "#5DCAA5" : null;

        return (
          <button key={day.id} onClick={() => onSelectDay(idx)}
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
            }}>
            {dotColor && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor, border: "1px solid rgba(255,255,255,0.5)" }} />}
            Day {day.day_number}{day.title ? ` · ${day.title}` : ""}
          </button>
        );
      })}
      {days.length === 0 && <span className="text-[12px] text-gray-400 py-1">No days yet — create your itinerary to get started</span>}
      {showAddDay && onAddDay && (
        <button onClick={onAddDay} className="px-3 py-2 rounded-full text-[12px] whitespace-nowrap transition-colors flex-shrink-0 border border-dashed border-gray-300 text-gray-500 hover:border-emerald-400 hover:text-emerald-600">+ Add Day</button>
      )}
    </div>
  );
}
