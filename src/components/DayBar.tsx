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
        const status = day.vibe_status || null;
        const isActive = idx === activeDay;
        const color = dayColors[idx] || "hsl(145, 55%, 33%)";

        // Vibe-aware styling if vibe_status exists
        if (status) {
          const isCollabDay = status === "collab";
          const activeBorderColor = isCollabDay ? "#534AB7" : "#1D9E75";
          const chipStyle = status === "locked"
            ? { bg: "#E1F5EE", border: "#9FE1CB", dot: "#9FE1CB" }
            : isCollabDay
            ? { bg: "#EEEDFE", border: "#AFA9EC", dot: "#AFA9EC" }
            : { bg: "#E1F5EE", border: "#5DCAA5", dot: "#5DCAA5" };
          const vibeSnippet = day.narrative ? day.narrative.slice(0, 30) + (day.narrative.length > 30 ? "..." : "") : "";
          return (
            <button key={day.id} onClick={() => onSelectDay(idx)}
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
        }

        // Standard dashboard styling (no vibe_status)
        return (
          <button key={day.id} onClick={() => onSelectDay(idx)}
            className="rounded-full whitespace-nowrap transition-all flex-shrink-0 font-medium"
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
