# Trip Tour — Implementation Spec

**Refreshed 2026-06-11 to match the shipped implementation (F-068).** This replaces the original design doc, which predated the photo pipeline, the state machine, and several slide-sequence decisions. Source of truth for open work is the Project State plan "Family Trip App — Canonical Roadmap."

Files: `src/components/TripTour.tsx` (slideshow) · `src/app/trip/[tripId]/curating/page.tsx` (generation + photo orchestration) · `src/components/MapCinematic.tsx` (loading map) · `src/app/api/unsplash/search/route.ts` · `src/app/api/places/photos/route.ts`

---

## Phases (strictly one-directional, F-063)

**cinematic → tour → workspace.** Never backwards.

- **Cinematic:** dark MapLibre GL zoom-in on the destination (CartoDB Dark Matter; `idle` event guarantees full render) with a centered "I'm curating your trip" spinner overlay. No progress bar, no status messages.
- **Cinematic → tour:** fires when `hypeReady` is true (hype slide photos stored) AND a minimum 6 seconds of cinematic display has elapsed. One-shot via `tourLaunched` ref — never re-fires. Safety net: if generation completes while still in cinematic, the tour is force-launched.
- **Tour → workspace:** user reaches the final slide's "Explore my trip" button or presses Escape. Sets `sessionStorage tour_seen_${tripId}` so the tour shows once per trip per session.

Generation runs in 2-day chunks; the tour launches after the first chunk (~1.5 min) and grows live.

## Slide sequence (F-066, revised)

```
[Hype: Destination] → [Hype: Food] → [Hype: Gems]
  → per city: [City Arrival]* → [Day cards...]
  → [Final: "YOUR TRIP IS READY" + Explore my trip]
```

- `*` City Arrival is conditional on BOTH ≥2 distinct title-cities AND the geographic `isMultiCityTrip()` check from `src/lib/routeCities.ts` (distance between stop clusters, not title parsing — this is the fix for the NYC 7-neighborhood phantom arrivals, F-072). Labels: "First stop" / "Next up" / "Final destination."
- **Anchor Spotlight slides were removed** as redundant with day cards. A revisit with real per-stop blurbs and photos is tracked as next-move F-081 (after per-stop photos, F-075).
- **No wrap-up/closer slides.** If the last slide is a card, a dedicated final center slide is appended with the trip summary and the exit button; if it's already a center slide, the button is attached to it.
- The deck grows as chunks land (Supabase polled every 4s until `generationComplete`); the counter shows `N / M+` while growing, and a small spinner replaces the next-arrow when the viewer is waiting at the live edge.

## Slide visuals

- Photos only — black `#111` base, no visible gradients. 45% dark scrim over every photo; text-shadow on all text.
- Opacity-only transitions (0.5–0.7s); no sliding. `SlideBackground` crossfades a slide's photos every 3 seconds.
- Day cards use 5 deterministic positions cycled by index (`getCardPosition`), inset 72px from edges to clear the nav arrows. Card width 380, white at 96% opacity with blur.
- Type scale: headline 35px, body 17px, card titles 20px, labels 11–12px uppercase.
- Day card stop rows: color bar (thick + full opacity when anchored), name, type · duration, time, anchor icon on anchored stops. Max 5 stops shown, anchors prioritized.
- Navigation: arrows, Space, ←/→, Escape to exit.

## Photo pipeline (F-061/F-062/F-065/F-071/F-083)

**Sources:** Unsplash first (editorial quality), Google Places fallback. Both routes cache binaries permanently in the Supabase Storage `slide-photos` bucket (`${tripId}/${timestamp}-${rand}.jpg`, 1-year cache) — slides render Supabase CDN URLs, never source URLs, so Google is charged once per photo.

**Mechanics:**
- `usedUrls` Set deduplicates globally across the whole slideshow — no photo repeats (F-065 standing rule).
- `fetchOnePerQuery`: one targeted query per image, take the #1 result. Query specificity is the quality lever — actual place names, not generic destination terms.
- Photo strategy going forward (F-083): stop-level photos shift to Google Places photos via captured `place_id`; Unsplash narrows to emotive hype/mood shots; curated winners get promoted to a reuse library (photo review widget, F-080).

**Allocation (rolling pool retired per F-071):**
- **Hype slides:** 15 evocative queries (5 destination, 5 food-atmosphere, 5 hidden-gems) fetched in parallel — but only AFTER the 6-second cinematic finishes, to avoid network contention with the map animation. Stored on `trips.slide_images`. Each hype slide takes 3 photos via a rolling offset.
- **Day cards:** up to 3 queries per day at generation time — priority: anchor non-food stops by name+city → day-title keywords (neighborhoods/landmarks) → city/destination fallback → food-district atmosphere for food-only days. Stored on `days.slide_images` (each day owns its photos). Day cards show 2; fall back to the trip pool if the day has <2.
- **City arrivals:** post-generation, 2 photos per distinct city, fetched only when ≥2 cities. Appended to `trips.slide_images`.
- **Final slide:** 1 cinematic closing image, appended post-generation.
- Open: F-076 — keyed per-slide storage structure (vs. the appended pool) for city/final images.

## Hype slide copy

Built client-side from intake data, no AI call: `buildDestinationHype` / `buildFoodHype` / `buildGemsHype` weave in season (parsed from travel dates), kids' ages, group type, interests, and extra notes (first-time, pets). Destination-aware food intros for Italy/France/Japan/Mexico. Voice matches the curator persona — opinionated friend, no brochure language.

## Data dependencies

- `trips`: `slide_images` (jsonb), `trip_summary` (text) — **both must exist in `src/lib/database.types.ts`**; a missing entry is a hard build failure (Lesson F-084).
- `days`: `slide_images` (jsonb), `narrative`, `reasoning`, `vibe_status` set to "locked" at insert.
- `stops`: `is_anchor` (drives card emphasis and photo query priority), `stop_type` (transit excluded from cards/pins).
