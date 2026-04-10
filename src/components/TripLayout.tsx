"use client";
import { useState, type ReactNode } from "react";
import DayBar from "@/components/DayBar";
import type { Trip, Day, TripMember, Stop } from "@/lib/database.types";

interface TripLayoutProps {
  trip: Trip;
  days: Day[];
  activeDay: number;
  dayColors: string[];
  members?: TripMember[];
  stops?: Stop[];

  onSelectDay: (idx: number) => void;
  onAddDay?: () => void;

  trips?: Trip[];
  onNewTrip?: () => void;
  onSwitchTrip?: (id: string) => void;

  renderLeftPanel: () => ReactNode;
  renderChat: () => ReactNode;
  renderRightPanel: () => ReactNode;
  renderChatOverlay?: () => ReactNode;
}

export default function TripLayout({
  trip,
  days,
  activeDay,
  dayColors,
  onSelectDay,
  onAddDay,
  trips,
  onNewTrip,
  onSwitchTrip,
  renderLeftPanel,
  renderChat,
  renderRightPanel,
  renderChatOverlay,
}: TripLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden relative">
      {/* Top bar — hamburger + trip name + day bar inline */}
      <div className="flex items-stretch flex-shrink-0 bg-white">
        <div className="flex items-center gap-3 pl-3 pr-4 border-b border-gray-100">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="Toggle sidebar"
            className="p-1.5 rounded hover:bg-gray-100 transition-colors flex items-center justify-center flex-shrink-0"
          >
            <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
              <line x1="0" y1="2" x2="20" y2="2" stroke="#444" strokeWidth="1.6" strokeLinecap="round" />
              <line x1="0" y1="7" x2="20" y2="7" stroke="#444" strokeWidth="1.6" strokeLinecap="round" />
              <line x1="0" y1="12" x2="20" y2="12" stroke="#444" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <div className="text-[14px] font-medium text-gray-900 whitespace-nowrap">{trip.name}</div>
        </div>
        <div className="flex-1 min-w-0">
          <DayBar
            days={days}
            activeDay={activeDay}
            dayColors={dayColors}
            onSelectDay={onSelectDay}
            showAddDay={!!onAddDay}
            onAddDay={onAddDay}
          />
        </div>
      </div>

      {/* Three-panel body */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Sidebar overlay backdrop */}
        {sidebarOpen && (
          <div
            className="absolute inset-0"
            style={{ zIndex: 19, backgroundColor: "rgba(0,0,0,0.08)" }}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar overlay panel */}
        <aside
          className="absolute top-0 left-0 bottom-0 bg-white flex flex-col"
          style={{
            width: 220,
            zIndex: 20,
            borderRight: "0.5px solid #e5e7eb",
            transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 0.2s",
            boxShadow: sidebarOpen ? "2px 0 16px rgba(0,0,0,0.08)" : undefined,
            visibility: sidebarOpen ? "visible" : "hidden",
          }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Your trips</span>
            <button
              onClick={() => setSidebarOpen(false)}
              aria-label="Close sidebar"
              className="text-gray-400 hover:text-gray-700 text-xl leading-none w-6 h-6 flex items-center justify-center"
            >
              &times;
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {trips && trips.length > 0 ? (
              trips.map((t) => {
                const isCurrent = t.id === trip.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSidebarOpen(false);
                      if (!isCurrent && onSwitchTrip) onSwitchTrip(t.id);
                    }}
                    className="w-full text-left px-4 py-2.5 transition-colors block"
                    style={{ backgroundColor: isCurrent ? "#E1F5EE" : "transparent" }}
                    onMouseEnter={(e) => {
                      if (!isCurrent) (e.currentTarget as HTMLElement).style.backgroundColor = "#f5f5f4";
                    }}
                    onMouseLeave={(e) => {
                      if (!isCurrent) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                    }}
                  >
                    <div className="text-[13px] font-medium text-gray-900 truncate">{t.name}</div>
                    {t.duration && <div className="text-[10px] text-gray-500 truncate mt-0.5">{t.duration}</div>}
                  </button>
                );
              })
            ) : (
              <div className="px-4 py-3 text-[11px] text-gray-400">No other trips yet</div>
            )}
          </div>
          {onNewTrip && (
            <button
              onClick={() => {
                setSidebarOpen(false);
                onNewTrip();
              }}
              className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 text-[13px] font-medium text-emerald-700 hover:bg-emerald-50 transition-colors w-full flex-shrink-0"
            >
              <span className="text-base leading-none">+</span> New trip
            </button>
          )}
        </aside>

        {/* Left panel — stops */}
        <div
          className="flex-shrink-0 flex flex-col overflow-y-auto bg-white"
          style={{ width: 240, borderRight: "0.5px solid #e5e7eb" }}
        >
          {renderLeftPanel()}
        </div>

        {/* Center — chat */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-white">
          {renderChatOverlay && renderChatOverlay()}
          {renderChat()}
        </div>

        {/* Right panel — map */}
        <div
          className="flex-shrink-0 flex flex-col bg-white"
          style={{ width: 280, borderLeft: "0.5px solid #e5e7eb" }}
        >
          {renderRightPanel()}
        </div>
      </div>
    </div>
  );
}
