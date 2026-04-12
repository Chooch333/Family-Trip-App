import { supabase } from "./supabase";
import { nanoid } from "nanoid";
import type { TripMember } from "./database.types";

const TOKENS_KEY = "trip_session_tokens";
const OLD_SESSION_KEY = "trip_session_token";

export const AVATAR_COLORS = [
  "#5DCAA5", "#85B7EB", "#ED93B1", "#F0997B", "#AFA9EC", "#EF9F27", "#5DCAA5", "#85B7EB",
];

export function getSessionTokens(): string[] {
  if (typeof window === "undefined") return [];
  try {
    // Migrate old single-token format on first access
    const old = localStorage.getItem(OLD_SESSION_KEY);
    if (old) {
      const existing = localStorage.getItem(TOKENS_KEY);
      const tokens: string[] = existing ? JSON.parse(existing) : [];
      if (!tokens.includes(old)) tokens.push(old);
      localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
      localStorage.removeItem(OLD_SESSION_KEY);
    }
    const raw = localStorage.getItem(TOKENS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export function addSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  const tokens = getSessionTokens();
  if (!tokens.includes(token)) tokens.push(token);
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

export function getSessionToken(): string | null {
  const tokens = getSessionTokens();
  return tokens.length > 0 ? tokens[tokens.length - 1] : null;
}

export function setSessionToken(token: string): void {
  addSessionToken(token);
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKENS_KEY);
  localStorage.removeItem(OLD_SESSION_KEY);
}

export async function getCurrentMember(): Promise<TripMember | null> {
  const token = getSessionToken();
  if (!token) return null;
  const { data, error } = await supabase.from("trip_members").select("*").eq("session_token", token).maybeSingle();
  if (error || !data) return null;
  await supabase.from("trip_members").update({ is_online: true, last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return data as TripMember;
}

export async function getMemberForTrip(tripId: string): Promise<TripMember | null> {
  const tokens = getSessionTokens();
  if (tokens.length === 0) return null;
  for (const token of tokens) {
    const { data } = await supabase.from("trip_members").select("*").eq("session_token", token).eq("trip_id", tripId).maybeSingle();
    if (data) return data as TripMember;
  }
  return null;
}

export async function getAllMemberships(): Promise<TripMember[]> {
  const tokens = getSessionTokens();
  if (tokens.length === 0) return [];
  const members: TripMember[] = [];
  for (const token of tokens) {
    const { data } = await supabase.from("trip_members").select("*").eq("session_token", token).maybeSingle();
    if (data) members.push(data as TripMember);
  }
  return members;
}

export async function rejoinAsMember(memberId: string): Promise<{ member: TripMember; token: string } | { error: string }> {
  const sessionToken = nanoid(32);
  const { data, error } = await supabase.from("trip_members").update({
    session_token: sessionToken, is_online: true, last_seen_at: new Date().toISOString(),
  }).eq("id", memberId).select().single();
  if (error || !data) return { error: "Failed to rejoin. Please try again." };
  addSessionToken(sessionToken);
  return { member: data as TripMember, token: sessionToken };
}

export async function joinTrip(
  inviteCode: string, displayName: string
): Promise<{ member: TripMember; token: string } | { error: string }> {
  const { data: trip, error: tripError } = await supabase.from("trips").select("id").eq("invite_code", inviteCode).maybeSingle();
  if (tripError || !trip) return { error: "Trip not found. Check the invite link and try again." };

  const { data: existing } = await supabase.from("trip_members").select("id, session_token").eq("trip_id", trip.id).eq("display_name", displayName).maybeSingle();
  if (existing?.session_token) {
    addSessionToken(existing.session_token);
    const member = await getMemberForTrip(trip.id);
    if (member) return { member, token: existing.session_token };
  }

  const { count } = await supabase.from("trip_members").select("*", { count: "exact", head: true }).eq("trip_id", trip.id);
  const colorIndex = (count || 0) % AVATAR_COLORS.length;
  const sessionToken = nanoid(32);

  const { data: member, error: memberError } = await supabase.from("trip_members").insert({
    trip_id: trip.id, display_name: displayName, avatar_color: AVATAR_COLORS[colorIndex],
    avatar_initial: displayName.charAt(0).toUpperCase(),
    role: (count || 0) === 0 ? "organizer" : "member",
    session_token: sessionToken, is_online: true, last_seen_at: new Date().toISOString(),
  }).select().single();

  if (memberError || !member) return { error: "Failed to join trip. Please try again." };
  if ((count || 0) === 0) await supabase.from("trips").update({ created_by: member.id }).eq("id", trip.id);
  addSessionToken(sessionToken);
  return { member: member as TripMember, token: sessionToken };
}

export async function createTrip(
  tripName: string, organizerName: string, profileId?: string
): Promise<{ tripId: string; inviteCode: string; member: TripMember } | { error: string }> {
  const inviteCode = nanoid(10);
  const sessionToken = nanoid(32);

  const { data: trip, error: tripError } = await supabase.from("trips").insert({
    name: tripName, invite_code: inviteCode, cover_color: "#1D9E75",
  }).select().single();
  if (tripError || !trip) return { error: "Failed to create trip. Please try again." };

  const memberInsert: Record<string, unknown> = {
    trip_id: trip.id, display_name: organizerName, avatar_color: AVATAR_COLORS[0],
    avatar_initial: organizerName.charAt(0).toUpperCase(), role: "organizer",
    session_token: sessionToken, is_online: true, last_seen_at: new Date().toISOString(),
  };
  if (profileId) memberInsert.profile_id = profileId;

  const { data: member, error: memberError } = await supabase.from("trip_members").insert(memberInsert).select().single();
  if (memberError || !member) return { error: "Trip created but failed to add you. Please try again." };

  await supabase.from("trips").update({ created_by: member.id }).eq("id", trip.id);
  addSessionToken(sessionToken);
  return { tripId: trip.id, inviteCode, member: member as TripMember };
}
