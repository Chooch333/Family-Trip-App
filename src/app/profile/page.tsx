"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getSessionTokens } from "@/lib/session";
import type { Profile, Trip } from "@/lib/database.types";

const AVATAR_COLORS = ["#1D9E75", "#534AB7", "#D85A30", "#D4537E", "#378ADD", "#639922", "#BA7517", "#E24B4A"];

const BORDER = "#e5e7eb";

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  preference: { bg: "#E1F5EE", text: "#0F6E56" },
  history: { bg: "#E6F1FB", text: "#185FA5" },
  observation: { bg: "#EEEDFE", text: "#534AB7" },
  group: { bg: "#FAEEDA", text: "#854F0B" },
  dislike: { bg: "#FAECE7", text: "#993C1D" },
};

interface Memory {
  id: string;
  category: string;
  content: string;
  source_trip_id: string | null;
  active: boolean;
  fading?: boolean;
}

interface TripRow {
  trip: Trip;
  role: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [savedField, setSavedField] = useState<string | null>(null);
  const savedTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Editable fields
  const [displayName, setDisplayName] = useState("");
  const [homeLocation, setHomeLocation] = useState("");
  const [bio, setBio] = useState("");
  const [dietary, setDietary] = useState("");
  const [mobility, setMobility] = useState("");
  const [travelStyle, setTravelStyle] = useState("");

  useEffect(() => {
    async function load() {
      // Find current profile via session tokens → trip_members → profile_id
      const tokens = getSessionTokens();
      let profileId: string | null = null;
      let fallbackMember: { id: string; display_name: string; avatar_color: string; avatar_initial: string } | null = null;
      for (const token of tokens) {
        const { data: member } = await supabase.from("trip_members").select("id, profile_id, display_name, avatar_color, avatar_initial").eq("session_token", token).maybeSingle();
        if (member?.profile_id) { profileId = member.profile_id; break; }
        if (member && !fallbackMember) fallbackMember = member;
      }
      // If no profile linked, auto-create one from the member data and link it
      if (!profileId && fallbackMember) {
        const { data: newProfile } = await supabase.from("profiles").insert({
          display_name: fallbackMember.display_name,
          avatar_color: fallbackMember.avatar_color,
          avatar_initial: fallbackMember.avatar_initial,
          email: `${fallbackMember.display_name.toLowerCase().replace(/\s+/g, ".")}@placeholder`,
        }).select().single();
        if (newProfile) {
          profileId = newProfile.id;
          // Link profile to all this user's trip_members
          for (const token of tokens) {
            await supabase.from("trip_members").update({ profile_id: profileId }).eq("session_token", token).is("profile_id", null);
          }
        }
      }
      if (!profileId) { router.replace("/"); return; }

      const { data: p } = await supabase.from("profiles").select("*").eq("id", profileId).single();
      if (!p) { router.replace("/"); return; }
      const prof = p as Profile;
      setProfile(prof);
      setDisplayName(prof.display_name || "");
      setHomeLocation(prof.home_location || "");
      setBio(prof.bio || "");
      setDietary(prof.dietary || "");
      setMobility(prof.mobility || "");
      setTravelStyle(prof.travel_style || "");

      // Load memories
      const { data: mems } = await supabase.from("profile_memories").select("id, category, content, source_trip_id, active")
        .eq("profile_id", profileId).eq("active", true).order("created_at", { ascending: false });
      if (mems) setMemories(mems);

      // Load trips via trip_members join
      const { data: memberRows } = await supabase.from("trip_members").select("role, trip_id").eq("profile_id", profileId);
      if (memberRows && memberRows.length > 0) {
        const tripIds = memberRows.map(m => m.trip_id);
        const { data: tripData } = await supabase.from("trips").select("*").in("id", tripIds).order("created_at", { ascending: false });
        if (tripData) {
          const roleMap = new Map(memberRows.map(m => [m.trip_id, m.role]));
          setTrips(tripData.map(t => ({ trip: t as Trip, role: roleMap.get(t.id) || "member" })));
        }
      }

      setLoading(false);
    }
    load();
  }, [router]);

  const showSaved = useCallback((field: string) => {
    setSavedField(field);
    if (savedTimeout.current) clearTimeout(savedTimeout.current);
    savedTimeout.current = setTimeout(() => setSavedField(null), 2000);
  }, []);

  async function saveField(field: string, value: string) {
    if (!profile) return;
    await supabase.from("profiles").update({ [field]: value.trim() || null, updated_at: new Date().toISOString() }).eq("id", profile.id);
    showSaved(field);
  }

  async function changeColor(color: string) {
    if (!profile) return;
    await supabase.from("profiles").update({ avatar_color: color, updated_at: new Date().toISOString() }).eq("id", profile.id);
    setProfile(p => p ? { ...p, avatar_color: color } : p);
  }

  async function deleteMemory(memId: string) {
    setMemories(prev => prev.map(m => m.id === memId ? { ...m, fading: true } : m));
    await supabase.from("profile_memories").update({ active: false }).eq("id", memId);
    setTimeout(() => setMemories(prev => prev.filter(m => m.id !== memId)), 200);
  }

  const [showColors, setShowColors] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-gray-200 border-t-emerald-500 animate-spin" />
      </div>
    );
  }

  if (!profile) return null;

  const labelClass = "block text-[12px] text-gray-500 mb-1.5 font-medium";
  const inputFieldClass = "w-full text-[14px] px-3.5 py-2.5 rounded-lg border text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition-all";

  function SavedBadge({ field }: { field: string }) {
    if (savedField !== field) return null;
    return <span className="text-[12px] font-medium ml-2 transition-opacity" style={{ color: "#1D9E75" }}>Saved</span>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-[18px] font-medium text-gray-900">Your profile</h1>
        </div>

        {/* Section 1 — Identity */}
        <div className="bg-white rounded-lg mb-4" style={{ border: `0.5px solid ${BORDER}`, padding: 20 }}>
          {/* Avatar */}
          <div className="flex flex-col items-center mb-5">
            <div className="flex items-center justify-center text-white text-[24px] font-semibold"
              style={{ width: 64, height: 64, borderRadius: "50%", backgroundColor: profile.avatar_color }}>
              {profile.avatar_initial}
            </div>
            <button onClick={() => setShowColors(c => !c)} className="text-[12px] text-gray-500 hover:text-gray-700 mt-2 transition-colors">
              change color
            </button>
            {showColors && (
              <div className="flex gap-2 mt-2">
                {AVATAR_COLORS.map(c => (
                  <button key={c} onClick={() => { changeColor(c); setShowColors(false); }}
                    className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                    style={{ backgroundColor: c, border: c === profile.avatar_color ? "2px solid #111" : "2px solid transparent" }} />
                ))}
              </div>
            )}
          </div>
          {/* Name */}
          <div className="mb-4">
            <label className={labelClass}>Name <SavedBadge field="display_name" /></label>
            <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
              onBlur={() => saveField("display_name", displayName)} className={inputFieldClass} style={{ borderColor: BORDER }} />
          </div>
          {/* Email */}
          <div className="mb-4">
            <label className={labelClass}>Email</label>
            <input type="email" value={profile.email} readOnly className={inputFieldClass}
              style={{ borderColor: BORDER, backgroundColor: "#f9fafb", color: "#9ca3af", cursor: "not-allowed" }} />
          </div>
          {/* Home location */}
          <div>
            <label className={labelClass}>Home location <SavedBadge field="home_location" /></label>
            <input type="text" value={homeLocation} onChange={e => setHomeLocation(e.target.value)}
              onBlur={() => saveField("home_location", homeLocation)} placeholder="City, State" className={inputFieldClass} style={{ borderColor: BORDER }} />
          </div>
        </div>

        {/* Section 2 — Travel preferences */}
        <div className="bg-white rounded-lg mb-4" style={{ border: `0.5px solid ${BORDER}`, padding: 20 }}>
          <div className="mb-4">
            <label className={labelClass}>About you <SavedBadge field="bio" /></label>
            <textarea rows={3} value={bio} onChange={e => setBio(e.target.value)}
              onBlur={() => saveField("bio", bio)}
              placeholder="Tell Claude about yourself — family, interests, how you like to travel..."
              className={inputFieldClass} style={{ borderColor: BORDER, resize: "none" }} />
          </div>
          <div className="mb-4">
            <label className={labelClass}>Dietary needs <SavedBadge field="dietary" /></label>
            <input type="text" value={dietary} onChange={e => setDietary(e.target.value)}
              onBlur={() => saveField("dietary", dietary)}
              placeholder="e.g., no shellfish, vegetarian, kids are picky" className={inputFieldClass} style={{ borderColor: BORDER }} />
          </div>
          <div className="mb-4">
            <label className={labelClass}>Mobility considerations <SavedBadge field="mobility" /></label>
            <input type="text" value={mobility} onChange={e => setMobility(e.target.value)}
              onBlur={() => saveField("mobility", mobility)}
              placeholder="e.g., stroller, wheelchair, limited walking" className={inputFieldClass} style={{ borderColor: BORDER }} />
          </div>
          <div>
            <label className={labelClass}>Travel style <SavedBadge field="travel_style" /></label>
            <input type="text" value={travelStyle} onChange={e => setTravelStyle(e.target.value)}
              onBlur={() => saveField("travel_style", travelStyle)}
              placeholder="e.g., slow mornings, hidden gems, packed days" className={inputFieldClass} style={{ borderColor: BORDER }} />
          </div>
        </div>

        {/* Section 3 — What Claude remembers */}
        <div className="bg-white rounded-lg mb-4" style={{ border: `0.5px solid ${BORDER}`, padding: 20 }}>
          <h3 className="text-[14px] font-medium text-gray-900 mb-1">What Claude knows about you</h3>
          <p className="text-[12px] text-gray-500 mb-3">Claude learns from your conversations. You control what it remembers.</p>
          {memories.length > 0 ? (
            <div>
              {memories.map(mem => {
                const style = CATEGORY_STYLES[mem.category] || CATEGORY_STYLES.observation;
                return (
                  <div key={mem.id} className="flex items-center py-2 transition-opacity"
                    style={{ borderBottom: `0.5px solid ${BORDER}`, opacity: mem.fading ? 0 : 1, transition: "opacity 200ms" }}>
                    <span className="flex-shrink-0 text-[10px] font-medium px-2 py-0.5"
                      style={{ backgroundColor: style.bg, color: style.text, borderRadius: 8, display: "inline-block" }}>
                      {mem.category}
                    </span>
                    <span className="text-[13px] text-gray-900 flex-1 ml-2.5 min-w-0 truncate">{mem.content}</span>
                    <button onClick={() => deleteMemory(mem.id)}
                      className="flex-shrink-0 ml-2 w-4 h-4 flex items-center justify-center text-gray-400 hover:text-red-600 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-5">
              <p className="text-[13px] text-gray-500">No memories yet. Claude will learn about you as you plan trips together.</p>
            </div>
          )}
        </div>

        {/* Section 4 — Your trips */}
        <div className="bg-white rounded-lg" style={{ border: `0.5px solid ${BORDER}`, padding: 20 }}>
          <h3 className="text-[14px] font-medium text-gray-900 mb-3">Your trips</h3>
          {trips.length > 0 ? (
            <div>
              {trips.map(({ trip: t, role }) => (
                <button key={t.id} onClick={() => router.push(`/trip/${t.id}`)}
                  className="w-full flex items-center py-2.5 text-left hover:bg-gray-50 transition-colors rounded -mx-1 px-1"
                  style={{ borderBottom: `0.5px solid ${BORDER}` }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-gray-900 truncate">{t.destination || t.name}</div>
                    <div className="text-[12px] text-gray-500 truncate">{[t.destination && t.name !== t.destination ? t.name : null, t.duration].filter(Boolean).join(" · ") || "Trip"}</div>
                  </div>
                  <span className="flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-md ml-2"
                    style={role === "organizer" ? { backgroundColor: "#E1F5EE", color: "#0F6E56" } : { backgroundColor: "#F1EFE8", color: "#5F5E5A" }}>
                    {role === "organizer" ? "Organizer" : "Member"}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-gray-500 text-center py-3">No trips yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
