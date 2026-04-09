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
  onPinClick,
}: {
  stops: Stop[];
  dayColor: string;
  highlightedStopId?: string | null;
  onPinClick?: (stopId: string) => void;
}) {
  const stopsWithCoords = stops.filter(isValidCoord);
  if (stopsWithCoords.length === 0) {
    return <div className="w-full h-full bg-gray-100 flex items-center justify-center"><span className="text-[11px] text-gray-400">No locations</span></div>;
  }

  return (
    <MapContainer center={[stopsWithCoords[0].latitude!, stopsWithCoords[0].longitude!]} zoom={13} className="w-full h-full" style={{ zIndex: 0 }} zoomControl={false} attributionControl={false}>
      <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
      <FitAndLock stops={stopsWithCoords} />
      {stopsWithCoords.map(stop => {
        const isHighlighted = stop.id === highlightedStopId;
        return (
          <CircleMarker key={stop.id} center={[stop.latitude!, stop.longitude!]}
            radius={isHighlighted ? 9 : 6}
            pathOptions={{
              fillColor: isHighlighted ? "#f59e0b" : dayColor,
              color: isHighlighted ? "#f59e0b" : "#fff",
              weight: isHighlighted ? 3 : 2,
              fillOpacity: isHighlighted ? 1 : 0.9,
            }}
            eventHandlers={{ click: () => onPinClick?.(stop.id) }}
          >
            <Tooltip direction="top" offset={[0, -6]} opacity={0.9}>
              <span className="text-[10px] font-medium">{stop.name}</span>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
