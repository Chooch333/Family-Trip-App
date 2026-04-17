"use client";
import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { loadGoogleMapsScript } from "@/lib/googleMaps";
import type { Day, Stop } from "@/lib/database.types";

export interface AccommodationPin {
  name: string;
  latitude: number;
  longitude: number;
  selected: boolean;
}

export interface TripMapProps {
  stops: Stop[];
  days: Day[];
  activeDay: number;
  dayColors: string[];
  pulsingStop: string | null;
  selectedStop: string | null;
  onPinClick: (stop: Stop) => void;
  accommodation?: AccommodationPin | null;
  onAccommodationClick?: () => void;
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

const MAP_ID = "b37fd2d82b1f372e262e3a18";

// Build a circle SVG data URI for stop pins
function makeCircleSvg(
  radius: number,
  fillColor: string,
  strokeColor: string,
  strokeWidth: number,
  fillOpacity: number,
): string {
  const size = (radius + strokeWidth) * 2;
  const cx = size / 2;
  const cy = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fillColor}" fill-opacity="${fillOpacity}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>` +
    `</svg>`;
}

// Build accommodation teardrop SVG
function makeAccommSvg(selected: boolean): string {
  const scale = selected ? 1.15 : 1;
  const w = Math.round(18 * scale);
  const h = Math.round(28 * scale);
  const ring = selected ? `<circle cx="9" cy="10" r="13" fill="none" stroke="rgba(133,79,11,0.3)" stroke-width="3"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 18 28">${ring}<path d="M9 0C4 0 0 4 0 9c0 6.5 9 19 9 19s9-12.5 9-19c0-5-4-9-9-9z" fill="#854F0B" opacity="${selected ? 1 : 0.7}"/><circle cx="9" cy="9" r="4" fill="white" opacity="0.9"/></svg>`;
}

// Single Google Map panel
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
  accommodation,
  onAccommodationClick,
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
  accommodation?: AccommodationPin | null;
  onAccommodationClick?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const polylineRef = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const accommMarkerRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);

  const stopsWithCoords = useMemo(
    () => visibleStops.filter(s => s.latitude && s.longitude && s.stop_type !== "transit"),
    [visibleStops]
  );
  const fitCoordStops = useMemo(
    () => fitStops.filter(s => s.latitude && s.longitude && s.stop_type !== "transit"),
    [fitStops]
  );

  // Route line: active day stops in sort order
  const routePositions = useMemo(() => {
    return stopsWithCoords
      .filter(s => s.day_id === activeDayId)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(s => ({ lat: s.latitude!, lng: s.longitude! }));
  }, [stopsWithCoords, activeDayId]);

  // Initialize map
  useEffect(() => {
    let cancelled = false;
    loadGoogleMapsScript().then(() => {
      if (cancelled || !containerRef.current) return;
      const google = (window as any).google;
      if (!google?.maps) return;
      if (!mapRef.current) {
        mapRef.current = new google.maps.Map(containerRef.current, {
          mapId: MAP_ID,
          center: { lat: 0, lng: 0 },
          zoom: 2,
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
      }
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Shared InfoWindow
  useEffect(() => {
    if (!loaded) return;
    const google = (window as any).google;
    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow({ disableAutoPan: true });
    }
  }, [loaded]);

  // Update markers
  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const google = (window as any).google;
    const map = mapRef.current;
    const iw = infoWindowRef.current;

    // Clear old markers
    markersRef.current.forEach(m => { m.map = null; });
    markersRef.current = [];

    // Filter visible stops
    const displayStops = stopsWithCoords.filter(
      stop => showAllDays || stop.day_id === activeDayId
    );

    // Sort: inactive first, active on top
    const sorted = [...displayStops].sort((a, b) => {
      const aActive = a.day_id === activeDayId ? 1 : 0;
      const bActive = b.day_id === activeDayId ? 1 : 0;
      return aActive - bActive;
    });

    sorted.forEach((stop) => {
      const dayIdx = dayIdxMap.get(stop.day_id) ?? 0;
      const isActiveDay = stop.day_id === activeDayId;
      const isPulsing = pulsingStop === stop.id;
      const isSelected = selectedStop === stop.id;
      const color = dayColors[dayIdx] || "#1D9E75";

      const isOtherDay = showAllDays && !isActiveDay;
      const radius = isOtherDay ? 8 : (isActiveDay ? 14 : 10);
      const displayRadius = isPulsing ? 22 : (isSelected ? 18 : radius);
      const fillOpacity = isOtherDay ? 0.7 : (isActiveDay ? 0.9 : 0.6);
      const strokeWeight = isOtherDay ? 1 : (isActiveDay ? 2.5 : 1.5);

      const fillColor = isSelected ? "#fff" : color;
      const strokeColor = isSelected ? color : "#fff";
      const sw = isSelected ? 4 : strokeWeight;
      const fo = isPulsing ? 0.7 : (isSelected ? 0.95 : fillOpacity);

      const svg = makeCircleSvg(displayRadius, fillColor, strokeColor, sw, fo);
      const el = document.createElement("div");
      el.innerHTML = svg;
      el.style.cursor = "pointer";
      if (isPulsing) {
        el.style.animation = "gmap-pin-pulse 0.8s ease-in-out";
      }

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: stop.latitude!, lng: stop.longitude! },
        content: el,
        zIndex: isActiveDay ? 10 : 1,
      });

      marker.addListener("click", () => onPinClick(stop));

      // Tooltip on hover
      el.addEventListener("mouseenter", () => {
        const dayLabel = days[dayIdx];
        iw.setContent(
          `<div style="font-size:11px;font-weight:500;padding:2px 0">${stop.name}</div>` +
          `<div style="font-size:9px;color:#6b7280">Day ${dayLabel?.day_number ?? ""}${dayLabel?.title ? ` \u00b7 ${dayLabel.title}` : ""}</div>`
        );
        iw.open({ map, anchor: marker });
      });
      el.addEventListener("mouseleave", () => {
        iw.close();
      });

      markersRef.current.push(marker);
    });
  }, [loaded, stopsWithCoords, activeDayId, showAllDays, pulsingStop, selectedStop, dayColors, dayIdxMap, days, onPinClick]);

  // Update polyline
  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const google = (window as any).google;

    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    if (routePositions.length >= 2) {
      polylineRef.current = new google.maps.Polyline({
        path: routePositions,
        strokeColor: routeColor,
        strokeWeight: 2.5,
        strokeOpacity: 0,
        icons: [{
          icon: {
            path: "M 0,-1 0,1",
            strokeOpacity: 0.4,
            strokeColor: routeColor,
            scale: 2.5,
          },
          offset: "0",
          repeat: "14px",
        }],
        map: mapRef.current,
      });
    }
  }, [loaded, routePositions, routeColor]);

  // Accommodation marker
  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const google = (window as any).google;

    if (accommMarkerRef.current) {
      accommMarkerRef.current.map = null;
      accommMarkerRef.current = null;
    }

    if (accommodation) {
      const svg = makeAccommSvg(accommodation.selected);
      const el = document.createElement("div");
      el.innerHTML = svg;
      el.style.cursor = "pointer";

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: mapRef.current,
        position: { lat: accommodation.latitude, lng: accommodation.longitude },
        content: el,
        zIndex: 20,
      });

      marker.addListener("click", () => onAccommodationClick?.());

      const iw = infoWindowRef.current;
      if (iw) {
        el.addEventListener("mouseenter", () => {
          iw.setContent(`<div style="font-size:11px;font-weight:500;padding:2px 0">${accommodation.name}</div>`);
          iw.open({ map: mapRef.current, anchor: marker });
        });
        el.addEventListener("mouseleave", () => {
          iw.close();
        });
      }

      accommMarkerRef.current = marker;
    }
  }, [loaded, accommodation, onAccommodationClick]);

  // Fit bounds
  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const google = (window as any).google;

    const bounds = new google.maps.LatLngBounds();
    let count = 0;
    let singlePos: any = null;

    fitCoordStops.forEach(s => {
      const pos = { lat: s.latitude!, lng: s.longitude! };
      bounds.extend(pos);
      singlePos = pos;
      count++;
    });

    if (accommodation) {
      bounds.extend({ lat: accommodation.latitude, lng: accommodation.longitude });
      count++;
    }

    if (count === 0) return;

    if (count === 1 && singlePos) {
      mapRef.current.setCenter(singlePos);
      mapRef.current.setZoom(14);
    } else {
      mapRef.current.fitBounds(bounds, fitPadding || 50);
    }
  }, [loaded, fitCoordStops, accommodation, fitPadding]);

  if (fitCoordStops.length === 0) return null;

  return (
    <div className={className} style={{ ...style, display: "flex", flexDirection: "column" }}>
      {label && (
        <div className="absolute top-3 left-3 z-[1000] px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur-sm border border-gray-200 shadow-sm">
          <span className="text-[12px] font-semibold text-gray-800">{label}</span>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}

export default function TripMap({ stops, days, activeDay, dayColors, pulsingStop, selectedStop, onPinClick, accommodation, onAccommodationClick }: TripMapProps) {
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
        @keyframes gmap-pin-pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.6); opacity: 0.5; }
          100% { transform: scale(1); opacity: 1; }
        }
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
                accommodation={accommodation}
                onAccommodationClick={onAccommodationClick}
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
          accommodation={accommodation}
          onAccommodationClick={onAccommodationClick}
        />
      )}
    </div>
  );
}
