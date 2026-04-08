"use client";
import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, Polyline, useMap } from "react-leaflet";
import type { Day, Stop } from "@/lib/database.types";
import "leaflet/dist/leaflet.css";

export interface TripMapProps {
  stops: Stop[];
  days: Day[];
  activeDay: number;
  dayColors: string[];
  pulsingStop: string | null;
  selectedStop: string | null;
  fitMode: "day" | "all";
  onPinClick: (stop: Stop) => void;
}

// Haversine distance in km
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Cluster stops into groups where consecutive stops > threshold km apart create a split
interface StopCluster { stops: Stop[]; label: string; }

function clusterStops(allDayStops: Stop[], nonTransitStops: Stop[], thresholdKm: number): StopCluster[] {
  if (nonTransitStops.length === 0) return [];
  const clusters: StopCluster[] = [{ stops: [nonTransitStops[0]], label: "" }];
  for (let i = 1; i < nonTransitStops.length; i++) {
    const prev = nonTransitStops[i - 1];
    const curr = nonTransitStops[i];
    if (prev.latitude && prev.longitude && curr.latitude && curr.longitude) {
      const dist = haversineKm(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      if (dist > thresholdKm) {
        clusters.push({ stops: [curr], label: "" });
        continue;
      }
    }
    clusters[clusters.length - 1].stops.push(curr);
  }

  // Derive labels: look for transit stops between clusters to get city names
  if (clusters.length >= 2) {
    // First cluster: use the name/area from the first stop or find preceding context
    // Try to extract city from stop names or find a transit stop that names the destination
    for (let ci = 0; ci < clusters.length; ci++) {
      // Look for transit stop right before this cluster's first stop in the full day stops list
      const firstStop = clusters[ci].stops[0];
      const idxInAll = allDayStops.findIndex(s => s.id === firstStop.id);
      if (ci === 0) {
        // First cluster: check day title or use common location from stop names
        // Try to find a transit stop after this cluster that mentions origin
        const lastStop = clusters[ci].stops[clusters[ci].stops.length - 1];
        const lastIdx = allDayStops.findIndex(s => s.id === lastStop.id);
        // Look for transit stop after this cluster
        for (let ti = lastIdx + 1; ti < allDayStops.length; ti++) {
          if (allDayStops[ti].stop_type === "transit") {
            // Extract origin from transit name like "Train to Florence" → origin is where we are
            const name = allDayStops[ti].name;
            const fromMatch = name.match(/from\s+(.+)/i);
            if (fromMatch) { clusters[ci].label = fromMatch[1].trim(); break; }
            break;
          }
          break;
        }
      }
      if (ci > 0 && idxInAll > 0) {
        // Look backwards for a transit stop that names the destination
        for (let ti = idxInAll - 1; ti >= 0; ti--) {
          if (allDayStops[ti].stop_type === "transit") {
            const name = allDayStops[ti].name;
            // Extract destination from "Train to Florence", "Drive to Lucca", etc.
            const toMatch = name.match(/(?:to|towards|into)\s+(.+)/i);
            if (toMatch) { clusters[ci].label = toMatch[1].trim(); }
            break;
          }
        }
      }
    }
  }

  return clusters;
}

// Auto-fit bounds
function FitBounds({ stops, padding }: { stops: Stop[]; padding?: number }) {
  const map = useMap();
  const coords = useMemo(() => stops.filter(s => s.latitude && s.longitude), [stops]);

  useEffect(() => {
    if (coords.length === 0) return;
    const bounds = coords.map(s => [s.latitude!, s.longitude!] as [number, number]);
    if (bounds.length === 1) {
      map.setView(bounds[0], 14, { animate: true });
    } else {
      map.fitBounds(bounds, { padding: [padding || 50, padding || 50], maxZoom: 15, animate: true });
    }
  }, [coords, map, padding]);

  return null;
}

// Single map panel with pins + route line
function MapPanel({
  allStops,
  clusterStops: panelStops,
  days,
  activeDay,
  dayColors,
  pulsingStop,
  selectedStop,
  onPinClick,
  dayIdxMap,
  activeDayId,
  routeColor,
  label,
  fitPadding,
  className,
  style,
}: {
  allStops: Stop[];
  clusterStops: Stop[];
  days: Day[];
  activeDay: number;
  dayColors: string[];
  pulsingStop: string | null;
  selectedStop: string | null;
  onPinClick: (stop: Stop) => void;
  dayIdxMap: Map<string, number>;
  activeDayId: string | undefined;
  routeColor: string;
  label?: string;
  fitPadding?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const stopsWithCoords = useMemo(() => allStops.filter(s => s.latitude && s.longitude && s.stop_type !== "transit"), [allStops]);
  const panelCoordStops = useMemo(() => panelStops.filter(s => s.latitude && s.longitude && s.stop_type !== "transit"), [panelStops]);

  // Route line: active day stops in this panel, in sort order
  const routePositions = useMemo(() => {
    return panelCoordStops
      .filter(s => s.day_id === activeDayId)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(s => [s.latitude!, s.longitude!] as [number, number]);
  }, [panelCoordStops, activeDayId]);

  if (panelCoordStops.length === 0) return null;

  const center: [number, number] = [panelCoordStops[0].latitude!, panelCoordStops[0].longitude!];

  return (
    <div className={className} style={{ ...style, display: "flex", flexDirection: "column" }}>
      {label && (
        <div className="flex-shrink-0 px-3 py-1.5 bg-white border-b border-gray-100">
          <span className="text-[13px] font-semibold text-gray-800">{label}</span>
        </div>
      )}
      <div className="flex-1 min-h-0">
      <MapContainer center={center} zoom={12} className="w-full h-full" style={{ zIndex: 0 }} zoomControl={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds stops={panelCoordStops} padding={fitPadding} />
        {/* Route polyline for active day */}
        {routePositions.length >= 2 && (
          <Polyline
            positions={routePositions}
            pathOptions={{
              color: routeColor,
              weight: 2.5,
              opacity: 0.4,
              dashArray: "8, 6",
            }}
          />
        )}
        {/* Pins — render inactive first, active on top */}
        {stopsWithCoords
          .sort((a, b) => {
            const aActive = a.day_id === activeDayId ? 1 : 0;
            const bActive = b.day_id === activeDayId ? 1 : 0;
            return aActive - bActive;
          })
          .map(stop => {
            const dayIdx = dayIdxMap.get(stop.day_id) ?? 0;
            const isActiveDay = stop.day_id === activeDayId;
            const isPulsing = pulsingStop === stop.id;
            const isSelected = selectedStop === stop.id;
            const color = dayColors[dayIdx] || "#1D9E75";
            const radius = isActiveDay ? 14 : 10;
            const displayRadius = isPulsing ? 22 : (isSelected ? 18 : radius);
            const fillOpacity = isActiveDay ? 0.9 : 0.6;
            const strokeWeight = isActiveDay ? 2.5 : 1.5;

            return (
              <CircleMarker
                key={stop.id}
                center={[stop.latitude!, stop.longitude!]}
                radius={displayRadius}
                pathOptions={{
                  fillColor: isSelected ? "#fff" : color,
                  color: isSelected ? color : "#fff",
                  weight: isSelected ? 4 : strokeWeight,
                  fillOpacity: isPulsing ? 0.7 : (isSelected ? 0.95 : fillOpacity),
                  className: isPulsing ? "pin-pulse" : "",
                }}
                eventHandlers={{ click: () => onPinClick(stop) }}
              >
                <Tooltip direction="top" offset={[0, -radius]} opacity={0.95}>
                  <div className="text-[11px] font-medium">{stop.name}</div>
                  <div className="text-[9px] text-gray-500">Day {days[dayIdx]?.day_number}{days[dayIdx]?.title ? ` \u00b7 ${days[dayIdx].title}` : ""}</div>
                </Tooltip>
              </CircleMarker>
            );
          })}
      </MapContainer>
      </div>
    </div>
  );
}

export default function TripMap({ stops, days, activeDay, dayColors, pulsingStop, selectedStop, fitMode, onPinClick }: TripMapProps) {
  const nonTransitStops = useMemo(() => stops.filter(s => s.latitude && s.longitude && s.stop_type !== "transit"), [stops]);
  const activeDayId = days[activeDay]?.id;
  const activeDayColor = dayColors[activeDay] || "#1D9E75";

  const dayIdxMap = useMemo(() => {
    const m = new Map<string, number>();
    days.forEach((d, i) => m.set(d.id, i));
    return m;
  }, [days]);

  // Get active day's non-transit stops in order
  const activeDayStops = useMemo(
    () => nonTransitStops
      .filter(s => s.day_id === activeDayId)
      .sort((a, b) => a.sort_order - b.sort_order),
    [nonTransitStops, activeDayId]
  );

  // Always show a single map — fits all day stops (walkable or driving)
  const fitStops = fitMode === "all" ? nonTransitStops : activeDayStops;

  if (nonTransitStops.length === 0) return null;

  return (
    <div className="w-full h-full relative flex flex-col">
      <style>{`
        @keyframes map-pin-pulse {
          0% { r: 14; opacity: 1; }
          50% { r: 24; opacity: 0.5; }
          100% { r: 14; opacity: 1; }
        }
        .pin-pulse circle { animation: map-pin-pulse 0.8s ease-in-out; }
      `}</style>
      <MapPanel
        allStops={stops}
        clusterStops={fitStops}
        days={days}
        activeDay={activeDay}
        dayColors={dayColors}
        pulsingStop={pulsingStop}
        selectedStop={selectedStop}
        onPinClick={onPinClick}
        dayIdxMap={dayIdxMap}
        activeDayId={activeDayId}
        routeColor={activeDayColor}
        className="flex-1 min-h-0"
      />
    </div>
  );
}
