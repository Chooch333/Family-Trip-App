"use client";
import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, useMap } from "react-leaflet";
import type { Stop } from "@/lib/database.types";
import "leaflet/dist/leaflet.css";

function FitAndLock({ stops }: { stops: Stop[] }) {
  const map = useMap();
  useEffect(() => {
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.doubleClickZoom.disable();
    map.touchZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();

    const points = stops.filter(s => s.latitude && s.longitude).map(s => [s.latitude!, s.longitude!] as [number, number]);
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14, { animate: false });
    } else {
      map.fitBounds(points, { padding: [20, 20], maxZoom: 15, animate: false });
    }
  }, [stops, map]);
  return null;
}

export default function VibeMap({ stops, dayColor }: { stops: Stop[]; dayColor: string }) {
  const stopsWithCoords = stops.filter(s => s.latitude && s.longitude);
  if (stopsWithCoords.length === 0) {
    return <div className="w-full h-full bg-gray-100 flex items-center justify-center"><span className="text-[11px] text-gray-400">No locations</span></div>;
  }

  return (
    <MapContainer center={[stopsWithCoords[0].latitude!, stopsWithCoords[0].longitude!]} zoom={13} className="w-full h-full" style={{ zIndex: 0 }} zoomControl={false} attributionControl={false}>
      <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
      <FitAndLock stops={stopsWithCoords} />
      {stopsWithCoords.map(stop => (
        <CircleMarker key={stop.id} center={[stop.latitude!, stop.longitude!]} radius={6}
          pathOptions={{ fillColor: dayColor, color: "#fff", weight: 2, fillOpacity: 0.9 }} />
      ))}
    </MapContainer>
  );
}
