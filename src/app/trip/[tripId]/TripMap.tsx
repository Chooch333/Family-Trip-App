"use client";
import { useEffect, useRef, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import type { Day, Stop } from "@/lib/database.types";
import "leaflet/dist/leaflet.css";

interface TripMapProps {
  stops: Stop[];
  days: Day[];
  activeDay: number;
  dayColors: string[];
  pulsingStop: string | null;
  onPinClick: (stop: Stop) => void;
}

// Auto-fit bounds when stops change
function FitBounds({ stops }: { stops: Stop[] }) {
  const map = useMap();
  const coordStops = useMemo(() => stops.filter(s => s.latitude && s.longitude), [stops]);
  useEffect(() => {
    if (coordStops.length === 0) return;
    const bounds = coordStops.map(s => [s.latitude!, s.longitude!] as [number, number]);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [coordStops, map]);
  return null;
}

export default function TripMap({ stops, days, activeDay, dayColors, pulsingStop, onPinClick }: TripMapProps) {
  const stopsWithCoords = useMemo(() => stops.filter(s => s.latitude && s.longitude), [stops]);
  const activeDayId = days[activeDay]?.id;

  // Build a map from day_id to day index for coloring
  const dayIdxMap = useMemo(() => {
    const m = new Map<string, number>();
    days.forEach((d, i) => m.set(d.id, i));
    return m;
  }, [days]);

  if (stopsWithCoords.length === 0) return null;

  const center: [number, number] = [stopsWithCoords[0].latitude!, stopsWithCoords[0].longitude!];

  return (
    <div className="w-full h-full relative">
      {/* Pulse animation CSS */}
      <style>{`
        @keyframes map-pin-pulse {
          0% { r: 14; opacity: 1; }
          50% { r: 24; opacity: 0.5; }
          100% { r: 14; opacity: 1; }
        }
        .pin-pulse circle { animation: map-pin-pulse 0.8s ease-in-out; }
      `}</style>
      <MapContainer center={center} zoom={12} className="w-full h-full" style={{ zIndex: 0 }} zoomControl={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds stops={stopsWithCoords} />
        {/* Render inactive day pins first (behind), then active day pins on top */}
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
            const color = dayColors[dayIdx] || "#1D9E75";
            const radius = isActiveDay ? 14 : 10;
            const fillOpacity = isActiveDay ? 0.9 : 0.6;
            const strokeWeight = isActiveDay ? 2.5 : 1.5;

            return (
              <CircleMarker
                key={stop.id}
                center={[stop.latitude!, stop.longitude!]}
                radius={isPulsing ? 22 : radius}
                pathOptions={{
                  fillColor: color,
                  color: "#fff",
                  weight: strokeWeight,
                  fillOpacity: isPulsing ? 0.7 : fillOpacity,
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
  );
}
