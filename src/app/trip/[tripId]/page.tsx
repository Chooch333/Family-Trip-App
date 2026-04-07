"use client";
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { getMemberForTrip } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { Trip, TripMember, Day, Stop, Vote, Proposal } from "@/lib/database.types";

type ViewId = "itinerary" | "map" | "votes" | "ai" | "journal";
const DAY_COLORS = ["#1D9E75", "#378ADD", "#5DCAA5", "#7F77DD", "#D85A30", "#D4537E", "#EF9F27"];

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

  async function handleAddDay() {
    if (!newDayTitle.trim()) return;
    setAddingDay(true);
    const nextDayNumber = days.length > 0 ? Math.max(...days.map(d => d.day_number)) + 1 : 1;
    const color = DAY_COLORS[(nextDayNumber - 1) % DAY_COLORS.length];
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
      trip_id: tripId,
      day_id: days[activeDay].id,
      name: newStop.name.trim(),
      description: newStop.description.trim() || null,
      start_time: newStop.start_time || null,
      duration_minutes: newStop.duration_minutes,
      cost_estimate: newStop.cost_estimate ? parseFloat(newStop.cost_estimate) : null,
      sort_order: nextOrder,
      created_by: currentMember?.id || null,
    }).select().single();
    if (data && !error) {
      setStops(prev => [...prev, data as Stop]);
      setNewStop({ name: "", description: "", start_time: "", duration_minutes: 30, cost_estimate: "" });
      setShowAddStop(false);
    }
    setAddingStop(false);
  }

  useEffect(() => {
    async function load() {
      const member = await getMemberForTrip(tripId);
      if (!member) { router.replace(`/trip/${tripId}/invite`); return; }
      setCurrentMember(member);
      const { data: tripData } = await supabase.from("trips").select("*").eq("id", tripId).single();
      if (tripData) setTrip(tripData as Trip);
      const { data: membersData } = await supabase.from("trip_members").select("*").eq("trip_id", tripId).order("joined_at");
      if (membersData) setMembers(membersData as TripMember[]);
      const { data: daysData } = await supabase.from("days").select("*").eq("trip_id", tripId).order("day_number");
      if (daysData) setDays(daysData as Day[]);
      const { data: stopsData } = await supabase.from("stops").select("*").eq("trip_id", tripId).is("version_owner", null).order("sort_order");
      if (stopsData) setStops(stopsData as Stop[]);
      const { data: votesData } = await supabase.from("votes").select("*");
      if (votesData) setVotes(votesData as Vote[]);
      const { data: proposalData } = await supabase.from("proposals").select("*").eq("trip_id", tripId).eq("status", "pending");
      if (proposalData) setProposals(proposalData as Proposal[]);
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

  return (
    <div className="h-screen flex bg-white overflow-hidden">
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
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 flex-shrink-0">
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

        <div className="flex flex-1 min-h-0">
          {/* Left panel */}
          <div className="w-full md:w-[55%] md:border-r border-gray-100 flex flex-col overflow-hidden">
            <div className="flex gap-1 px-3 py-2 overflow-x-auto border-b border-gray-100 flex-shrink-0 items-center">
              {days.map((day, idx) => (
                <button key={day.id} onClick={() => setActiveDay(idx)} className="px-3 py-1 rounded-full text-[11px] whitespace-nowrap transition-colors flex-shrink-0"
                  style={idx === activeDay ? { backgroundColor: DAY_COLORS[idx % DAY_COLORS.length], color: "white", fontWeight: 600 } : { backgroundColor: "#f5f5f3", color: "#888" }}>
                  Day {day.day_number}{day.title ? ` · ${day.title}` : ""}
                </button>
              ))}
              {days.length === 0 && <span className="text-[11px] text-gray-400 py-1">No days yet — create your itinerary to get started</span>}
              <button onClick={() => setShowAddDay(true)} className="px-2.5 py-1 rounded-full text-[11px] whitespace-nowrap transition-colors flex-shrink-0 border border-dashed border-gray-300 text-gray-500 hover:border-emerald-400 hover:text-emerald-600">+ Add Day</button>
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

            <div className="flex-1 overflow-y-auto px-3 py-2">
              {currentDayStops.length === 0 && days.length > 0 && (
                <div className="text-center py-10"><p className="text-gray-400 text-sm mb-2">No stops on this day yet</p></div>
              )}
              {currentDayStops.map((stop, idx) => {
                const stopVotes = votes.filter(v => v.stop_id === stop.id);
                const upVotes = stopVotes.filter(v => v.vote === 1);
                return (
                  <div key={stop.id}>
                    {idx > 0 && stop.transit_note && (
                      <div className="flex items-center gap-2 py-1 px-2">
                        <div className="flex-1 h-px bg-gray-100" /><span className="text-[10px] text-gray-400">{stop.transit_note}</span><div className="flex-1 h-px bg-gray-100" />
                      </div>
                    )}
                    <div className="bg-white rounded-lg border border-gray-100 hover:border-gray-200 transition-colors mb-1.5 overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2.5">
                        <span className="text-gray-300 text-[10px] drag-handle">&#x2630;</span>
                        <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: DAY_COLORS[activeDay % DAY_COLORS.length] }} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-[13px] text-gray-900 truncate">{stop.name}</div>
                          <div className="text-[10px] text-gray-500">{stop.start_time || "TBD"} · {stop.duration_minutes} min</div>
                        </div>
                        <div className="flex gap-0.5 flex-shrink-0">
                          {members.map(m => {
                            const hasVoted = upVotes.some(v => v.member_id === m.id);
                            return <div key={m.id} className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[7px] font-semibold"
                              style={hasVoted ? { backgroundColor: m.avatar_color, color: "white" } : { border: "1.5px dashed #d1d1d1", color: "#999" }}>{m.avatar_initial}</div>;
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {days.length > 0 && !showAddStop && (
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

          {/* Right panel */}
          <div className="hidden md:flex md:w-[45%] flex-col overflow-hidden">
            <div className="flex-1 bg-gray-100 flex items-center justify-center">
              <div className="text-center">
                <svg className="w-10 h-10 text-gray-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z" /></svg>
                <p className="text-gray-400 text-xs">Map loads when stops have coordinates</p>
              </div>
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
