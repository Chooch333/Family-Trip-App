"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAllMemberships, createTrip, joinTrip } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { Trip, TripMember } from "@/lib/database.types";

interface TripCard {
  trip: Trip;
  memberCount: number;
}

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<TripCard[]>([]);
  const [mode, setMode] = useState<"home" | "create" | "join">("home");
  const [tripName, setTripName] = useState("");
  const [yourName, setYourName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadTrips();
  }, []);

  async function loadTrips() {
    setLoading(true);
    const memberships = await getAllMemberships();
    if (memberships.length === 0) { setTrips([]); setLoading(false); return; }

    const tripIds = Array.from(new Set(memberships.map(m => m.trip_id)));
    const cards: TripCard[] = [];
    for (const tripId of tripIds) {
      const { data: trip } = await supabase.from("trips").select("*").eq("id", tripId).single();
      if (!trip) continue;
      const { count } = await supabase.from("trip_members").select("*", { count: "exact", head: true }).eq("trip_id", tripId);
      cards.push({ trip: trip as Trip, memberCount: count || 0 });
    }
    setTrips(cards);
    setLoading(false);
  }

  async function handleCreate() {
    if (!tripName.trim() || !yourName.trim()) { setError("Please fill in both fields."); return; }
    setCreating(true); setError("");
    const result = await createTrip(tripName.trim(), yourName.trim());
    if ("error" in result) { setError(result.error); setCreating(false); return; }
    router.push(`/trip/${result.tripId}`);
  }

  async function handleJoin() {
    if (!inviteCode.trim() || !joinName.trim()) { setError("Please fill in both fields."); return; }
    setJoining(true); setError("");
    const result = await joinTrip(inviteCode.trim(), joinName.trim());
    if ("error" in result) { setError(result.error); setJoining(false); return; }
    router.push(`/trip/${result.member.trip_id}`);
  }

  function formatDates(trip: Trip) {
    if (!trip.start_date && !trip.end_date) return "Dates TBD";
    const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (trip.start_date && trip.end_date) return `${fmt(trip.start_date)} – ${fmt(trip.end_date)}`;
    if (trip.start_date) return `Starts ${fmt(trip.start_date)}`;
    return `Ends ${fmt(trip.end_date!)}`;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shadow-sm shadow-emerald-200">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Family Trip Planner</h1>
            <p className="text-xs text-gray-500">Plan together. Explore together.</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-16">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-emerald-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : mode === "home" ? (
          <>
            {/* Trip list */}
            {trips.length > 0 && (
              <div className="mb-6">
                <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Your trips</h2>
                <div className="space-y-2">
                  {trips.map(({ trip, memberCount }) => (
                    <button key={trip.id} onClick={() => router.push(`/trip/${trip.id}`)}
                      className="w-full bg-white rounded-xl border border-gray-100 hover:border-emerald-200 hover:shadow-sm transition-all p-4 text-left group">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                          style={{ backgroundColor: trip.cover_color || "#1D9E75" }}>
                          {trip.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-gray-900 truncate group-hover:text-emerald-700 transition-colors">{trip.name}</div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {formatDates(trip)} · {memberCount} {memberCount === 1 ? "traveler" : "travelers"}
                          </div>
                        </div>
                        <svg className="w-4 h-4 text-gray-300 group-hover:text-emerald-500 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {trips.length === 0 && (
              <div className="text-center py-10 mb-6">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
                  </svg>
                </div>
                <h2 className="text-base font-semibold text-gray-900 mb-1">No trips yet</h2>
                <p className="text-sm text-gray-500">Create a trip or join one with an invite code.</p>
              </div>
            )}

            {/* Action buttons */}
            <div className="space-y-2">
              <button onClick={() => { setMode("create"); setError(""); }}
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 transition-colors shadow-sm">
                Create a new trip
              </button>
              <button onClick={() => { setMode("join"); setError(""); }}
                className="w-full py-3.5 px-4 rounded-xl bg-white border border-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-50 transition-colors">
                Join a trip with invite code
              </button>
            </div>
          </>
        ) : mode === "create" ? (
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Create a new trip</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Trip name</label>
                <input type="text" value={tripName} onChange={(e) => setTripName(e.target.value)} placeholder="Italy 2026" autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Your name</label>
                <input type="text" value={yourName} onChange={(e) => setYourName(e.target.value)} placeholder="Charles"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition-all"
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()} />
              </div>
              {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button onClick={handleCreate} disabled={creating}
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                {creating ? "Creating..." : "Create trip"}
              </button>
              <button onClick={() => { setMode("home"); setError(""); }}
                className="w-full py-2 text-gray-400 text-xs hover:text-gray-600 transition-colors">Back</button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Join a trip</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Invite code</label>
                <input type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Paste invite code" autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Your name</label>
                <input type="text" value={joinName} onChange={(e) => setJoinName(e.target.value)} placeholder="Your first name"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition-all"
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()} />
              </div>
              {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button onClick={handleJoin} disabled={joining}
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                {joining ? "Joining..." : "Join trip"}
              </button>
              <button onClick={() => { setMode("home"); setError(""); }}
                className="w-full py-2 text-gray-400 text-xs hover:text-gray-600 transition-colors">Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
