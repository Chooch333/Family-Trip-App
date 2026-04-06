"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getCurrentMember, createTrip } from "@/lib/session";

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"landing" | "create">("landing");
  const [tripName, setTripName] = useState("");
  const [yourName, setYourName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function checkSession() {
      const member = await getCurrentMember();
      if (member) { router.replace(`/trip/${member.trip_id}`); return; }
      setLoading(false);
    }
    checkSession();
  }, [router]);

  async function handleCreate() {
    if (!tripName.trim() || !yourName.trim()) { setError("Please fill in both fields."); return; }
    setCreating(true); setError("");
    const result = await createTrip(tripName.trim(), yourName.trim());
    if ("error" in result) { setError(result.error); setCreating(false); return; }
    router.push(`/trip/${result.tripId}`);
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-emerald-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
          </svg>
        </div>
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-200">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Family Trip Planner</h1>
          <p className="text-gray-500 text-sm">Plan together. Explore together.</p>
        </div>
        {mode === "landing" && (
          <div className="space-y-3">
            <button onClick={() => setMode("create")} className="w-full py-3.5 px-4 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 transition-colors shadow-sm">Create a new trip</button>
            <p className="text-center text-gray-400 text-xs">Have an invite link? Just open it and you&apos;ll join automatically.</p>
          </div>
        )}
        {mode === "create" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Trip name</label>
              <input type="text" value={tripName} onChange={(e) => setTripName(e.target.value)} placeholder="Italy 2026" autoFocus className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition-all" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Your name</label>
              <input type="text" value={yourName} onChange={(e) => setYourName(e.target.value)} placeholder="Charles" className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition-all" onKeyDown={(e) => e.key === "Enter" && handleCreate()} />
            </div>
            {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <button onClick={handleCreate} disabled={creating} className="w-full py-3.5 px-4 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">{creating ? "Creating..." : "Create trip"}</button>
            <button onClick={() => setMode("landing")} className="w-full py-2 text-gray-400 text-xs hover:text-gray-600 transition-colors">Back</button>
          </div>
        )}
      </div>
    </div>
  );
}
