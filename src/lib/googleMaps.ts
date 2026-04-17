let loadPromise: Promise<void> | null = null;

/**
 * Load the Google Maps JavaScript API with Places library (once).
 * Safe to call multiple times — deduplicates automatically.
 */
export function loadGoogleMapsScript(): Promise<void> {
  if (loadPromise) return loadPromise;

  // Already loaded (e.g. via another script tag)
  if (typeof window !== "undefined" && window.google?.maps?.places) {
    return Promise.resolve();
  }

  loadPromise = new Promise((resolve, reject) => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (!key) {
      reject(new Error("NEXT_PUBLIC_GOOGLE_PLACES_API_KEY not set"));
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(script);
  });

  return loadPromise;
}
