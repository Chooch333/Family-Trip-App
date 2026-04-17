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
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
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

    const options: google.maps.places.AutocompleteOptions = {
      fields: ["name", "formatted_address", "geometry", "place_id"],
      types: ["establishment", "geocode"],
    };

    // Bias toward trip destination if provided
    if (biasLat != null && biasLng != null) {
      options.bounds = new google.maps.LatLngBounds(
        new google.maps.LatLng(biasLat - 0.5, biasLng - 0.5),
        new google.maps.LatLng(biasLat + 0.5, biasLng + 0.5),
      );
    }

    const ac = new google.maps.places.Autocomplete(inputRef.current, options);
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
      google.maps.event.clearInstanceListeners(ac);
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
