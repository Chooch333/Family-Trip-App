"use client";
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { joinTrip, getCurrentMember } from "@/lib/session";
import { supabase } from "@/lib/supabase";

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const tripId = params.tripId as string;
  const [tripName, setTripName] = useState("");
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [yourName, setYourName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      const member = await getCurrentMember();
      if (member && member.trip_id === tripId) { router.replace(`/trip/${tripId}`); return; }
      const { data: trip } = await supabase.from("trips").select("*").eq("id", tripId).maybeSingle();
      if (!trip) { setError("Trip not found."); setLoading(false); return; }
      setTripName(trip.name); setInviteCode(trip.invite_code);
      const { data: members } = await supabase.from("trip_members").select("*").eq("trip_id", tripId);
      if (members) setMemberNames(members.map(m => m.display_name));
      setLoading(false);
    }
    init();
  }, [tripId, router]);

  async function handleJoin() {
    if (!yourName.trim()) { setError("Please enter your name."); return; }
    setJoining(true); setError("");
    const result = await joinTrip(inviteCode, yourName.trim());
    if ("error" in result) { setError(result.error); setJoining(false); return; }
    router.push(`/trip/${tripId}`);
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-white"><p className="text-gray-400 text-sm">Loading trip...</p></div>;

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-200">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-1">Join {tripName || "this trip"}</h1>
          {memberNames.length > 0 && <p className="text-gray-500 text-sm">{memberNames.join(", ")} {memberNames.length === 1 ? "is" : "are"} already here</p>}
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Pick your name</label>
            <input type="text" value={yourName} onChange={e => setYourName(e.target.value)} placeholder="Your first name" autoFocus className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition-all" onKeyDown={e => e.key === "Enter" && handleJoin()} />
          </div>
          {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <button onClick={handleJoin} disabled={joining} className="w-full py-3.5 px-4 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 transition-colors shadow-sm disabled:opacity-50">{joining ? "Joining..." : "Join trip"}</button>
        </div>
      </div>
    </div>
  );
}
