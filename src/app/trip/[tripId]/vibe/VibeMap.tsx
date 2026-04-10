"use client";
import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import type { Stop } from "@/lib/database.types";
import "leaflet/dist/leaflet.css";

function isValidCoord(stop: Stop): boolean {
  if (stop.latitude == null || stop.longitude == null) return false;
  if (stop.latitude === 0 && stop.longitude === 0) return false;
  return true;
}

function FitAndLock({ stops }: { stops: Stop[] }) {
  const map = useMap();
  useEffect(() => {
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.doubleClickZoom.disable();
    map.touchZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();

    const points = stops.filter(isValidCoord).map(s => [s.latitude!, s.longitude!] as [number, number]);
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 13, { animate: false });
    } else {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 14, animate: false });
    }
  }, [stops, map]);
  return null;
}

export default function VibeMap({
  stops,
  dayColor,
  highlightedStopId,
  pulsingStopId,
  onPinClick,
}: {
  stops: Stop[];
  dayColor: string;
  highlightedStopId?: string | null;
  pulsingStopId?: string | null;
  onPinClick?: (stopId: string) => void;
}) {
  const stopsWithCoords = stops.filter(isValidCoord);
  if (stopsWithCoords.length === 0) {
    return <div className="w-full h-full bg-gray-100 flex items-center justify-center"><span className="text-[11px] text-gray-400">No locations</span></div>;
  }

  // Render highlighted pin last so it sits on top
  const sortedStops = [...stopsWithCoords].sort((a, b) => {
    const aSel = a.id === highlightedStopId ? 1 : 0;
    const bSel = b.id === highlightedStopId ? 1 : 0;
    return aSel - bSel;
  });

  return (
    <div className="w-full h-full relative">
      <style>{`
        @keyframes vibe-map-pin-pulse {
          0% { r: 14; opacity: 1; }
          50% { r: 24; opacity: 0.5; }
          100% { r: 14; opacity: 1; }
        }
        .vibe-pin-pulse circle { animation: vibe-map-pin-pulse 0.8s ease-in-out; }
      `}</style>
      <MapContainer center={[stopsWithCoords[0].latitude!, stopsWithCoords[0].longitude!]} zoom={13} className="w-full h-full" style={{ zIndex: 0 }} zoomControl={false} attributionControl={false}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
        <FitAndLock stops={stopsWithCoords} />
        {sortedStops.map(stop => {
          const isSelected = stop.id === highlightedStopId;
          const isPulsing = stop.id === pulsingStopId;
          const baseRadius = 10;
          const selectedRadius = 18;
          const displayRadius = isPulsing ? 22 : (isSelected ? selectedRadius : baseRadius);
          return (
            <CircleMarker
              key={stop.id}
              center={[stop.latitude!, stop.longitude!]}
              radius={displayRadius}
              pathOptions={{
                fillColor: isSelected ? "#fff" : dayColor,
                color: isSelected ? dayColor : "#fff",
                weight: isSelected ? 4 : 2,
                fillOpacity: isPulsing ? 0.7 : (isSelected ? 0.95 : 0.85),
                className: isPulsing ? "vibe-pin-pulse" : "",
              }}
              eventHandlers={{ click: () => onPinClick?.(stop.id) }}
            >
              <Tooltip direction="top" offset={[0, -displayRadius]} opacity={0.95}>
                <span className="text-[11px] font-medium">{stop.name}</span>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
