"use client";
import React, { useEffect, useMemo, useState } from "react";
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
  onPinClick: (stop: Stop) => void;
}

// --- Detect if a transit stop is non-car (train, bus, flight, ferry, etc.) ---
function isNonCarTransit(stop: Stop): boolean {
  if (stop.stop_type !== "transit") return false;
  const text = `${stop.name} ${stop.description || ""}`.toLowerCase();
  // Match non-car transit types
  if (text.match(/\b(train|rail|tgv|eurostar|amtrak|high.?speed)\b/)) return true;
  if (text.match(/\b(bus|coach|shuttle)\b/)) return true;
  if (text.match(/\b(flight|fly|plane|airport|airline)\b/)) return true;
  if (text.match(/\b(ferry|boat|ship|catamaran|cruise)\b/)) return true;
  if (text.match(/\b(metro|subway|tram|trolley|cable.?car)\b/)) return true;
  // If it's transit but doesn't match car/drive keywords, treat as non-car
  if (text.match(/\b(car|drive|driving|road.?trip|rental)\b/)) return false;
  // Default for generic transit: check if it has "to <City>" pattern (implies inter-city)
  // Be conservative — only split on clearly non-car transit
  return false;
}

// --- Extract destination city name from transit stop ---
function extractTransitDestination(stop: Stop): string {
  const name = stop.name;
  const toMatch = name.match(/(?:to|towards|into|arriving?\s+in)\s+(.+)/i);
  if (toMatch) return toMatch[1].trim();
  return "";
}

// --- Extract origin city name from transit stop ---
function extractTransitOrigin(stop: Stop): string {
  const name = stop.name;
  const fromMatch = name.match(/from\s+(.+?)(?:\s+to\s+)/i);
  if (fromMatch) return fromMatch[1].trim();
  return "";
}

// --- Cluster day stops by non-car transit splits ---
interface StopCluster { stops: Stop[]; label: string; }

function clusterByTransit(dayStops: Stop[]): StopCluster[] {
  const sorted = [...dayStops].sort((a, b) => a.sort_order - b.sort_order);
  const activityStops = sorted.filter(s => s.stop_type !== "transit" && s.latitude && s.longitude);

  if (activityStops.length === 0) return [];

  // Find non-car transit split points
  const splitTransits: Stop[] = [];
  for (const s of sorted) {
    if (isNonCarTransit(s)) splitTransits.push(s);
  }

  // If no non-car transit, return single cluster with no label
  if (splitTransits.length === 0) {
    return [{ stops: activityStops, label: "" }];
  }

  // Walk through sorted stops, splitting at non-car transit boundaries
  const clusters: StopCluster[] = [];
  let currentGroup: Stop[] = [];
  let lastTransit: Stop | null = null;

  for (const stop of sorted) {
    if (isNonCarTransit(stop)) {
      // Finalize current group if it has activity stops
      if (currentGroup.length > 0) {
        clusters.push({ stops: currentGroup, label: "" });
        currentGroup = [];
      }
      lastTransit = stop;
    } else if (stop.stop_type !== "transit" && stop.latitude && stop.longitude) {
      currentGroup.push(stop);
    }
  }
  // Finalize last group
  if (currentGroup.length > 0) {
    clusters.push({ stops: currentGroup, label: "" });
  }

  // Derive labels for split clusters
  if (clusters.length >= 2) {
    // Label first cluster: try to get origin from first non-car transit
    if (splitTransits.length > 0) {
      const origin = extractTransitOrigin(splitTransits[0]);
      if (origin) {
        clusters[0].label = origin;
      }
    }

    // Label subsequent clusters: get destination from the transit that precedes them
    let transitIdx = 0;
    for (let ci = 1; ci < clusters.length; ci++) {
      // Find the transit stop that sits between clusters[ci-1] and clusters[ci]
      const prevLastStop = clusters[ci - 1].stops[clusters[ci - 1].stops.length - 1];
      const currFirstStop = clusters[ci].stops[0];
      for (let ti = transitIdx; ti < splitTransits.length; ti++) {
        if (splitTransits[ti].sort_order > prevLastStop.sort_order &&
            splitTransits[ti].sort_order < currFirstStop.sort_order) {
          const dest = extractTransitDestination(splitTransits[ti]);
          if (dest) clusters[ci].label = dest;
          transitIdx = ti + 1;
          break;
        }
      }
    }

    // If first cluster still has no label, try to derive from day title or first stop
    if (!clusters[0].label && splitTransits.length > 0) {
      const dest = extractTransitDestination(splitTransits[0]);
      // The first cluster is the origin — if transit says "Train to X", origin is NOT X
      // Try to use the first stop's name area as fallback
      if (!clusters[0].label) {
        const firstStop = clusters[0].stops[0];
        clusters[0].label = firstStop.name.split(/[,\-–]/).map(s => s.trim())[0] || "";
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
  visibleStops,
  fitStops,
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
  showAllDays,
}: {
  visibleStops: Stop[];
  fitStops: Stop[];
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
  showAllDays?: boolean;
}) {
  const stopsWithCoords = useMemo(() => visibleStops.filter(s => s.latitude && s.longitude && s.stop_type !== "transit"), [visibleStops]);
  const fitCoordStops = useMemo(() => fitStops.filter(s => s.latitude && s.longitude && s.stop_type !== "transit"), [fitStops]);

  // Route line: active day stops in this panel, in sort order
  const routePositions = useMemo(() => {
    return stopsWithCoords
      .filter(s => s.day_id === activeDayId)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(s => [s.latitude!, s.longitude!] as [number, number]);
  }, [stopsWithCoords, activeDayId]);

  if (fitCoordStops.length === 0) return null;

  const center: [number, number] = [fitCoordStops[0].latitude!, fitCoordStops[0].longitude!];

  return (
    <div className={className} style={{ ...style, display: "flex", flexDirection: "column" }}>
      {label && (
        <div className="absolute top-3 left-3 z-[1000] px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur-sm border border-gray-200 shadow-sm">
          <span className="text-[12px] font-semibold text-gray-800">{label}</span>
        </div>
      )}
      <div className="flex-1 min-h-0">
      <MapContainer center={center} zoom={12} className="w-full h-full" style={{ zIndex: 0 }} zoomControl={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds stops={fitCoordStops} padding={fitPadding} />
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
          .filter(stop => showAllDays || stop.day_id === activeDayId)
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

            // In "All stops" mode, non-active day stops are smaller and faded
            const isOtherDay = showAllDays && !isActiveDay;
            const radius = isOtherDay ? 8 : (isActiveDay ? 14 : 10);
            const displayRadius = isPulsing ? 22 : (isSelected ? 18 : radius);
            const fillOpacity = isOtherDay ? 0.6 : (isActiveDay ? 0.9 : 0.6);
            const strokeWeight = isOtherDay ? 1 : (isActiveDay ? 2.5 : 1.5);

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
                  <div className="text-[9px] text-gray-500">Day {days[dayIdx]?.day_number}{days[dayIdx]?.title ? ` · ${days[dayIdx].title}` : ""}</div>
                </Tooltip>
              </CircleMarker>
            );
          })}
      </MapContainer>
      </div>
    </div>
  );
}

export default function TripMap({ stops, days, activeDay, dayColors, pulsingStop, selectedStop, onPinClick }: TripMapProps) {
  const [viewMode, setViewMode] = useState<"day" | "all">("all");
  const nonTransitStops = useMemo(() => stops.filter(s => s.latitude && s.longitude && s.stop_type !== "transit"), [stops]);
  const activeDayId = days[activeDay]?.id;
  const activeDayColor = dayColors[activeDay] || "#1D9E75";

  const dayIdxMap = useMemo(() => {
    const m = new Map<string, number>();
    days.forEach((d, i) => m.set(d.id, i));
    return m;
  }, [days]);

  // Reset to "all" view when active day changes
  useEffect(() => {
    setViewMode("all");
  }, [activeDay]);

  // Get all stops for the active day (including transit) for clustering
  const activeDayAllStops = useMemo(
    () => stops.filter(s => s.day_id === activeDayId).sort((a, b) => a.sort_order - b.sort_order),
    [stops, activeDayId]
  );

  // Cluster active day stops by non-car transit
  const clusters = useMemo(() => clusterByTransit(activeDayAllStops), [activeDayAllStops]);
  const isSplit = clusters.length >= 2;

  if (nonTransitStops.length === 0) return null;

  const showAllStops = viewMode === "all";

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

      {/* Toggle button */}
      <button
        onClick={() => setViewMode(v => v === "day" ? "all" : "day")}
        className="absolute top-3 right-3 z-[1000] px-4 py-2.5 rounded-xl bg-white/90 backdrop-blur-sm border border-gray-200 text-[16px] font-medium text-gray-700 hover:bg-white hover:border-gray-300 transition-colors shadow-sm"
      >
        {viewMode === "day" ? "All stops" : "Day stops"}
      </button>

      {isSplit ? (
        /* Split maps: one per cluster */
        <div className="flex-1 min-h-0 flex flex-col">
          {clusters.map((cluster, i) => (
            <React.Fragment key={i}>
            {i > 0 && <div className="h-3 bg-gray-100 border-y border-gray-200 shrink-0" />}
            <div className="flex-1 min-h-0 relative">
              <MapPanel
                visibleStops={showAllStops ? stops : cluster.stops}
                fitStops={cluster.stops}
                days={days}
                activeDay={activeDay}
                dayColors={dayColors}
                pulsingStop={pulsingStop}
                selectedStop={selectedStop}
                onPinClick={onPinClick}
                dayIdxMap={dayIdxMap}
                activeDayId={activeDayId}
                routeColor={activeDayColor}
                label={cluster.label || undefined}
                className="w-full h-full"
                style={{ position: "absolute", inset: 0 }}
                showAllDays={showAllStops}
              />
            </div>
            </React.Fragment>
          ))}
        </div>
      ) : (
        /* Single map: zoom fits active day's stops, toggle only changes pin visibility */
        <MapPanel
          visibleStops={stops}
          fitStops={clusters.length > 0 ? clusters[0].stops : nonTransitStops.filter(s => s.day_id === activeDayId)}
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
          showAllDays={showAllStops}
        />
      )}
    </div>
  );
}
