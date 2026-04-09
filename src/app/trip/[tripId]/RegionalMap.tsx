"use client";
import { useEffect, useMemo, useCallback } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export interface RegionalMapProps {
  routeCities: { name: string; lat: number; lng: number; dayIndices: number[] }[];
  activeCityIndex: number;
  activeDayColor: string;
  onSelectDay?: (dayIndex: number) => void;
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

function DisableInteraction() {
  const map = useMap();
  useEffect(() => {
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.doubleClickZoom.disable();
    map.touchZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
  }, [map]);
  return null;
}

export default function RegionalMap({ routeCities, activeCityIndex, activeDayColor, onSelectDay }: RegionalMapProps) {
  const routePositions = useMemo(
    () => routeCities.map(c => [c.lat, c.lng] as [number, number]),
    [routeCities]
  );

  const handleCityClick = useCallback((cityIndex: number) => {
    if (!onSelectDay) return;
    const city = routeCities[cityIndex];
    if (city && city.dayIndices.length > 0) {
      onSelectDay(city.dayIndices[0]);
    }
  }, [routeCities, onSelectDay]);

  if (routeCities.length === 0) return null;

  const center: [number, number] = [routeCities[0].lat, routeCities[0].lng];

  return (
    <div className="w-full flex-shrink-0" style={{ height: 182 }}>
      <MapContainer center={center} zoom={6} className="w-full h-full" style={{ zIndex: 0 }} zoomControl={false} attributionControl={false}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
        />
        <FitAllBounds points={routeCities} />
        <DisableInteraction />
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
        {routeCities.map((city, i) => {
          const isActive = i === activeCityIndex;
          return (
            <CircleMarker
              key={`${city.name}-${i}`}
              center={[city.lat, city.lng]}
              radius={isActive ? 8 : 5}
              pathOptions={{
                fillColor: isActive ? activeDayColor : "transparent",
                color: isActive ? activeDayColor : "#64748b",
                weight: isActive ? 2.5 : 1.5,
                fillOpacity: isActive ? 0.9 : 1,
              }}
              eventHandlers={{
                click: () => handleCityClick(i),
                mouseover: (e) => { e.target.setRadius(8); e.target.getElement()?.style.setProperty("cursor", "pointer"); },
                mouseout: (e) => { e.target.setRadius(isActive ? 8 : 5); },
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
