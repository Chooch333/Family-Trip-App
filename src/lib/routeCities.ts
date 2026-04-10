import type { Day, Stop } from "@/lib/database.types";

export interface RouteCity {
  name: string;
  lat: number;
  lng: number;
  dayIndices: number[];
}

export interface RouteCityResult {
  cities: RouteCity[];
  dayToCityIndex: Map<number, number>;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function deriveCityName(
  clusterStops: Stop[],
  allStops: Stop[],
  days: Day[],
  dayIdxMap: Map<string, number>,
): string {
  // Try to find a transit stop right before this cluster that says "to CityName"
  const firstStop = clusterStops[0];
  const dayStops = allStops
    .filter(s => s.day_id === firstStop.day_id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const idx = dayStops.findIndex(s => s.id === firstStop.id);
  if (idx > 0) {
    for (let i = idx - 1; i >= 0; i--) {
      if (dayStops[i].stop_type === "transit") {
        const toMatch = dayStops[i].name.match(/(?:to|towards|into|arriving?\s+in)\s+(.+)/i);
        if (toMatch) return toMatch[1].trim();
        break;
      }
    }
  }

  // Try day title
  const dayIdx = dayIdxMap.get(firstStop.day_id) ?? 0;
  const dayTitle = days[dayIdx]?.title;
  if (dayTitle) {
    const parts = dayTitle.split(/[→\-–\/,&]/).map(s => s.trim()).filter(Boolean);
    if (parts.length === 1) return parts[0];
    return parts[0];
  }

  // Fallback: use first stop name, shortened
  const stopName = clusterStops[0].name;
  return stopName.split(/[,\-–]/).map(s => s.trim())[0] || stopName;
}

export function extractRouteCities(stops: Stop[], days: Day[]): RouteCityResult {
  const dayIdxMap = new Map<string, number>();
  days.forEach((d, i) => dayIdxMap.set(d.id, i));

  // Get all non-transit stops with coords, sorted by day then sort_order
  const ordered = stops
    .filter(s => s.latitude && s.longitude && s.stop_type !== "transit")
    .sort((a, b) => {
      const dayA = dayIdxMap.get(a.day_id) ?? 0;
      const dayB = dayIdxMap.get(b.day_id) ?? 0;
      if (dayA !== dayB) return dayA - dayB;
      return a.sort_order - b.sort_order;
    });

  if (ordered.length === 0) return { cities: [], dayToCityIndex: new Map() };

  // Cluster stops within ~15km into "cities", track which day indices belong to each
  interface RawCity { name: string; lat: number; lng: number; dayIndices: Set<number>; }
  const rawCities: RawCity[] = [];
  let clusterStops = [ordered[0]];

  function finalizeCluster(cluster: Stop[]) {
    const lat = cluster.reduce((s, st) => s + st.latitude!, 0) / cluster.length;
    const lng = cluster.reduce((s, st) => s + st.longitude!, 0) / cluster.length;
    const name = deriveCityName(cluster, stops, days, dayIdxMap);
    const dayIndices = new Set(cluster.map(s => dayIdxMap.get(s.day_id) ?? 0));
    rawCities.push({ name, lat, lng, dayIndices });
  }

  for (let i = 1; i < ordered.length; i++) {
    const prev = clusterStops[clusterStops.length - 1];
    const curr = ordered[i];
    const dist = haversineKm(prev.latitude!, prev.longitude!, curr.latitude!, curr.longitude!);
    if (dist < 15) {
      clusterStops.push(curr);
    } else {
      finalizeCluster(clusterStops);
      clusterStops = [curr];
    }
  }
  finalizeCluster(clusterStops);

  // Merge consecutive clusters with the same name
  const merged: RawCity[] = [];
  for (const city of rawCities) {
    if (merged.length > 0 && merged[merged.length - 1].name === city.name) {
      city.dayIndices.forEach(d => merged[merged.length - 1].dayIndices.add(d));
    } else {
      merged.push({ ...city, dayIndices: new Set(city.dayIndices) });
    }
  }

  // Build final cities and day-to-city-index lookup
  const cities: RouteCity[] = [];
  const dayToCityIndex = new Map<number, number>();
  merged.forEach((raw, cityIdx) => {
    const dayArr = Array.from(raw.dayIndices).sort((a, b) => a - b);
    cities.push({ name: raw.name, lat: raw.lat, lng: raw.lng, dayIndices: dayArr });
    dayArr.forEach(d => dayToCityIndex.set(d, cityIdx));
  });

  return { cities, dayToCityIndex };
}

export function isMultiCityTrip(stops: Stop[]): boolean {
  const coords = stops.filter(s => s.latitude && s.longitude && s.stop_type !== "transit");
  if (coords.length < 2) return false;
  let maxDist = 0;
  for (let i = 0; i < coords.length; i++) {
    for (let j = i + 1; j < coords.length; j++) {
      const d = haversineKm(
        coords[i].latitude!,
        coords[i].longitude!,
        coords[j].latitude!,
        coords[j].longitude!,
      );
      if (d > maxDist) maxDist = d;
      if (maxDist > 50) return true;
    }
  }
  return maxDist > 50;
}
