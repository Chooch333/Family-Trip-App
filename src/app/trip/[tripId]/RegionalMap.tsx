"use client";
import { useEffect, useMemo, useCallback, useRef, useState } from "react";
import { loadGoogleMapsScript } from "@/lib/googleMaps";

export interface RegionalMapProps {
  routeCities: { name: string; lat: number; lng: number; dayIndices: number[] }[];
  activeCityIndex: number;
  activeDayColor: string;
  onSelectDay?: (dayIndex: number) => void;
}

const MAP_ID = "b37fd2d82b1f372e262e3a18";

function makeCircleSvg(
  radius: number,
  fillColor: string,
  strokeColor: string,
  strokeWidth: number,
  fillOpacity: number,
): string {
  const size = (radius + strokeWidth) * 2;
  const cx = size / 2;
  const cy = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fillColor}" fill-opacity="${fillOpacity}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>` +
    `</svg>`;
}

export default function RegionalMap({ routeCities, activeCityIndex, activeDayColor, onSelectDay }: RegionalMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const polylineRef = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);

  const routePositions = useMemo(
    () => routeCities.map(c => ({ lat: c.lat, lng: c.lng })),
    [routeCities]
  );

  const handleCityClick = useCallback((cityIndex: number) => {
    if (!onSelectDay) return;
    const city = routeCities[cityIndex];
    if (city && city.dayIndices.length > 0) {
      onSelectDay(city.dayIndices[0]);
    }
  }, [routeCities, onSelectDay]);

  // Initialize map
  useEffect(() => {
    let cancelled = false;
    loadGoogleMapsScript().then(() => {
      if (cancelled || !containerRef.current) return;
      const google = (window as any).google;
      if (!google?.maps) return;
      if (!mapRef.current) {
        mapRef.current = new google.maps.Map(containerRef.current, {
          mapId: MAP_ID,
          center: { lat: 0, lng: 0 },
          zoom: 6,
          disableDefaultUI: true,
          gestureHandling: "none",
          keyboardShortcuts: false,
        });
      }
      infoWindowRef.current = new google.maps.InfoWindow({ disableAutoPan: true });
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Fit bounds
  useEffect(() => {
    if (!loaded || !mapRef.current || routeCities.length === 0) return;
    const google = (window as any).google;
    if (routeCities.length === 1) {
      mapRef.current.setCenter({ lat: routeCities[0].lat, lng: routeCities[0].lng });
      mapRef.current.setZoom(8);
    } else {
      const bounds = new google.maps.LatLngBounds();
      routeCities.forEach(c => bounds.extend({ lat: c.lat, lng: c.lng }));
      mapRef.current.fitBounds(bounds, 20);
      // Enforce maxZoom 10
      const listener = google.maps.event.addListenerOnce(mapRef.current, "idle", () => {
        if (mapRef.current.getZoom() > 10) mapRef.current.setZoom(10);
      });
    }
  }, [loaded, routeCities]);

  // Update polyline
  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const google = (window as any).google;

    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    if (routePositions.length >= 2) {
      polylineRef.current = new google.maps.Polyline({
        path: routePositions,
        strokeColor: "#94a3b8",
        strokeWeight: 2,
        strokeOpacity: 0,
        icons: [{
          icon: {
            path: "M 0,-1 0,1",
            strokeOpacity: 0.6,
            strokeColor: "#94a3b8",
            scale: 2,
          },
          offset: "0",
          repeat: "11px",
        }],
        map: mapRef.current,
      });
    }
  }, [loaded, routePositions]);

  // Update markers
  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const google = (window as any).google;
    const map = mapRef.current;
    const iw = infoWindowRef.current;

    // Clear old
    markersRef.current.forEach(m => { m.map = null; });
    markersRef.current = [];

    routeCities.forEach((city, i) => {
      const isActive = i === activeCityIndex;
      const radius = isActive ? 8 : 5;
      const fillColor = isActive ? activeDayColor : "transparent";
      const strokeColor = isActive ? activeDayColor : "#64748b";
      const strokeWidth = isActive ? 2.5 : 1.5;
      const fillOpacity = isActive ? 0.9 : 1;

      const svg = makeCircleSvg(radius, fillColor, strokeColor, strokeWidth, fillOpacity);
      const el = document.createElement("div");
      el.innerHTML = svg;
      el.style.cursor = "pointer";
      el.style.transition = "transform 0.15s ease";

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: city.lat, lng: city.lng },
        content: el,
      });

      marker.addListener("click", () => handleCityClick(i));

      el.addEventListener("mouseenter", () => {
        if (!isActive) el.style.transform = "scale(1.6)";
        if (iw) {
          iw.setContent(`<span style="font-size:10px;font-weight:500">${city.name}</span>`);
          iw.open({ map, anchor: marker });
        }
      });
      el.addEventListener("mouseleave", () => {
        el.style.transform = "";
        if (iw) iw.close();
      });

      markersRef.current.push(marker);
    });
  }, [loaded, routeCities, activeCityIndex, activeDayColor, handleCityClick]);

  if (routeCities.length === 0) return null;

  return (
    <div className="w-full flex-shrink-0" style={{ height: 209 }}>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
