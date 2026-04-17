"use client";
import { useEffect, useRef, useState } from "react";
import { loadGoogleMapsScript } from "@/lib/googleMaps";

export interface PlaceResult {
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  placeId: string;
}

interface PlacesAutocompleteProps {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  onPlaceSelect: (place: PlaceResult) => void;
  className?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
  /** Bias results toward this location (e.g. trip destination coords) */
  biasLat?: number;
  biasLng?: number;
}

// Use `any` for Google Maps types — the script is loaded dynamically at runtime,
// so we avoid a build dependency on @types/google.maps.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default function PlacesAutocomplete({
  placeholder = "Search for a place...",
  value,
  onChange,
  onPlaceSelect,
  className = "",
  style,
  autoFocus = false,
  biasLat,
  biasLng,
}: PlacesAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadGoogleMapsScript()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFallback(true);
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready || !inputRef.current || autocompleteRef.current) return;

    const g = (window as any).google;
    if (!g?.maps?.places) return;

    const options: any = {
      fields: ["name", "formatted_address", "geometry", "place_id"],
      types: ["establishment", "geocode"],
    };

    // Bias toward trip destination if provided
    if (biasLat != null && biasLng != null) {
      options.bounds = new g.maps.LatLngBounds(
        new g.maps.LatLng(biasLat - 0.5, biasLng - 0.5),
        new g.maps.LatLng(biasLat + 0.5, biasLng + 0.5),
      );
    }

    const ac = new g.maps.places.Autocomplete(inputRef.current, options);
    autocompleteRef.current = ac;

    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (!place || !place.name) return;

      onPlaceSelect({
        name: place.name,
        address: place.formatted_address || "",
        latitude: place.geometry?.location?.lat() ?? null,
        longitude: place.geometry?.location?.lng() ?? null,
        placeId: place.place_id || "",
      });
    });

    return () => {
      g.maps.event.clearInstanceListeners(ac);
    };
  }, [ready, biasLat, biasLng, onPlaceSelect]);

  // Sync controlled value
  useEffect(() => {
    if (inputRef.current && value !== undefined) {
      inputRef.current.value = value;
    }
  }, [value]);

  // If Google fails to load, render a plain input
  if (fallback) {
    return (
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        className={className}
        style={style}
        autoFocus={autoFocus}
      />
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      placeholder={ready ? placeholder : "Loading places..."}
      defaultValue={value}
      onChange={e => onChange?.(e.target.value)}
      className={className}
      style={style}
      autoFocus={autoFocus}
      disabled={!ready && !fallback}
    />
  );
}
