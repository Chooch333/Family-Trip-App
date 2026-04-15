"use client";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import DayBar from "@/components/DayBar";
import { supabase } from "@/lib/supabase";
import type { Trip, Day, TripMember, Stop } from "@/lib/database.types";

interface CurrentProfile {
  id: string;
  display_name: string;
  avatar_color: string;
  avatar_initial: string;
  email: string;
}

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
  currentProfile?: CurrentProfile;
  renderLeftPanel: () => ReactNode;
  renderChat: () => ReactNode;
  renderRightPanel: () => ReactNode;
  renderChatOverlay?: () => ReactNode;
}

const RAIL_BG = "#f7f7f4";
const BORDER = "#e5e7eb";
const BORDER_ACTIVE = "#d1d5db";
const SHADOW_ACTIVE = "0 8px 32px rgba(0,0,0,0.12)";
const SHADOW_RESTING = "0 2px 8px rgba(0,0,0,0.06)";
const PANEL_TRANSITION = "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)";

// ─────────────────────────────────────────────────────────────────────────────
// PANEL LAYOUT — Three overlapping cards, independent expansion
//
// Two independent booleans control width. One "focusedPanel" controls z-order.
// Both side panels can be expanded simultaneously — they overlap the chat
// from both sides and the chat peeks through in the middle.
//
// stopsExpanded=false, mapExpanded=false → both 33%, chat visible
// stopsExpanded=true  → stops grows to 45%, overlaps chat more
// mapExpanded=true    → map grows to 45%, overlaps chat more
// Both expanded       → stops 45%, map 45%, chat still 36% in center
//
// focusedPanel determines z-order only (who's on top of whom).
// Click chat → collapse both side panels, chat comes to front.
// ─────────────────────────────────────────────────────────────────────────────

type FocusedPanel = "stops" | "chat" | "map";

function getPanelStyles(
  focusedPanel: FocusedPanel,
  stopsExpanded: boolean,
  mapExpanded: boolean,
) {
  // Widths are independent of focus — controlled by expanded booleans
  const stopsWidth = stopsExpanded ? "45%" : "33%";
  const mapWidth = mapExpanded ? "45%" : "33%";

  // Z-index: focused card is z:3, other side panel z:2, chat z:1
  // When chat is focused: chat z:3, both side panels behind
  let stopsZ: number, chatZ: number, mapZ: number;
  if (focusedPanel === "chat") {
    chatZ = 3; stopsZ = 1; mapZ = 2;
  } else if (focusedPanel === "stops") {
    stopsZ = 3; mapZ = 2; chatZ = 1;
  } else {
    mapZ = 3; stopsZ = 2; chatZ = 1;
  }

  return {
    stops: { width: stopsWidth, left: 12, right: "auto" as const, zIndex: stopsZ },
    chat:  { width: "36%", left: "32%", right: "auto" as const, zIndex: chatZ },
    map:   { width: mapWidth, left: "auto" as const, right: 12, zIndex: mapZ },
  };
}

export default function TripLayout({
  trip, days, activeDay, dayColors, onSelectDay, onAddDay,
  trips, onNewTrip, onSwitchTrip, currentProfile,
  renderLeftPanel, renderChat, renderRightPanel, renderChatOverlay,
}: TripLayoutProps) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [focusedPanel, setFocusedPanel] = useState<FocusedPanel>("chat");
  const [stopsExpanded, setStopsExpanded] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [avatarPopover, setAvatarPopover] = useState(false);
  const [switchUserMode, setSwitchUserMode] = useState(false);
  const [switchEmail, setSwitchEmail] = useState("");
  const [switchSuggestions, setSwitchSuggestions] = useState<{ id: string; email: string; display_name: string; avatar_color: string; avatar_initial: string }[]>([]);
  const [switchError, setSwitchError] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const avatarBtnRef = useRef<HTMLButtonElement>(null);

  // Click handlers
  function handleStopsClick() {
    if (focusedPanel === "stops" && stopsExpanded) {
      // Already focused+expanded → collapse, go back to chat
      setStopsExpanded(false);
      setFocusedPanel("chat");
    } else {
      setStopsExpanded(true);
      setFocusedPanel("stops");
    }
  }
  function handleMapClick() {
    if (focusedPanel === "map" && mapExpanded) {
      setMapExpanded(false);
      setFocusedPanel("chat");
    } else {
      setMapExpanded(true);
      setFocusedPanel("map");
    }
  }
  function handleChatClick() {
    // Chat click: collapse both side panels, bring chat to front
    setStopsExpanded(false);
    setMapExpanded(false);
    setFocusedPanel("chat");
  }

  useEffect(() => {
    if (!avatarPopover) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node) && avatarBtnRef.current && !avatarBtnRef.current.contains(e.target as Node)) {
        setAvatarPopover(false); setSwitchUserMode(false); setSwitchEmail(""); setSwitchSuggestions([]); setSwitchError("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [avatarPopover]);

  useEffect(() => {
    if (!switchUserMode || switchEmail.length < 2) { setSwitchSuggestions([]); setSwitchError(""); return; }
    const timeout = setTimeout(async () => {
      const { data } = await supabase.from("profiles").select("id, email, display_name, avatar_color, avatar_initial").ilike("email", `%${switchEmail}%`).order("email").limit(5);
      if (data && data.length > 0) { setSwitchSuggestions(data); setSwitchError(""); }
      else { setSwitchSuggestions([]); }
    }, 200);
    return () => clearTimeout(timeout);
  }, [switchEmail, switchUserMode]);

  async function handleSwitchToProfile(profileId: string) {
    const { data: member } = await supabase.from("trip_members").select("id").eq("trip_id", trip.id).eq("profile_id", currentProfile?.id || "").maybeSingle();
    if (member) { await supabase.from("trip_members").update({ profile_id: profileId }).eq("id", member.id); }
    setAvatarPopover(false); setSwitchUserMode(false); window.location.reload();
  }

  const activeDayColor = dayColors[activeDay] || "#1D9E75";
  const railTrips = (trips || []).slice(0, 4);
  const panelStyles = getPanelStyles(focusedPanel, stopsExpanded, mapExpanded);
  const stopsIsFocused = focusedPanel === "stops";
  const chatIsFocused = focusedPanel === "chat";
  const mapIsFocused = focusedPanel === "map";

  function tripInitial(name: string): string {
    const trimmed = name.trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
  }

  return (
    <div className="h-screen flex flex-row overflow-hidden relative" style={{ backgroundColor: "#f0f0ec" }}>
      {/* Sidebar rail */}
      <div className="flex-shrink-0 flex flex-col items-center py-2 gap-2"
        style={{ width: 48, backgroundColor: RAIL_BG, borderRight: `0.5px solid ${BORDER}`, position: "relative", zIndex: 20 }}>
        <button onClick={() => setSidebarOpen((o) => !o)} aria-label="Open sidebar"
          className="w-9 h-9 rounded-md flex items-center justify-center hover:bg-gray-200/60 transition-colors flex-shrink-0">
          <svg width="18" height="13" viewBox="0 0 20 14" fill="none">
            <line x1="0" y1="2" x2="20" y2="2" stroke="#444" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="0" y1="7" x2="20" y2="7" stroke="#444" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="0" y1="12" x2="20" y2="12" stroke="#444" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <div className="w-6 h-px bg-gray-200 my-1 flex-shrink-0" />
        <div className="flex flex-col gap-2 items-center flex-1 min-h-0 overflow-hidden">
          {railTrips.map((t) => {
            const isCurrent = t.id === trip.id;
            return (
              <button key={t.id} onClick={() => { if (!isCurrent && onSwitchTrip) onSwitchTrip(t.id); }}
                title={t.name} className="relative flex-shrink-0 flex items-center justify-center text-white text-[12px] font-semibold transition-transform hover:scale-105"
                style={{ width: 32, height: 32, borderRadius: "50%", backgroundColor: isCurrent ? activeDayColor : "#9ca3af",
                  boxShadow: isCurrent ? "0 0 0 2px #fff, 0 0 0 3.5px " + activeDayColor : undefined }}>
                {tripInitial(t.name)}
              </button>
            );
          })}
        </div>
        {currentProfile && (
          <div className="relative" style={{ marginTop: "auto", marginBottom: 12 }}>
            <button ref={avatarBtnRef}
              onClick={() => { setAvatarPopover(o => !o); setSwitchUserMode(false); setSwitchEmail(""); setSwitchSuggestions([]); setSwitchError(""); }}
              title={currentProfile.display_name} className="flex items-center justify-center text-white text-[13px] font-medium transition-colors"
              style={{ width: 32, height: 32, borderRadius: "50%", backgroundColor: currentProfile.avatar_color, border: "2px solid white" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = BORDER; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "white"; }}>
              {currentProfile.avatar_initial}
            </button>
            {avatarPopover && (
              <div ref={popoverRef} style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, width: 220, backgroundColor: "white",
                border: `0.5px solid ${BORDER}`, borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 30, padding: "8px 0" }}>
                <div style={{ padding: "10px 14px", borderBottom: `0.5px solid ${BORDER}` }} className="flex items-center gap-2.5">
                  <div className="flex-shrink-0 flex items-center justify-center text-white text-[12px] font-medium"
                    style={{ width: 28, height: 28, borderRadius: "50%", backgroundColor: currentProfile.avatar_color }}>{currentProfile.avatar_initial}</div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-gray-900 truncate">{currentProfile.display_name}</div>
                    <div className="text-[11px] text-gray-500 truncate">{currentProfile.email}</div>
                  </div>
                </div>
                {!switchUserMode ? (
                  <>
                    <button onClick={() => { setAvatarPopover(false); router.push("/profile"); }}
                      className="w-full text-left text-[13px] text-gray-700 hover:bg-gray-50 transition-colors" style={{ padding: "8px 14px" }}>Profile &amp; settings</button>
                    <button onClick={() => setSwitchUserMode(true)}
                      className="w-full text-left text-[13px] text-gray-700 hover:bg-gray-50 transition-colors" style={{ padding: "8px 14px" }}>Switch user</button>
                  </>
                ) : (
                  <div style={{ padding: "10px 14px" }}>
                    <input type="email" value={switchEmail} onChange={e => setSwitchEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && switchEmail.trim() && switchSuggestions.length === 0) setSwitchError("No profile found"); }}
                      placeholder="Email address" autoFocus
                      className="w-full text-[13px] px-3 py-2 rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 transition-all"
                      style={{ height: 36 }} />
                    {switchSuggestions.length > 0 && (
                      <div className="mt-1.5 space-y-0.5">
                        {switchSuggestions.map(s => (
                          <button key={s.id} onClick={() => handleSwitchToProfile(s.id)}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 transition-colors text-left">
                            <div className="flex-shrink-0 flex items-center justify-center text-white text-[10px] font-medium"
                              style={{ width: 24, height: 24, borderRadius: "50%", backgroundColor: s.avatar_color }}>{s.avatar_initial}</div>
                            <div className="min-w-0">
                              <div className="text-[12px] font-medium text-gray-900 truncate">{s.display_name}</div>
                              <div className="text-[11px] text-gray-500 truncate">{s.email}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {switchError && <p className="text-[12px] text-red-400 mt-2">{switchError}</p>}
                    <button onClick={() => { setSwitchUserMode(false); setSwitchEmail(""); setSwitchSuggestions([]); setSwitchError(""); }}
                      className="text-[12px] text-gray-400 hover:text-gray-600 mt-2 transition-colors">Cancel</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        <div className="flex items-stretch flex-shrink-0" style={{ backgroundColor: "#f0f0ec" }}>
          <div className="flex items-center pl-3 pr-4" style={{ borderBottom: `0.5px solid ${BORDER}` }}>
            <div className="text-[14px] font-medium text-gray-900 whitespace-nowrap">{trip.name}</div>
          </div>
          <div className="flex-1 min-w-0" style={{ borderBottom: `0.5px solid ${BORDER}` }}>
            <DayBar days={days} activeDay={activeDay} dayColors={dayColors} onSelectDay={onSelectDay} showAddDay={!!onAddDay} onAddDay={onAddDay} />
          </div>
        </div>

        {/* Overlapping card container */}
        <div className="flex-1 min-h-0 relative">
          {/* LEFT — Day card */}
          <div onClick={handleStopsClick} className="absolute flex flex-col overflow-y-auto"
            style={{ top: 12, bottom: 12, left: panelStyles.stops.left, width: panelStyles.stops.width, zIndex: panelStyles.stops.zIndex,
              transition: PANEL_TRANSITION, borderRadius: 10, border: `0.5px solid ${stopsIsFocused ? BORDER_ACTIVE : BORDER}`,
              backgroundColor: "white", boxShadow: stopsIsFocused ? SHADOW_ACTIVE : SHADOW_RESTING, cursor: "pointer" }}>
            {renderLeftPanel()}
          </div>

          {/* CENTER — Chat */}
          <div onClick={handleChatClick} className="absolute flex flex-col min-h-0"
            style={{ top: 12, bottom: 12, left: panelStyles.chat.left, width: panelStyles.chat.width, zIndex: panelStyles.chat.zIndex,
              transition: PANEL_TRANSITION, borderRadius: 10, border: `0.5px solid ${chatIsFocused ? BORDER_ACTIVE : BORDER}`,
              backgroundColor: "white", boxShadow: chatIsFocused ? SHADOW_ACTIVE : "none", overflow: "hidden", cursor: "pointer" }}>
            {renderChatOverlay && renderChatOverlay()}
            {renderChat()}
          </div>

          {/* RIGHT — Map */}
          <div onClick={handleMapClick} className="absolute flex flex-col min-h-0"
            style={{ top: 12, bottom: 12, right: panelStyles.map.right, width: panelStyles.map.width, zIndex: panelStyles.map.zIndex,
              transition: PANEL_TRANSITION, borderRadius: 10, border: `0.5px solid ${mapIsFocused ? BORDER_ACTIVE : BORDER}`,
              backgroundColor: "white", boxShadow: mapIsFocused ? SHADOW_ACTIVE : SHADOW_RESTING, overflow: "hidden", cursor: "pointer" }}>
            {renderRightPanel()}
          </div>
        </div>
      </div>

      {/* Sidebar backdrop */}
      {sidebarOpen && (
        <div className="absolute top-0 bottom-0" style={{ left: 48, right: 0, zIndex: 14, backgroundColor: "rgba(0,0,0,0.08)" }}
          onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar panel */}
      <aside className="absolute top-0 bottom-0 bg-white flex flex-col"
        style={{ left: 0, width: 48 + 220, paddingLeft: 48, zIndex: 15, borderRight: `0.5px solid ${BORDER}`,
          transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)", transition: "transform 0.2s ease",
          boxShadow: sidebarOpen ? "2px 0 16px rgba(0,0,0,0.08)" : undefined, pointerEvents: sidebarOpen ? "auto" : "none" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Your trips</span>
          <button onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"
            className="text-gray-400 hover:text-gray-700 text-xl leading-none w-6 h-6 flex items-center justify-center">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {trips && trips.length > 0 ? trips.map((t) => {
            const isCurrent = t.id === trip.id;
            return (
              <button key={t.id} onClick={() => { setSidebarOpen(false); if (!isCurrent && onSwitchTrip) onSwitchTrip(t.id); }}
                className="w-full text-left px-4 py-2.5 transition-colors block"
                style={{ backgroundColor: isCurrent ? "#E1F5EE" : "transparent" }}
                onMouseEnter={(e) => { if (!isCurrent) (e.currentTarget as HTMLElement).style.backgroundColor = "#f5f5f4"; }}
                onMouseLeave={(e) => { if (!isCurrent) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}>
                <div className="text-[13px] font-medium text-gray-900 truncate">{t.name}</div>
                {t.duration && <div className="text-[10px] text-gray-500 truncate mt-0.5">{t.duration}</div>}
              </button>
            );
          }) : <div className="px-4 py-3 text-[11px] text-gray-400">No other trips yet</div>}
        </div>
        {onNewTrip && (
          <button onClick={() => { setSidebarOpen(false); onNewTrip(); }}
            className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 text-[13px] font-medium text-emerald-700 hover:bg-emerald-50 transition-colors w-full flex-shrink-0">
            <span className="text-base leading-none">+</span> New trip
          </button>
        )}
        {currentProfile && (
          <button onClick={() => { setSidebarOpen(false); router.push("/profile"); }}
            className="flex items-center gap-2.5 w-full flex-shrink-0 hover:bg-gray-50 transition-colors"
            style={{ padding: "10px 14px", borderTop: `0.5px solid ${BORDER}` }}>
            <div className="flex-shrink-0 flex items-center justify-center text-white text-[12px] font-medium"
              style={{ width: 28, height: 28, borderRadius: "50%", backgroundColor: currentProfile.avatar_color }}>{currentProfile.avatar_initial}</div>
            <span className="text-[13px] text-gray-700">Profile &amp; settings</span>
          </button>
        )}
      </aside>
    </div>
  );
}