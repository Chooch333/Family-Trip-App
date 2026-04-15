"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import "maplibre-gl/dist/maplibre-gl.css";

// ─────────────────────────────────────────────────────────────────────────────
// MapCinematic — MapLibre GL JS (vector tiles, WebGL)
//
// Why MapLibre instead of Leaflet:
// Leaflet loads raster tiles (individual PNGs) that can stall/partially render.
// MapLibre renders vector tiles via WebGL as one complete scene.
// The `idle` event fires only when ALL tiles are rendered — no partial maps.
//
// Uses CartoDB Dark Matter (free, no API key) for the cinematic dark style.
// ─────────────────────────────────────────────────────────────────────────────

interface MapCinematicProps {
  tripId: string;
  destination: string;
  refreshTrigger: number;
}

interface PinData {
  id: string;
  latitude: number;
  longitude: number;
  dayColor: string;
}

const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json";

export default function MapCinematic({ tripId, destination, refreshTrigger }: MapCinematicProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [pins, setPins] = useState<PinData[]>([]);
  const prevPinIds = useRef<Set<string>>(new Set());

  // ── Initialize MapLibre map ──
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    async function init() {
      // Geocode destination for initial center
      let lng = 12.5;
      let lat = 42.5;
      let zoom = 4;
      if (destination && destination.trim()) {
        try {
          const res = await fetch(`/api/geocode?${new URLSearchParams({ q: destination.trim() })}`);
          if (res.ok) {
            const geo = await res.json();
            if (geo.latitude != null && geo.longitude != null) {
              lat = geo.latitude;
              lng = geo.longitude;
              zoom = 7;
            }
          }
        } catch { /* defaults */ }
      }

      if (cancelled || !containerRef.current) return;

      const maplibregl = (await import("maplibre-gl")).default;

      if (cancelled || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: DARK_STYLE,
        center: [lng, lat],
        zoom,
        interactive: false,        // no pan/zoom/rotate
        attributionControl: false,
        fadeDuration: 0,            // no tile fade — renders complete
      });

      mapRef.current = map;

      // `idle` fires when all sources loaded AND all tiles rendered
      map.once("idle", () => {
        if (!cancelled) setMapReady(true);
      });

      // Safety fallback — if idle never fires (network issue), show after 6s
      setTimeout(() => {
        if (!cancelled) setMapReady(true);
      }, 6000);
    }

    init();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [destination]);

  // ── Fetch stops ──
  const fetchStops = useCallback(async () => {
    const { data: stops } = await supabase
      .from("stops")
      .select("id, latitude, longitude, day_id")
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
    if (days) for (const d of days) dayColorMap.set(d.id, d.color || "#1D9E75");

    const newPins: PinData[] = stops
      .filter((s: any) => s.latitude && s.longitude)
      .map((s: any) => ({
        id: s.id,
        latitude: s.latitude,
        longitude: s.longitude,
        dayColor: dayColorMap.get(s.day_id) || "#1D9E75",
      }));

    prevPinIds.current = new Set(newPins.map(p => p.id));
    setPins(newPins);
  }, [tripId]);

  useEffect(() => { fetchStops(); }, [refreshTrigger, fetchStops]);
  useEffect(() => {
    const interval = setInterval(fetchStops, 3000);
    return () => clearInterval(interval);
  }, [fetchStops]);

  // ── Render pins as HTML markers ──
  useEffect(() => {
    if (!mapReady || !mapRef.current || pins.length === 0) return;

    // Dynamically import maplibre for Marker class
    import("maplibre-gl").then(({ Marker, LngLatBounds }) => {
      const map = mapRef.current;
      if (!map) return;

      let newCount = 0;
      for (const pin of pins) {
        if (markersRef.current.has(pin.id)) continue;
        newCount++;

        const el = document.createElement("div");
        el.style.cssText = `
          width: 12px; height: 12px; border-radius: 50%;
          background: ${pin.dayColor};
          border: 2px solid rgba(255,255,255,0.9);
          box-shadow: 0 0 12px ${pin.dayColor}80;
          opacity: 0; transform: scale(0);
          animation: cinPin 0.5s cubic-bezier(0.34,1.56,0.64,1) ${newCount * 120}ms forwards;
        `;

        const marker = new Marker({ element: el })
          .setLngLat([pin.longitude, pin.latitude])
          .addTo(map);
        markersRef.current.set(pin.id, marker);
      }

      // Fit bounds to all pins
      if (pins.length >= 2) {
        const bounds = new LngLatBounds();
        for (const p of pins) bounds.extend([p.longitude, p.latitude]);
        map.fitBounds(bounds, { padding: 80, maxZoom: 12, duration: 2000 });
      } else if (pins.length === 1) {
        map.flyTo({ center: [pins[0].longitude, pins[0].latitude], zoom: 11, duration: 2000 });
      }
    });
  }, [pins, mapReady]);

  return (
    <div style={{ position: "absolute", inset: 0, background: "#0a0a0a" }}>
      <style>{`
        @keyframes cinPin {
          0% { opacity: 0; transform: scale(0); }
          60% { opacity: 1; transform: scale(1.3); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* Map container — hidden until fully rendered */}
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          inset: 0,
          visibility: mapReady ? "visible" : "hidden",
          opacity: mapReady ? 1 : 0,
          transition: "opacity 1.5s ease",
        }}
      />

      {/* Vignette overlay */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
        background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%)",
      }} />

      {/* Pin count */}
      {pins.length > 0 && mapReady && (
        <div style={{
          position: "absolute", bottom: 24, left: 24, fontSize: 13,
          color: "rgba(255,255,255,0.45)", zIndex: 2, fontWeight: 500,
        }}>
          {pins.length} stop{pins.length !== 1 ? "s" : ""} mapped
        </div>
      )}
    </div>
  );
}