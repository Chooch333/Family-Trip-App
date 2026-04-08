"use client";
import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, useMap } from "react-leaflet";
import type { Day, Stop } from "@/lib/database.types";
import "leaflet/dist/leaflet.css";

export interface RegionalMapProps {
  stops: Stop[];
  days: Day[];
  activeDay: number;
  dayColors: string[];
  routeCities: { name: string; lat: number; lng: number; dayIdx: number }[];
}

function FitAllBounds({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = points.map(p => [p.lat, p.lng] as [number, number]);
    if (bounds.length === 1) {
      map.setView(bounds[0], 8, { animate: false });
    } else {
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 10, animate: false });
    }
  }, [points, map]);
  return null;
}

export default function RegionalMap({ stops, days, activeDay, dayColors, routeCities }: RegionalMapProps) {
  const activeDayId = days[activeDay]?.id;
  const activeDayColor = dayColors[activeDay] || "#1D9E75";

  // Build polyline from route cities in order
  const routePositions = useMemo(
    () => routeCities.map(c => [c.lat, c.lng] as [number, number]),
    [routeCities]
  );

  // Find which city the active day belongs to
  const activeDayStops = useMemo(
    () => stops.filter(s => s.day_id === activeDayId && s.latitude && s.longitude && s.stop_type !== "transit"),
    [stops, activeDayId]
  );

  if (routeCities.length === 0) return null;

  const center: [number, number] = [routeCities[0].lat, routeCities[0].lng];

  return (
    <div className="w-full flex-shrink-0" style={{ height: 130 }}>
      <MapContainer center={center} zoom={6} className="w-full h-full" style={{ zIndex: 0 }} zoomControl={false} attributionControl={false}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
        />
        <FitAllBounds points={routeCities} />
        {/* Dashed route polyline */}
        {routePositions.length >= 2 && (
          <Polyline
            positions={routePositions}
            pathOptions={{
              color: "#94a3b8",
              weight: 2,
              opacity: 0.6,
              dashArray: "6, 5",
            }}
          />
        )}
        {/* City dots */}
        {routeCities.map((city, i) => {
          const isActiveCity = activeDayStops.length > 0 && activeDayStops.some(
            s => Math.abs(s.latitude! - city.lat) < 0.15 && Math.abs(s.longitude! - city.lng) < 0.15
          );
          return (
            <CircleMarker
              key={`${city.name}-${i}`}
              center={[city.lat, city.lng]}
              radius={isActiveCity ? 7 : 4}
              pathOptions={{
                fillColor: isActiveCity ? activeDayColor : "#64748b",
                color: "#fff",
                weight: isActiveCity ? 2.5 : 1.5,
                fillOpacity: isActiveCity ? 0.9 : 0.7,
              }}
            >
              <Tooltip direction="top" offset={[0, -6]} opacity={0.9} permanent={false}>
                <span className="text-[10px] font-medium">{city.name}</span>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
