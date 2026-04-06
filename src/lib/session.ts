import { supabase } from "./supabase";
import { nanoid } from "nanoid";
import type { TripMember } from "./database.types";

const SESSION_KEY = "trip_session_token";

export const AVATAR_COLORS = [
  "#5DCAA5", "#85B7EB", "#ED93B1", "#F0997B", "#AFA9EC", "#EF9F27", "#5DCAA5", "#85B7EB",
];

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SESSION_KEY);
}

export function setSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SESSION_KEY, token);
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
}

export async function getCurrentMember(): Promise<TripMember | null> {
  const token = getSessionToken();
  if (!token) return null;
  const { data, error } = await supabase.from("trip_members").select("*").eq("session_token", token).single();
  if (error || !data) return null;
  await supabase.from("trip_members").update({ is_online: true, last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return data as TripMember;
}

export async function joinTrip(
  inviteCode: string, displayName: string
): Promise<{ member: TripMember; token: string } | { error: string }> {
  const { data: trip, error: tripError } = await supabase.from("trips").select("id").eq("invite_code", inviteCode).single();
  if (tripError || !trip) return { error: "Trip not found. Check the invite link and try again." };

  const { data: existing } = await supabase.from("trip_members").select("id, session_token").eq("trip_id", trip.id).eq("display_name", displayName).single();
  if (existing?.session_token) {
    setSessionToken(existing.session_token);
    const member = await getCurrentMember();
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
  setSessionToken(sessionToken);
  return { member: member as TripMember, token: sessionToken };
}

export async function createTrip(
  tripName: string, organizerName: string
): Promise<{ tripId: string; inviteCode: string; member: TripMember } | { error: string }> {
  const inviteCode = nanoid(10);
  const sessionToken = nanoid(32);

  const { data: trip, error: tripError } = await supabase.from("trips").insert({
    name: tripName, invite_code: inviteCode, cover_color: "#1D9E75",
  }).select().single();
  if (tripError || !trip) return { error: "Failed to create trip. Please try again." };

  const { data: member, error: memberError } = await supabase.from("trip_members").insert({
    trip_id: trip.id, display_name: organizerName, avatar_color: AVATAR_COLORS[0],
    avatar_initial: organizerName.charAt(0).toUpperCase(), role: "organizer",
    session_token: sessionToken, is_online: true, last_seen_at: new Date().toISOString(),
  }).select().single();
  if (memberError || !member) return { error: "Trip created but failed to add you. Please try again." };

  await supabase.from("trips").update({ created_by: member.id }).eq("id", trip.id);
  setSessionToken(sessionToken);
  return { tripId: trip.id, inviteCode, member: member as TripMember };
}
