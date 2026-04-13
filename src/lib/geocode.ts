import { supabase } from "./supabase";

/**
 * Geocode a stop by name (with optional destination context) and update its
 * coordinates in Supabase. Returns the coordinates if successful.
 */
export async function geocodeAndUpdateStop(
  stopId: string,
  stopName: string,
  destination?: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const query = destination ? `${stopName}, ${destination}` : stopName;
  try {
    const res = await fetch(`/api/geocode?${new URLSearchParams({ q: query })}`);
    if (!res.ok) return null;
    const { latitude, longitude } = await res.json();
    if (latitude == null || longitude == null) return null;
    await supabase.from("stops").update({ latitude, longitude }).eq("id", stopId);
    return { latitude, longitude };
  } catch {
    return null;
  }
}
