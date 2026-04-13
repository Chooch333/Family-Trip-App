"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getSessionTokens } from "@/lib/session";
import type { Profile } from "@/lib/database.types";

const AVATAR_COLORS = ["#1D9E75", "#534AB7", "#D85A30", "#D4537E", "#378ADD", "#639922", "#BA7517", "#E24B4A"];

const BORDER = "#e5e7eb";

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedField, setSavedField] = useState<string | null>(null);
  const savedTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Editable fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  useEffect(() => {
    async function load() {
      const tokens = getSessionTokens();
      let profileId: string | null = null;
      let fallbackMember: { id: string; display_name: string; avatar_color: string; avatar_initial: string } | null = null;
      for (const token of tokens) {
        const { data: member } = await supabase.from("trip_members").select("id, profile_id, display_name, avatar_color, avatar_initial").eq("session_token", token).maybeSingle();
        if (member?.profile_id) { profileId = member.profile_id; break; }
        if (member && !fallbackMember) fallbackMember = member;
      }
      if (!profileId && fallbackMember) {
        const { data: newProfile } = await supabase.from("profiles").insert({
          display_name: fallbackMember.display_name,
          avatar_color: fallbackMember.avatar_color,
          avatar_initial: fallbackMember.avatar_initial,
          email: `${fallbackMember.display_name.toLowerCase().replace(/\s+/g, ".")}@placeholder`,
        }).select().single();
        if (newProfile) {
          profileId = newProfile.id;
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
      // Split display_name into first/last
      const parts = (prof.display_name || "").trim().split(/\s+/);
      setFirstName(parts[0] || "");
      setLastName(parts.slice(1).join(" ") || "");

      setLoading(false);
    }
    load();
  }, [router]);

  const showSaved = useCallback((field: string) => {
    setSavedField(field);
    if (savedTimeout.current) clearTimeout(savedTimeout.current);
    savedTimeout.current = setTimeout(() => setSavedField(null), 2000);
  }, []);

  async function saveName(first: string, last: string) {
    if (!profile) return;
    const fullName = [first.trim(), last.trim()].filter(Boolean).join(" ");
    const initial = fullName.charAt(0).toUpperCase() || profile.avatar_initial;
    await supabase.from("profiles").update({ display_name: fullName || null, avatar_initial: initial, updated_at: new Date().toISOString() }).eq("id", profile.id);
    setProfile(p => p ? { ...p, display_name: fullName, avatar_initial: initial } : p);
    showSaved("name");
  }

  async function changeColor(color: string) {
    if (!profile) return;
    await supabase.from("profiles").update({ avatar_color: color, updated_at: new Date().toISOString() }).eq("id", profile.id);
    setProfile(p => p ? { ...p, avatar_color: color } : p);
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
    <div className="h-screen bg-gray-50 overflow-y-auto">
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

        {/* Identity */}
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
          {/* First name */}
          <div className="mb-4">
            <label className={labelClass}>First name <SavedBadge field="name" /></label>
            <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
              onBlur={() => saveName(firstName, lastName)} className={inputFieldClass} style={{ borderColor: BORDER }} />
          </div>
          {/* Last name */}
          <div className="mb-4">
            <label className={labelClass}>Last name <SavedBadge field="name" /></label>
            <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
              onBlur={() => saveName(firstName, lastName)} className={inputFieldClass} style={{ borderColor: BORDER }} />
          </div>
          {/* Email */}
          <div>
            <label className={labelClass}>Email</label>
            <input type="email" value={profile.email} readOnly className={inputFieldClass}
              style={{ borderColor: BORDER, backgroundColor: "#f9fafb", color: "#9ca3af", cursor: "not-allowed" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
