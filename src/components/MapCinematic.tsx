"use client";
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

// ─────────────────────────────────────────────────────────────────────────────
// MapCinematic — atmospheric map reveal + zoom on destination
// No pins, no interactivity. Just a slow cinematic reveal.
// ─────────────────────────────────────────────────────────────────────────────

interface MapCinematicProps {
  tripId: string;
  destination: string;
  refreshTrigger: number;
}

const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json";

export default function MapCinematic({ destination }: MapCinematicProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    async function init() {
      let lng = 12.5;
      let lat = 42.5;
      let startZoom = 5;
      if (destination && destination.trim()) {
        try {
          const res = await fetch(`/api/geocode?${new URLSearchParams({ q: destination.trim() })}`);
          if (res.ok) {
            const geo = await res.json();
            if (geo.latitude != null && geo.longitude != null) {
              lat = geo.latitude;
              lng = geo.longitude;
              startZoom = 6;
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
        zoom: startZoom,
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
      });

      mapRef.current = map;

      map.once("idle", () => {
        if (cancelled) return;
        setMapReady(true);
        // Slow cinematic zoom in after reveal
        setTimeout(() => {
          if (cancelled || !mapRef.current) return;
          mapRef.current.flyTo({
            center: [lng, lat],
            zoom: startZoom + 3,
            duration: 4000,
            easing: (t: number) => t * (2 - t), // ease-out
          });
        }, 1500);
      });

      setTimeout(() => { if (!cancelled) setMapReady(true); }, 6000);
    }

    init();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [destination]);

  return (
    <div style={{ position: "absolute", inset: 0, background: "#0a0a0a" }}>
      <div
        ref={containerRef}
        style={{
          position: "absolute", inset: 0,
          visibility: mapReady ? "visible" : "hidden",
          opacity: mapReady ? 1 : 0,
          transition: "opacity 1.5s ease",
        }}
      />
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
        background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%)",
      }} />
    </div>
  );
}