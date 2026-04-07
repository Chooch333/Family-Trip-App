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
function clusterStops(stops: Stop[], thresholdKm: number): Stop[][] {
  if (stops.length === 0) return [];
  const clusters: Stop[][] = [[stops[0]]];
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const curr = stops[i];
    if (prev.latitude && prev.longitude && curr.latitude && curr.longitude) {
      const dist = haversineKm(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      if (dist > thresholdKm) {
        clusters.push([curr]);
        continue;
      }
    }
    clusters[clusters.length - 1].push(curr);
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
    <div className={className} style={style}>
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
            const displayRadius = isPulsing ? 22 : (isSelected ? 16 : radius);
            const fillOpacity = isActiveDay ? 0.9 : 0.6;
            const strokeWeight = isActiveDay ? 2.5 : 1.5;

            return (
              <CircleMarker
                key={stop.id}
                center={[stop.latitude!, stop.longitude!]}
                radius={displayRadius}
                pathOptions={{
                  fillColor: color,
                  color: "#fff",
                  weight: isSelected ? 3 : strokeWeight,
                  fillOpacity: isPulsing ? 0.7 : fillOpacity,
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

  // Get active day's non-transit stops in order for clustering
  const activeDayStops = useMemo(
    () => nonTransitStops
      .filter(s => s.day_id === activeDayId)
      .sort((a, b) => a.sort_order - b.sort_order),
    [nonTransitStops, activeDayId]
  );

  // Detect if we need split maps (clusters >30km apart)
  const clusters = useMemo(
    () => fitMode === "day" ? clusterStops(activeDayStops, 30) : [nonTransitStops],
    [activeDayStops, nonTransitStops, fitMode]
  );

  const isSplit = fitMode === "day" && clusters.length >= 2;

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
      {isSplit ? (
        // Split map — two panels stacked
        clusters.map((cluster, ci) => (
          <MapPanel
            key={ci}
            allStops={stops}
            clusterStops={cluster}
            days={days}
            activeDay={activeDay}
            dayColors={dayColors}
            pulsingStop={pulsingStop}
            selectedStop={selectedStop}
            onPinClick={onPinClick}
            dayIdxMap={dayIdxMap}
            activeDayId={activeDayId}
            routeColor={activeDayColor}
            fitPadding={35}
            className="flex-1 min-h-0"
            style={ci < clusters.length - 1 ? { borderBottom: "2px solid #e5e7eb" } : undefined}
          />
        ))
      ) : (
        // Single map
        <MapPanel
          allStops={stops}
          clusterStops={fitMode === "all" ? nonTransitStops : activeDayStops}
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
      )}
    </div>
  );
}
