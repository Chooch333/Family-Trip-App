"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface MapCinematicProps {
  tripId: string;
  destination: string;
  refreshTrigger: number;
}

interface PinData {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  dayColor: string;
}

export default function MapCinematic({ tripId, destination, refreshTrigger }: MapCinematicProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<any>(null);
  const leafletLib = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const [pins, setPins] = useState<PinData[]>([]);
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const prevPinIds = useRef<Set<string>>(new Set());
  const hasFitBounds = useRef(false);

  // Initialize map centered on destination
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    let cancelled = false;

    async function initMap() {
      // Geocode destination for initial center
      let initLat = 42.5;
      let initLng = 12.5;
      let initZoom = 5;
      try {
        const res = await fetch(`/api/geocode?${new URLSearchParams({ q: destination })}`);
        if (res.ok) {
          const geo = await res.json();
          if (geo.latitude != null && geo.longitude != null) {
            initLat = geo.latitude;
            initLng = geo.longitude;
            initZoom = 8;
          }
        }
      } catch { /* use defaults */ }

      if (cancelled || !mapRef.current) return;

      const L = (await import("leaflet")).default;
      leafletLib.current = L;

      if (cancelled || !mapRef.current) return;

      const map = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
      }).setView([initLat, initLng], initZoom);

      // Use Voyager (lighter, more readable) with CSS darkening for cinematic feel
      const tileLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png", {
        maxZoom: 18,
      }).addTo(map);

      // Wait for tiles to fully load before revealing
      tileLayer.on("load", () => {
        if (!cancelled) setTilesLoaded(true);
      });

      // Fallback: if tiles take too long, show after 4s anyway
      setTimeout(() => {
        if (!cancelled) setTilesLoaded(true);
      }, 4000);

      leafletMap.current = map;
    }

    initMap();
    return () => { cancelled = true; };
  }, [destination]);

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
      for (const d of days) dayColorMap.set(d.id, d.color || "#1D9E75");
    }

    const newPins: PinData[] = stops
      .filter((s: any) => s.latitude && s.longitude)
      .map((s: any) => ({
        id: s.id,
        name: s.name,
        latitude: s.latitude,
        longitude: s.longitude,
        dayColor: dayColorMap.get(s.day_id) || "#1D9E75",
      }));

    prevPinIds.current = new Set(newPins.map((p) => p.id));
    setPins(newPins);
  }, [tripId]);

  useEffect(() => { fetchStops(); }, [refreshTrigger, fetchStops]);
  useEffect(() => {
    const interval = setInterval(fetchStops, 3000);
    return () => clearInterval(interval);
  }, [fetchStops]);

  // Render pins on the map
  useEffect(() => {
    if (!tilesLoaded || !leafletMap.current || !leafletLib.current || pins.length === 0) return;

    const L = leafletLib.current;
    const map = leafletMap.current;

    // Add new markers with staggered animation
    let delay = 0;
    for (const pin of pins) {
      if (markersRef.current.has(pin.id)) continue;

      const currentDelay = delay;
      delay += 150; // 150ms stagger between pins

      setTimeout(() => {
        if (!leafletMap.current) return;
        const icon = L.divIcon({
          className: "cinematic-pin",
          html: `<div style="
            width: 14px; height: 14px; border-radius: 50%;
            background: ${pin.dayColor};
            border: 2.5px solid rgba(255,255,255,0.95);
            box-shadow: 0 0 16px ${pin.dayColor}90, 0 2px 8px rgba(0,0,0,0.4);
            animation: pinDrop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            opacity: 0; transform: scale(0);
          "></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        const marker = L.marker([pin.latitude, pin.longitude], { icon }).addTo(map);
        markersRef.current.set(pin.id, marker);
      }, currentDelay);
    }

    // Fit bounds — only fly if we have new pins, debounce to avoid jitter
    const allCoords = pins.map((p) => [p.latitude, p.longitude] as [number, number]);
    if (allCoords.length > 0) {
      const bounds = L.latLngBounds(allCoords);
      if (!hasFitBounds.current) {
        // First fit: fly to destination region
        hasFitBounds.current = true;
        map.flyToBounds(bounds, { padding: [80, 80], duration: 2, maxZoom: 12 });
      } else {
        // Subsequent: gentle adjust if bounds changed significantly
        map.flyToBounds(bounds, { padding: [80, 80], duration: 1, maxZoom: 12 });
      }
    }
  }, [pins, tilesLoaded]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (leafletMap.current) { leafletMap.current.remove(); leafletMap.current = null; }
    };
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0, background: "#111" }}>
      <style>{`
        @keyframes pinDrop {
          0% { opacity: 0; transform: scale(0); }
          60% { opacity: 1; transform: scale(1.2); }
          100% { opacity: 1; transform: scale(1); }
        }
        .cinematic-pin { background: none !important; border: none !important; }
        .leaflet-container { background: #111 !important; }
      `}</style>
      <div
        ref={mapRef}
        style={{
          position: "absolute",
          inset: 0,
          opacity: tilesLoaded ? 1 : 0,
          transition: "opacity 1.5s ease",
          filter: "brightness(0.55) saturate(0.7)",
        }}
      />
      {/* Vignette overlay for cinematic depth */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
        background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%)",
      }} />
      {/* Pin count */}
      {pins.length > 0 && tilesLoaded && (
        <div style={{
          position: "absolute", bottom: 24, left: 24, fontSize: 13,
          color: "rgba(255,255,255,0.5)", zIndex: 2, fontWeight: 500,
        }}>
          {pins.length} stop{pins.length !== 1 ? "s" : ""} mapped
        </div>
      )}
    </div>
  );
}