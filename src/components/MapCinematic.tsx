"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface MapCinematicProps {
  tripId: string;
  refreshTrigger: number; // increments as new days are generated
}

interface PinData {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  dayColor: string;
  isNew: boolean;
}

export default function MapCinematic({ tripId, refreshTrigger }: MapCinematicProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const [pins, setPins] = useState<PinData[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const prevPinIds = useRef<Set<string>>(new Set());

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    let cancelled = false;

    async function initMap() {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");

      if (cancelled || !mapRef.current) return;

      const map = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
      }).setView([42.5, 12.5], 5); // Default to Mediterranean view

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 18,
      }).addTo(map);

      leafletMap.current = map;
      setMapReady(true);
    }

    initMap();
    return () => { cancelled = true; };
  }, []);

  // Fetch stops when refreshTrigger changes
  const fetchStops = useCallback(async () => {
    const { data: stops } = await supabase
      .from("stops")
      .select("id, name, latitude, longitude, day_id")
      .eq("trip_id", tripId)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("sort_order");

    if (!stops || stops.length === 0) return;

    const { data: days } = await supabase
      .from("days")
      .select("id, color")
      .eq("trip_id", tripId);

    const dayColorMap = new Map<string, string>();
    if (days) {
      for (const d of days) {
        dayColorMap.set(d.id, d.color || "#1D9E75");
      }
    }

    const newPins: PinData[] = stops
      .filter((s: any) => s.latitude && s.longitude)
      .map((s: any) => ({
        id: s.id,
        name: s.name,
        latitude: s.latitude,
        longitude: s.longitude,
        dayColor: dayColorMap.get(s.day_id) || "#1D9E75",
        isNew: !prevPinIds.current.has(s.id),
      }));

    prevPinIds.current = new Set(newPins.map((p) => p.id));
    setPins(newPins);
  }, [tripId]);

  useEffect(() => {
    fetchStops();
  }, [refreshTrigger, fetchStops]);

  // Also poll every 3 seconds for stops that might arrive from geocoding
  useEffect(() => {
    const interval = setInterval(fetchStops, 3000);
    return () => clearInterval(interval);
  }, [fetchStops]);

  // Render pins on the map
  useEffect(() => {
    if (!mapReady || !leafletMap.current || pins.length === 0) return;

    const L = require("leaflet");
    const map = leafletMap.current;

    // Add new markers with animation
    for (const pin of pins) {
      if (markersRef.current.has(pin.id)) continue;

      const icon = L.divIcon({
        className: "cinematic-pin",
        html: `<div style="
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: ${pin.dayColor};
          border: 2.5px solid rgba(255,255,255,0.9);
          box-shadow: 0 0 12px ${pin.dayColor}80, 0 2px 8px rgba(0,0,0,0.3);
          animation: pinDrop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
          opacity: 0;
          transform: scale(0);
        "></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const marker = L.marker([pin.latitude, pin.longitude], { icon }).addTo(map);
      markersRef.current.set(pin.id, marker);
    }

    // Fit bounds with padding and animation
    const coords = pins.map((p) => [p.latitude, p.longitude] as [number, number]);
    if (coords.length > 0) {
      const bounds = L.latLngBounds(coords);
      map.flyToBounds(bounds, {
        padding: [60, 60],
        duration: 1.5,
        easeLinearity: 0.25,
        maxZoom: 12,
      });
    }
  }, [pins, mapReady]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0, background: "#0a0a0a" }}>
      <style>{`
        @keyframes pinDrop {
          0% { opacity: 0; transform: scale(0); }
          50% { opacity: 1; transform: scale(1.3); }
          100% { opacity: 1; transform: scale(1); }
        }
        .cinematic-pin { background: none !important; border: none !important; }
        .leaflet-container { background: #0a0a0a !important; }
      `}</style>
      <div
        ref={mapRef}
        style={{
          position: "absolute",
          inset: 0,
          opacity: mapReady ? 1 : 0,
          transition: "opacity 1s ease",
        }}
      />
      {/* Subtle vignette overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%)",
          zIndex: 1,
        }}
      />
      {/* Pin count indicator */}
      {pins.length > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 24,
            left: 24,
            fontSize: 13,
            color: "rgba(255,255,255,0.4)",
            zIndex: 2,
            fontWeight: 500,
          }}
        >
          {pins.length} stop{pins.length !== 1 ? "s" : ""} mapped
        </div>
      )}
    </div>
  );
}