"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getAllMemberships, createTrip, joinTrip, rejoinAsMember } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { Trip, TripMember } from "@/lib/database.types";

interface TripCard {
  trip: Trip;
  memberCount: number;
  hasSession: boolean;
  isOrganizer: boolean;
}

// --- Smart duration parsing ---
function parseDurationHint(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(long\s+)?weekend\b|\bcouple\s+(of\s+)?days\b|\b2[\s-]+3\s*days\b/.test(t)) return "Weekend";
  if (/\bshort\s+trip\b|\bfew\s+days\b|\b[45][\s-]+[56]?\s*days\b|\b4\s+days\b|\b5\s+days\b/.test(t)) return "Short trip";
  if (/\bweek\b|\b[67]\s*days\b|\b6[\s-]+8\s*days\b/.test(t)) return "Full week";
  if (/\b[89]\s*days\b|\b1[0-9]\s*days\b|\btwo\s+weeks\b|\b2\s+weeks\b|\bextended\b/.test(t)) return "Extended";
  return null;
}

// --- Strip non-location words from destination input ---
function cleanDestination(text: string): string {
  return text
    // Duration phrases before location
    .replace(/\b(long\s+)?weekend\s+(in|to|at)\s+/i, "")
    .replace(/\b(short\s+trip|few\s+days|couple\s+(of\s+)?days)\s+(in|to|at)\s+/i, "")
    .replace(/\b\d+[\s-]+\d*\s*days?\s+(in|to|at)\s+/i, "")
    .replace(/\b(week|two\s+weeks|extended\s+trip)\s+(in|to|at)\s+/i, "")
    // Group/context phrases after location
    .replace(/\s+(with|for)\s+(my\s+)?(kids|family|friends|wife|husband|partner|children|grandparents|parents|the\s+\w+).*$/i, "")
    .replace(/\s+(on\s+a\s+budget|first\s+time|solo|alone).*$/i, "")
    .replace(/\s+(we\s+.+|i\s+.+|and\s+.+)$/i, "")
    .trim();
}

// --- Globe SVG ---
function RotatingGlobe() {
  return (
    <div className="w-24 h-24 mx-auto mb-6">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <defs>
          <clipPath id="globe-clip"><circle cx="50" cy="50" r="46" /></clipPath>
        </defs>
        <circle cx="50" cy="50" r="46" fill="#e0f5ec" stroke="#1D9E75" strokeWidth="1.5" />
        <g clipPath="url(#globe-clip)">
          <g className="animate-globe-spin">
            {/* Longitude lines */}
            {[-30, 0, 30, 60, 90, 120].map(x => (
              <ellipse key={x} cx={50 + x * 0.5} cy="50" rx="8" ry="44" fill="none" stroke="#1D9E75" strokeWidth="0.5" opacity="0.3" />
            ))}
            {/* Continent shapes */}
            <path d="M25 28c5-3 12-2 15 2s8 6 12 4c3-2 6 1 5 5s-4 8-9 7-10 3-14-1-12-5-13-10 1-5 4-7z" fill="#5DCAA5" opacity="0.5" />
            <path d="M55 55c4-2 10-1 13 3s4 10 1 13-8 4-12 2-7-6-6-10 1-6 4-8z" fill="#5DCAA5" opacity="0.5" />
            <path d="M10 45c3-1 7 0 9 3s3 7 0 9-7 2-9-1-3-5-2-8 1-2 2-3z" fill="#5DCAA5" opacity="0.5" />
          </g>
        </g>
        {/* Latitude lines */}
        <ellipse cx="50" cy="30" rx="42" ry="4" fill="none" stroke="#1D9E75" strokeWidth="0.5" opacity="0.3" />
        <ellipse cx="50" cy="50" rx="46" ry="4" fill="none" stroke="#1D9E75" strokeWidth="0.5" opacity="0.3" />
        <ellipse cx="50" cy="70" rx="42" ry="4" fill="none" stroke="#1D9E75" strokeWidth="0.5" opacity="0.3" />
      </svg>
    </div>
  );
}

// --- Animated wrapper ---
function FadeIn({ children, key: k }: { children: React.ReactNode; key?: string }) {
  return <div key={k} className="animate-fade-in">{children}</div>;
}

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<TripCard[]>([]);
  const [mode, setMode] = useState<"home" | "wizard" | "join">("home");
  const [inviteCode, setInviteCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [rejoinTrip, setRejoinTrip] = useState<Trip | null>(null);
  const [rejoinMembers, setRejoinMembers] = useState<TripMember[]>([]);
  const [rejoining, setRejoining] = useState(false);
  const [deletingTripId, setDeletingTripId] = useState<string | null>(null);
  const [editingTripId, setEditingTripId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // Profile step state
  const [wizProfileId, setWizProfileId] = useState<string | null>(null);
  const [wizEmail, setWizEmail] = useState("");
  const [wizEmailLocked, setWizEmailLocked] = useState(false);
  const [wizFirstName, setWizFirstName] = useState("");
  const [wizLastName, setWizLastName] = useState("");
  const [wizEmailSuggestions, setWizEmailSuggestions] = useState<{ id: string; email: string; display_name: string }[]>([]);
  const [wizShowSuggestions, setWizShowSuggestions] = useState(false);
  const [wizNameHighlight, setWizNameHighlight] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);

  // Wizard state
  const [wizStep, setWizStep] = useState(0);
  const [wizDest, setWizDest] = useState("");
  const [wizDuration, setWizDuration] = useState("");
  const [wizDurationInput, setWizDurationInput] = useState("");
  const [wizGroup, setWizGroup] = useState("");
  const [wizGroupDetail, setWizGroupDetail] = useState("");
  const [wizGroupSub, setWizGroupSub] = useState<string[]>([]);
  const [wizGroupCustom, setWizGroupCustom] = useState("");
  const [wizInterests, setWizInterests] = useState<string[]>([]);
  const [wizInterestInput, setWizInterestInput] = useState("");
  const [wizTravelDates, setWizTravelDates] = useState("");
  const [wizExtraNotes, setWizExtraNotes] = useState("");
  const [wizGenerating, setWizGenerating] = useState(false);
  const [wizNamePrompt, setWizNamePrompt] = useState(false);
  const [wizName, setWizName] = useState("");
  const [wizCreatedTrip, setWizCreatedTrip] = useState<Trip | null>(null);
  const [wizJustCreated, setWizJustCreated] = useState(false);
  const destInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadTrips(); }, []);
  useEffect(() => {
    if (mode === "wizard" && wizStep === 0) setTimeout(() => emailInputRef.current?.focus(), 100);
    if (mode === "wizard" && wizStep === 1) setTimeout(() => destInputRef.current?.focus(), 100);
  }, [mode, wizStep]);

  // Email autocomplete search
  useEffect(() => {
    if (!wizEmail || wizEmail.length < 2 || wizEmailLocked) { setWizEmailSuggestions([]); return; }
    const timeout = setTimeout(async () => {
      const { data } = await supabase.from("profiles").select("id, email, display_name").ilike("email", `%${wizEmail}%`).order("email").limit(5);
      if (data && data.length > 0) { setWizEmailSuggestions(data); setWizShowSuggestions(true); }
      else { setWizEmailSuggestions([]); setWizShowSuggestions(false); }
    }, 200);
    return () => clearTimeout(timeout);
  }, [wizEmail, wizEmailLocked]);

  async function loadTrips() {
    setLoading(true);
    try {
      const memberships = await getAllMemberships();
      const sessionTripIds = new Set(memberships.map(m => m.trip_id));
      const organizerTripIds = new Set(memberships.filter(m => m.role === "organizer").map(m => m.trip_id));
      const { data: allTrips } = await supabase.from("trips").select("*").order("created_at", { ascending: false });
      if (!allTrips) { setTrips([]); setLoading(false); return; }
      const cards: TripCard[] = [];
      for (const trip of allTrips) {
        const { count } = await supabase.from("trip_members").select("*", { count: "exact", head: true }).eq("trip_id", trip.id);
        cards.push({ trip: trip as Trip, memberCount: count || 0, hasSession: sessionTripIds.has(trip.id), isOrganizer: organizerTripIds.has(trip.id) });
      }
      setTrips(cards);
    } catch { setTrips([]); }
    setLoading(false);
  }

  async function handleTripClick(card: TripCard) {
    if (card.hasSession) { router.push(`/trip/${card.trip.id}`); return; }
    const { data: members } = await supabase.from("trip_members").select("*").eq("trip_id", card.trip.id).order("joined_at");
    if (members && members.length > 0) { setRejoinTrip(card.trip); setRejoinMembers(members as TripMember[]); }
    else router.push(`/trip/${card.trip.id}`);
  }

  async function handleRejoin(member: TripMember) {
    setRejoining(true); setError("");
    const result = await rejoinAsMember(member.id);
    if ("error" in result) { setError(result.error); setRejoining(false); return; }
    router.push(`/trip/${member.trip_id}`);
  }

  async function handleSaveTripName(tripId: string) {
    const name = editingName.trim();
    if (!name) { setEditingTripId(null); return; }
    await supabase.from("trips").update({ destination: name }).eq("id", tripId);
    setTrips(prev => prev.map(c => c.trip.id === tripId ? { ...c, trip: { ...c.trip, destination: name } } : c));
    setEditingTripId(null);
  }

  async function handleDeleteTrip(tripId: string) {
    if (!confirm("Delete this trip and all its data? This cannot be undone.")) return;
    setDeletingTripId(tripId);
    await supabase.from("trips").delete().eq("id", tripId);
    setTrips(prev => prev.filter(c => c.trip.id !== tripId));
    setDeletingTripId(null);
  }

  async function handleJoin() {
    if (!inviteCode.trim() || !joinName.trim()) { setError("Please fill in both fields."); return; }
    setJoining(true); setError("");
    const result = await joinTrip(inviteCode.trim(), joinName.trim());
    if ("error" in result) { setError(result.error); setJoining(false); return; }
    router.push(`/trip/${result.member.trip_id}`);
  }

  // --- Profile step handlers ---
  function selectProfileSuggestion(suggestion: { id: string; email: string; display_name: string }) {
    setWizEmail(suggestion.email);
    setWizEmailLocked(true);
    setWizProfileId(suggestion.id);
    setWizShowSuggestions(false);
    const parts = suggestion.display_name.split(" ");
    setWizFirstName(parts[0] || "");
    setWizLastName(parts.slice(1).join(" ") || "");
    setWizNameHighlight(true);
    setTimeout(() => setWizNameHighlight(false), 1000);
  }

  function handleEmailEnter() {
    if (!wizEmail.trim()) return;
    setWizEmailLocked(true);
    setWizShowSuggestions(false);
    // Check if typed email exactly matches a suggestion
    const match = wizEmailSuggestions.find(s => s.email.toLowerCase() === wizEmail.trim().toLowerCase());
    if (match) {
      setWizProfileId(match.id);
      const parts = match.display_name.split(" ");
      setWizFirstName(parts[0] || "");
      setWizLastName(parts.slice(1).join(" ") || "");
      setWizNameHighlight(true);
      setTimeout(() => setWizNameHighlight(false), 1000);
    } else {
      setTimeout(() => firstNameRef.current?.focus(), 100);
    }
  }

  async function handleProfileConfirm() {
    if (!wizEmail.trim() || !wizFirstName.trim()) return;
    const displayName = `${wizFirstName.trim()}${wizLastName.trim() ? ` ${wizLastName.trim()}` : ""}`;

    if (wizProfileId) {
      // Existing profile — advance
      setWizStep(1);
      return;
    }

    // New profile — create
    const avatarColors = ["#5DCAA5", "#85B7EB", "#ED93B1", "#F0997B", "#AFA9EC", "#EF9F27"];
    const color = avatarColors[Math.floor(Math.random() * avatarColors.length)];
    const { data, error: insertErr } = await supabase.from("profiles").insert({
      display_name: displayName,
      email: wizEmail.trim().toLowerCase(),
      avatar_color: color,
      avatar_initial: wizFirstName.trim().charAt(0).toUpperCase(),
    }).select("id").single();

    if (insertErr || !data) { setError("Failed to create profile. Please try again."); return; }
    setWizProfileId(data.id);
    setWizStep(1);
  }

  // --- Wizard handlers ---
  function handleDestSubmit() {
    if (!wizDest.trim()) return;
    const hint = parseDurationHint(wizDest);
    const cleaned = cleanDestination(wizDest);
    if (cleaned) setWizDest(cleaned);
    if (hint) { setWizDuration(hint); setWizStep(3); } // skip duration
    else setWizStep(2);
  }

  function selectDuration(val: string) { setWizDuration(val); setWizStep(3); }
  function handleDurationInput() {
    if (!wizDurationInput.trim()) return;
    setWizDuration(wizDurationInput.trim());
    setWizStep(3);
  }

  function selectGroup(val: string) {
    setWizGroup(val);
    setWizGroupDetail("");
    setWizGroupSub([]);
  }
  function selectSoloPet(hasPet: boolean) {
    setWizGroupDetail(hasPet ? "solo with pet" : "solo");
    setWizStep(4);
  }
  function selectFriendsCount(n: string) {
    setWizGroupDetail(`${n} friends`);
    setWizStep(4);
  }
  function toggleFamilySub(item: string) {
    setWizGroupSub(prev => prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item]);
  }
  function advanceFamilyStep() {
    const detail = wizGroupSub.length > 0 ? wizGroupSub.join(", ") : "family";
    setWizGroupDetail(detail);
    setWizStep(4);
  }

  function toggleInterest(v: string) {
    setWizInterests(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  }
  function addCustomInterest() {
    if (!wizInterestInput.trim()) return;
    if (!wizInterests.includes(wizInterestInput.trim())) setWizInterests(prev => [...prev, wizInterestInput.trim()]);
    setWizInterestInput("");
  }

  // Create trip record + save intake metadata, return tripId
  async function createTripFromIntake(): Promise<string | null> {
    setWizGenerating(true);
    const durLabel = wizDuration || "Trip";
    const durDays = durLabel === "Weekend" ? "3" : durLabel === "Short trip" ? "5" : durLabel === "Full week" ? "7" : durLabel === "Extended" ? "10" : durLabel;
    const cleanDest = cleanDestination(wizDest) || wizDest;
    const tripTitle = `${cleanDest} \u2014 ${durDays}-Day ${wizGroup || "Trip"}${wizGroup === "Family" ? " Trip" : wizGroup === "Friends" ? " Getaway" : wizGroup === "Solo" ? " Adventure" : ""}`;

    const organizerName = wizFirstName.trim() + (wizLastName.trim() ? ` ${wizLastName.trim()}` : "");
    const result = await createTrip(tripTitle, organizerName || "Organizer", wizProfileId || undefined);
    if ("error" in result) { setError(result.error); setWizGenerating(false); return null; }

    await supabase.from("trips").update({
      destination: cleanDest, duration: wizDuration, group_type: wizGroup || null,
      group_detail: wizGroupDetail || null, interests: wizInterests.join(", ") || null,
      travel_dates: wizTravelDates.trim() || null, extra_notes: wizExtraNotes.trim() || null,
    }).eq("id", result.tripId);

    return result.tripId;
  }

  async function handleCurate() {
    const tripId = await createTripFromIntake();
    if (!tripId) return;
    router.push(`/trip/${tripId}/curating`);
  }



  function generateWizardColors(count: number): string[] {
    if (count <= 0) return [];
    if (count === 1) return ["hsl(145, 55%, 33%)"];
    const hueStops = [145, 165, 180, 195, 220, 250, 280, 310];
    const satStops = [55, 60, 55, 50, 55, 50, 50, 45];
    const litStops = [33, 38, 40, 42, 42, 40, 38, 38];
    const colors: string[] = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const idx = t * (hueStops.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, hueStops.length - 1);
      const frac = idx - lo;
      colors.push(`hsl(${Math.round(hueStops[lo] + (hueStops[hi] - hueStops[lo]) * frac)}, ${Math.round(satStops[lo] + (satStops[hi] - satStops[lo]) * frac)}%, ${Math.round(litStops[lo] + (litStops[hi] - litStops[lo]) * frac)}%)`);
    }
    return colors;
  }

  function resetWizard() {
    setWizStep(0); setWizDest(""); setWizDuration(""); setWizDurationInput("");
    setWizGroup(""); setWizGroupDetail(""); setWizGroupSub([]); setWizGroupCustom("");
    setWizInterests([]); setWizInterestInput(""); setWizTravelDates(""); setWizExtraNotes(""); setWizGenerating(false); setWizNamePrompt(false);
    setWizName(""); setWizCreatedTrip(null); setWizJustCreated(false); setError("");
    setWizProfileId(null); setWizEmail(""); setWizEmailLocked(false); setWizFirstName(""); setWizLastName("");
    setWizEmailSuggestions([]); setWizShowSuggestions(false); setWizNameHighlight(false);
  }

  function formatDates(trip: Trip) {
    if (!trip.start_date && !trip.end_date) return "Dates TBD";
    const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (trip.start_date && trip.end_date) return `${fmt(trip.start_date)} – ${fmt(trip.end_date)}`;
    if (trip.start_date) return `Starts ${fmt(trip.start_date)}`;
    return `Ends ${fmt(trip.end_date!)}`;
  }

  function tripSummary(trip: Trip) {
    const parts: string[] = [];
    if (trip.destination) parts.push(trip.destination);
    if (trip.duration) parts.push(trip.duration);
    if (trip.group_type) parts.push(trip.group_type);
    return parts.join(" · ") || formatDates(trip);
  }

  // Completed answers for wizard breadcrumbs
  const wizAnswers: { label: string; value: string }[] = [];
  if (wizStep > 0 && wizFirstName) wizAnswers.push({ label: "Planner", value: `${wizFirstName}${wizLastName ? ` ${wizLastName}` : ""}` });
  if (wizStep > 1 && wizDest) wizAnswers.push({ label: "Destination", value: wizDest });
  if (wizStep > 2 && wizDuration) wizAnswers.push({ label: "Duration", value: wizDuration });
  if (wizStep > 3 && wizGroup) wizAnswers.push({ label: "Group", value: `${wizGroup}${wizGroupDetail ? ` (${wizGroupDetail})` : ""}` });
  if (wizStep > 4 && wizInterests.length > 0) wizAnswers.push({ label: "Interests", value: wizInterests.join(", ") });
  if (wizStep > 5 && wizTravelDates) wizAnswers.push({ label: "Dates", value: wizTravelDates });

  const chipClass = "px-4 py-2 rounded-full text-[13px] font-medium border transition-all cursor-pointer";
  const chipActive = "bg-emerald-500 text-white border-emerald-500";
  const chipInactive = "bg-white text-gray-700 border-gray-200 hover:border-emerald-300 hover:bg-emerald-50";
  const inputClass = "w-full max-w-sm mx-auto block text-[17px] text-center px-4 py-3.5 rounded-xl border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition-all";
  const btnPrimary = "px-6 py-3 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed";
  const btnSecondary = "px-6 py-3 rounded-xl bg-white border border-gray-200 text-gray-600 font-medium text-sm hover:bg-gray-50 transition-colors";

  return (
    <div className="h-screen bg-gray-50 overflow-y-auto">
      {/* CSS animations */}
      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.3s ease both; }
        @keyframes globe-spin { from { transform: translateX(0); } to { transform: translateX(-40px); } }
        .animate-globe-spin { animation: globe-spin 12s linear infinite; }
      `}</style>

      {/* Rejoin modal */}
      {rejoinTrip && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => { setRejoinTrip(null); setRejoinMembers([]); setError(""); }}>
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900 mb-1">Rejoin {rejoinTrip.name}</h2>
            <p className="text-xs text-gray-500 mb-4">Pick your name to get back into this trip.</p>
            <div className="space-y-1.5">
              {rejoinMembers.map(member => (
                <button key={member.id} onClick={() => handleRejoin(member)} disabled={rejoining}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-100 hover:border-emerald-200 hover:bg-emerald-50/50 transition-all text-left disabled:opacity-50">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold" style={{ backgroundColor: member.avatar_color }}>{member.avatar_initial}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{member.display_name}</div>
                    <div className="text-[10px] text-gray-400 capitalize">{member.role}</div>
                  </div>
                  <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
              ))}
            </div>
            {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2 mt-3">{error}</p>}
            <button onClick={() => { setRejoinTrip(null); setRejoinMembers([]); setError(""); }}
              className="w-full py-2 text-gray-400 text-xs hover:text-gray-600 transition-colors mt-3">Cancel</button>
          </div>
        </div>
      )}

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

      <div className="max-w-5xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-16">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3 animate-pulse">
              <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : mode === "home" ? (
          <>
            <div className="flex flex-col items-center justify-center min-h-[40vh] mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Family Trip Planner</h2>
              <div className="flex gap-2">
                <button onClick={() => { setMode("wizard"); resetWizard(); }}
                  className="py-3.5 px-6 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 transition-colors shadow-sm">
                  Create a new trip
                </button>
                <button onClick={() => { setMode("join"); setError(""); }}
                  className="py-3.5 px-6 rounded-xl bg-white border border-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-50 transition-colors">
                  Join with invite code
                </button>
              </div>
            </div>
            {trips.length > 0 ? (
              <div>
                <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Your trips</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {trips.map(card => (
                    <div key={card.trip.id} className="relative group">
                      <button onClick={() => handleTripClick(card)}
                        className="w-full bg-white rounded-xl border border-gray-100 hover:border-emerald-200 hover:shadow-sm transition-all overflow-hidden text-left">
                        <div className="h-28 w-full relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${card.trip.cover_color || "#1D9E75"}, #2563eb, #7c3aed)` }}>
                          {card.trip.cover_image_url && <img src={card.trip.cover_image_url} alt="" className="w-full h-full object-cover absolute inset-0" />}
                          <div className="absolute inset-0 bg-black/20" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-white font-bold text-xl drop-shadow-lg">{card.trip.destination || card.trip.name}</span>
                          </div>
                        </div>
                        <div className="p-3.5 text-center">
                          {editingTripId === card.trip.id ? (
                            <input type="text" value={editingName} onChange={e => setEditingName(e.target.value)}
                              autoFocus className="w-full text-center font-semibold text-[15px] text-gray-900 border border-emerald-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                              onKeyDown={e => { if (e.key === "Enter") handleSaveTripName(card.trip.id); if (e.key === "Escape") setEditingTripId(null); }}
                              onBlur={() => handleSaveTripName(card.trip.id)}
                              onClick={e => e.stopPropagation()} />
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <div className="font-semibold text-[15px] text-gray-900 truncate group-hover:text-emerald-700 transition-colors">{card.trip.destination || card.trip.name}</div>
                              <button onClick={e => { e.stopPropagation(); setEditingTripId(card.trip.id); setEditingName(card.trip.destination || card.trip.name); }}
                                className="shrink-0 w-5 h-5 flex items-center justify-center text-gray-300 hover:text-emerald-500 transition-colors opacity-0 group-hover:opacity-100">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                            </div>
                          )}
                          <div className="text-xs text-gray-500 mt-0.5">{card.trip.duration} · {card.memberCount} {card.memberCount === 1 ? "traveler" : "travelers"}</div>
                        </div>
                      </button>
                      {!card.hasSession && (
                        <span className="absolute top-3 left-3 text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">Rejoin</span>
                      )}
                      {card.isOrganizer && (
                        <button onClick={() => handleDeleteTrip(card.trip.id)} disabled={deletingTripId === card.trip.id}
                          className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-black/30 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white hover:bg-black/50 transition-colors opacity-0 group-hover:opacity-100"
                          title="Delete trip">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-10">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
                  </svg>
                </div>
                <h2 className="text-base font-semibold text-gray-900 mb-1">No trips yet</h2>
                <p className="text-sm text-gray-500">Create a trip or join one with an invite code.</p>
              </div>
            )}
          </>
        ) : mode === "wizard" ? (
          <div className="text-center">
            {/* Generating state */}
            {wizGenerating && (() => {
              const progressSteps = [
                "Checking must-see landmarks",
                "Researching weather and crowds",
                ...(wizExtraNotes.toLowerCase().match(/food|restaurant|eat|cuisine/) ? ["Finding the best food spots"] : []),
                ...(wizInterests.some(i => i.toLowerCase().match(/history|museum|heritage/)) ? ["Curating historical sites"] : []),
                ...(wizGroup === "Family" ? ["Filtering for family-friendly options"] : []),
                ...(wizExtraNotes.toLowerCase().match(/dog|pet/) ? ["Finding pet-friendly venues"] : []),
                "Building day-by-day draft",
              ];
              return (
                <div className="animate-fade-in py-16 flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full border-[3px] border-gray-200 border-t-purple-500 animate-spin mb-6" />
                  <p className="text-[18px] font-semibold text-gray-900 mb-2">Claude is curating your trip</p>
                  <p className="text-[13px] text-gray-500 mb-6">
                    Researching {wizDest || "your destination"}{wizTravelDates ? ` in ${wizTravelDates}` : ""} for your {wizGroup?.toLowerCase() || "group"}...
                  </p>
                  <div className="flex flex-col gap-2.5 text-left">
                    {progressSteps.map((step, i) => (
                      <div key={step} className="flex items-center gap-2.5 text-[13px] animate-fade-in" style={{ animationDelay: `${i * 1.2}s`, animationFillMode: "backwards" }}>
                        <svg className="w-4 h-4 text-purple-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-gray-700">{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Wizard steps */}
            {!wizGenerating && (
              <>
                {/* Completed answers breadcrumbs */}
                {wizAnswers.length > 0 && (
                  <div className="mb-6 flex flex-wrap justify-center gap-2">
                    {wizAnswers.map((a, i) => (
                      <span key={i} className="text-[12px] text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full inline-flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                        {a.value}
                      </span>
                    ))}
                  </div>
                )}

                {/* Step 0: Profile */}
                {wizStep === 0 && (
                  <div className="animate-fade-in py-8">
                    <h2 className="text-[18px] font-medium text-gray-900 mb-1">Who&apos;s planning?</h2>
                    <p className="text-[13px] text-gray-500 mb-6">We&apos;ll remember you for next time</p>
                    <div className="max-w-[400px] mx-auto">
                      {/* Email field */}
                      <div className="relative mb-4">
                        <input
                          ref={emailInputRef}
                          type="email"
                          value={wizEmail}
                          onChange={e => { if (!wizEmailLocked) setWizEmail(e.target.value); }}
                          onFocus={() => { if (wizEmailSuggestions.length > 0 && !wizEmailLocked) setWizShowSuggestions(true); }}
                          onKeyDown={e => { if (e.key === "Enter") handleEmailEnter(); }}
                          placeholder="Enter your email"
                          readOnly={wizEmailLocked}
                          className="w-full text-[16px] px-4 py-3 rounded-lg border text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 transition-all"
                          style={{ height: 44, borderColor: wizEmailLocked ? "#1D9E75" : undefined }}
                        />
                        {wizEmailLocked && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                            <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                            <button onClick={() => { setWizEmailLocked(false); setWizProfileId(null); setWizFirstName(""); setWizLastName(""); setTimeout(() => emailInputRef.current?.focus(), 50); }}
                              className="text-[11px] text-gray-400 hover:text-gray-600">change</button>
                          </div>
                        )}
                        {/* Skip for now */}
                        {!wizEmailLocked && (
                          <button onClick={() => setWizStep(1)}
                            className="absolute -bottom-7 left-0 right-0 text-[12px] text-gray-400 hover:text-gray-600 transition-colors">
                            Skip for now
                          </button>
                        )}
                        {/* Suggestions dropdown */}
                        {wizShowSuggestions && wizEmailSuggestions.length > 0 && !wizEmailLocked && (
                          <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-lg z-10"
                            style={{ border: "0.5px solid #e5e7eb", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
                            {wizEmailSuggestions.map(s => (
                              <button key={s.id} onClick={() => selectProfileSuggestion(s)}
                                className="w-full text-left px-4 py-2.5 hover:bg-emerald-50 transition-colors first:rounded-t-lg last:rounded-b-lg">
                                <div className="text-[13px] text-gray-900">{s.email}</div>
                                <div className="text-[12px] text-gray-500">{s.display_name}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* Name fields — show after email locked */}
                      {wizEmailLocked && (
                        <div className="animate-fade-in flex gap-3 mb-5">
                          <input
                            ref={firstNameRef}
                            type="text"
                            value={wizFirstName}
                            onChange={e => setWizFirstName(e.target.value)}
                            placeholder="First name"
                            className="flex-1 text-[16px] px-4 py-3 rounded-lg border text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 transition-all"
                            style={{ height: 44, borderColor: wizNameHighlight ? "#1D9E75" : undefined }}
                            onKeyDown={e => { if (e.key === "Enter") handleProfileConfirm(); }}
                          />
                          <input
                            type="text"
                            value={wizLastName}
                            onChange={e => setWizLastName(e.target.value)}
                            placeholder="Last name"
                            className="flex-1 text-[16px] px-4 py-3 rounded-lg border text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 transition-all"
                            style={{ height: 44, borderColor: wizNameHighlight ? "#1D9E75" : undefined }}
                            onKeyDown={e => { if (e.key === "Enter") handleProfileConfirm(); }}
                          />
                        </div>
                      )}
                      {/* Continue button */}
                      {wizEmailLocked && wizFirstName.trim() && (
                        <button onClick={handleProfileConfirm}
                          className="w-full py-3 rounded-lg text-white font-semibold text-[14px] transition-colors"
                          style={{ backgroundColor: "#1D9E75" }}>
                          Continue
                        </button>
                      )}
                      {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2 mt-3">{error}</p>}
                    </div>
                  </div>
                )}

                {/* Step 1: Destination */}
                {wizStep === 1 && (
                  <div className="animate-fade-in py-4">
                    <RotatingGlobe />
                    <h2 className="text-[26px] font-bold text-gray-900 mb-6">Where are we going?</h2>
                    <input ref={destInputRef} type="text" value={wizDest} onChange={e => setWizDest(e.target.value)}
                      placeholder="Italy, Northern Michigan, Costa Rica..."
                      className={inputClass} onKeyDown={e => e.key === "Enter" && handleDestSubmit()} />
                    <div className="flex justify-center mt-6">
                      <button onClick={() => setWizStep(0)} className={btnSecondary}>Back</button>
                    </div>
                  </div>
                )}

                {/* Step 2: Duration */}
                {wizStep === 2 && (
                  <div className="animate-fade-in py-8">
                    <input type="text" value={wizDurationInput} onChange={e => setWizDurationInput(e.target.value)}
                      placeholder="e.g. 10 days, 2 weeks..." autoFocus
                      className={inputClass} onKeyDown={e => e.key === "Enter" && handleDurationInput()} />
                    <div className="flex flex-wrap justify-center gap-2 mt-5">
                      {["Weekend", "Short trip", "Full week", "Extended"].map(d => (
                        <button key={d} onClick={() => selectDuration(d)}
                          className={`${chipClass} ${wizDuration === d ? chipActive : chipInactive}`}>{d}</button>
                      ))}
                    </div>
                    <div className="flex justify-center mt-6">
                      <button onClick={() => setWizStep(1)} className={btnSecondary}>Back</button>
                    </div>
                  </div>
                )}

                {/* Step 3: Group */}
                {wizStep === 3 && (
                  <div className="animate-fade-in py-8">
                    <input type="text" value={wizGroupCustom} onChange={e => setWizGroupCustom(e.target.value)}
                      placeholder="e.g. me and my wife, 5 of us..." autoFocus
                      className={inputClass} onKeyDown={e => { if (e.key === "Enter" && wizGroupCustom.trim()) { setWizGroupDetail(wizGroupCustom.trim()); setWizGroup("Custom"); setWizStep(4); } }} />
                    <div className="flex flex-wrap justify-center gap-2 mt-5">
                      {["Solo", "Friends", "Family"].map(g => (
                        <button key={g} onClick={() => selectGroup(g)}
                          className={`${chipClass} ${wizGroup === g ? chipActive : chipInactive}`}>{g}</button>
                      ))}
                    </div>

                    {/* Sub-options */}
                    {wizGroup === "Solo" && (
                      <div className="animate-fade-in flex items-center justify-center gap-3 mt-4">
                        <span className="text-[13px] text-gray-600">Pets?</span>
                        <button onClick={() => selectSoloPet(true)} className={`${chipClass} ${chipInactive} text-[12px] px-3 py-1.5`}>Yes</button>
                        <button onClick={() => selectSoloPet(false)} className={`${chipClass} ${chipInactive} text-[12px] px-3 py-1.5`}>No</button>
                      </div>
                    )}
                    {wizGroup === "Friends" && (
                      <div className="animate-fade-in flex items-center justify-center gap-2 mt-4">
                        <span className="text-[13px] text-gray-600">How many?</span>
                        {["2", "3", "4", "5", "6+"].map(n => (
                          <button key={n} onClick={() => selectFriendsCount(n)} className={`${chipClass} ${chipInactive} text-[12px] px-3 py-1.5`}>{n}</button>
                        ))}
                      </div>
                    )}
                    {wizGroup === "Family" && (
                      <div className="animate-fade-in mt-4">
                        <div className="flex flex-wrap justify-center gap-2">
                          {["Babies", "Toddlers", "Kids", "Teens", "Grandparents"].map(item => (
                            <button key={item} onClick={() => toggleFamilySub(item)}
                              className={`${chipClass} text-[12px] px-3 py-1.5 ${wizGroupSub.includes(item) ? chipActive : chipInactive}`}>{item}</button>
                          ))}
                          <button onClick={() => { const custom = prompt("Add who else?"); if (custom) toggleFamilySub(custom); }}
                            className={`${chipClass} text-[12px] px-3 py-1.5 ${chipInactive}`}>&amp; more</button>
                        </div>
                        <div className="flex justify-center gap-3 mt-5">
                          <button onClick={() => setWizStep(2)} className={btnSecondary}>Back</button>
                          <button onClick={advanceFamilyStep} className={btnPrimary}>Next</button>
                        </div>
                      </div>
                    )}

                    {!wizGroup && (
                      <div className="flex justify-center mt-6">
                        <button onClick={() => setWizStep(wizDuration ? 2 : 1)} className={btnSecondary}>Back</button>
                      </div>
                    )}
                  </div>
                )}

                {/* Step 4: Interests */}
                {wizStep === 4 && (
                  <div className="animate-fade-in py-8">
                    <input type="text" value={wizInterestInput} onChange={e => setWizInterestInput(e.target.value)}
                      placeholder="e.g. wine tasting, snorkeling..." autoFocus
                      className={inputClass} onKeyDown={e => e.key === "Enter" && addCustomInterest()} />
                    <div className="flex flex-wrap justify-center gap-2 mt-5 max-w-md mx-auto">
                      {["History & culture", "Outdoors & hiking", "Food & local cuisine", "Beaches & water", "Art & museums", "Family fun", "Relaxing & slow pace", "Adventure & thrills"].map(v => (
                        <button key={v} onClick={() => toggleInterest(v)}
                          className={`${chipClass} text-[12px] px-3 py-1.5 ${wizInterests.includes(v) ? chipActive : chipInactive}`}>{v}</button>
                      ))}
                      {/* Custom interests */}
                      {wizInterests.filter(v => !["History & culture", "Outdoors & hiking", "Food & local cuisine", "Beaches & water", "Art & museums", "Family fun", "Relaxing & slow pace", "Adventure & thrills"].includes(v)).map(v => (
                        <button key={v} onClick={() => toggleInterest(v)}
                          className={`${chipClass} text-[12px] px-3 py-1.5 ${chipActive}`}>{v}</button>
                      ))}
                    </div>
                    <div className="flex justify-center gap-3 mt-6">
                      <button onClick={() => setWizStep(3)} className={btnSecondary}>Back</button>
                      <button onClick={() => setWizStep(5)} className={btnPrimary}>Next</button>
                    </div>
                  </div>
                )}

                {/* Step 5: Travel Dates */}
                {wizStep === 5 && (
                  <div className="animate-fade-in py-8">
                    <input type="text" value={wizTravelDates} onChange={e => setWizTravelDates(e.target.value)}
                      placeholder="e.g. July 2026, Spring Break, Dec 15-22..."
                      autoFocus className={inputClass} onKeyDown={e => { if (e.key === "Enter" && wizTravelDates.trim()) setWizStep(6); }} />
                    <div className="flex flex-wrap justify-center gap-2 mt-5 max-w-sm mx-auto">
                      {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(m => (
                        <button key={m} onClick={() => { setWizTravelDates(m); setWizStep(6); }}
                          className={`${chipClass} text-[12px] px-3 py-1.5 ${wizTravelDates === m ? chipActive : chipInactive}`}>{m}</button>
                      ))}
                    </div>
                    <div className="flex justify-center mt-6">
                      <button onClick={() => setWizStep(4)} className={btnSecondary}>Back</button>
                    </div>
                  </div>
                )}

                {/* Step 6: Extra Notes */}
                {wizStep === 6 && (
                  <div className="animate-fade-in py-8">
                    <h2 className="text-[20px] font-bold text-gray-900 mb-6">Anything else I should know?</h2>
                    <input type="text" value={wizExtraNotes} onChange={e => setWizExtraNotes(e.target.value)}
                      placeholder="Must-see spots, dietary needs, mobility concerns, budget..."
                      autoFocus className={inputClass} />
                    <div className="flex justify-center gap-3 mt-6">
                      <button onClick={() => setWizStep(5)} className={btnSecondary}>Back</button>
                    </div>
                    <div className="mt-5 max-w-md mx-auto">
                      <button onClick={handleCurate} disabled={wizGenerating}
                        className="w-full rounded-lg text-white font-medium text-[15px] transition-colors disabled:opacity-50"
                        style={{ backgroundColor: "#1D9E75", padding: "14px 0", borderRadius: "8px" }}>
                        Curate my trip
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Cancel */}
            {!wizGenerating && (
              <button onClick={() => { setMode("home"); resetWizard(); }}
                className="mt-4 text-gray-400 text-xs hover:text-gray-600 transition-colors">Cancel</button>
            )}
          </div>
        ) : (
          /* Join mode */
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Join a trip</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Invite code</label>
                <input type="text" value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="Paste invite code" autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Your name</label>
                <input type="text" value={joinName} onChange={e => setJoinName(e.target.value)} placeholder="Your first name"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                  onKeyDown={e => e.key === "Enter" && handleJoin()} />
              </div>
              {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button onClick={handleJoin} disabled={joining} className="w-full py-3.5 px-4 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 transition-colors shadow-sm disabled:opacity-50">
                {joining ? "Joining..." : "Join trip"}
              </button>
              <button onClick={() => { setMode("home"); setError(""); }} className="w-full py-2 text-gray-400 text-xs hover:text-gray-600 transition-colors">Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
