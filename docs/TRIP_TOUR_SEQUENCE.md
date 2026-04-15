# Trip Tour — Sequencing & Coordination Spec

## What This Doc Is

The Trip Tour is a cinematic presentation experience that plays when a user creates a new trip. It has three acts: a map reveal, personality-driven hype slides, and a growing day-by-day walkthrough. This doc maps every visual beat, the data each beat depends on, and the state coordination that connects them.

---

## The Full User Journey (What They See)

### ACT 1 — The Map (cinematic phase)

| Beat | Visual | Duration | Trigger |
|------|--------|----------|---------|
| 1.1 | Dark map fades in, centered on destination | ~1.5s | Map `idle` event fires |
| 1.2 | Map slowly zooms in tighter on the destination | ~3.5s | Smooth zoom with easing after map reveal |
| 1.3 | Map holds at zoomed level with progress overlay | Ongoing | Waiting for `firstChunkDone` |

No loading spinner screen. No pin drops. The map is purely atmospheric — a slow reveal and zoom into the destination region while generation runs in the background.

**Data needed for Act 1:**
- `trip.destination` (geocoding for initial center) — available immediately
- `generatedDays` count (for progress bar) — updates per saved day

**Progress overlay during Act 1:**
- Centered text: **"I'm curating your trip"** with a spinning animation (subtle spinner or animated dots — something that feels alive, not a loading bar)
- This is Claude speaking in first person. Keep it warm, not mechanical.

**Exit condition:** `firstChunkDone === true` (generatedDays ≥ 2) AND at least 6 seconds elapsed since cinematic start.

---

### ACT 2 — The Hype Slides (tour phase, gated on first chunk)

These render from `trip` metadata but **only appear once the first day chunk is ready** (generatedDays ≥ 2). A day chunk = 2 days worth of stops. The hype slides and the first chunk's day slides are a package — they launch together so the user always has content to click through.

| Slide | Key | Layout | Label | Headline | Body Source |
|-------|-----|--------|-------|----------|-------------|
| 2.1 | `hype-destination` | center | THE DESTINATION | `trip.destination` | `buildDestinationHype(trip)` |
| 2.2 | `hype-food` | center | THE FOOD | "How I'm thinking about food." | `buildFoodHype(trip)` |
| 2.3 | `hype-gems` | center | HIDDEN GEMS | "Things most people miss." | `buildGemsHype(trip)` |

**Headline guidance:** Keep headlines short and punchy — 5 words max. The body text carries the personality. Long headlines like "I'm going to show you things most people walk right past" read awkwardly on screen. That voice goes in the body paragraph.

**Data needed:** `trip.destination`, `trip.group_type`, `trip.group_detail`, `trip.interests`, `trip.travel_dates`, `trip.extra_notes`

**Design:** Text card over 2 cycling background images (see Background Images below). No buttons — arrow navigation only. Each slide has a unique accent color for its label.

**Accent colors:**
- Destination: `#5DCAA5` (teal)
- Food: `#D85A30` (copper)
- Gems: `#AFA9EC` (lavender)

**User behavior during Act 2:** Clicking/tapping right arrow or pressing → / spacebar to advance. By the time they finish 3 hype slides (~15-30 seconds of reading), the first chunk's day slides are already loaded and waiting.

---

### ACT 3 — The Day Slides (tour phase, growing)

These grow as Supabase chunks land. TripTour polls every 4 seconds. A chunk = 2 days of stops.

#### 3A. City Arrival Slides (multi-city trips only)

| Slide | Key | Layout | When |
|-------|-----|--------|------|
| City arrival | `city-{cityName}` | center | One per distinct city, multi-city trips only |

**Label:** "First stop" / "Next up" / "Final destination"
**Headline:** City name
**Body:** Day narrative or fallback count

#### 3B. Anchor Spotlight

| Slide | Key | Layout | When |
|-------|-----|--------|------|
| Best anchor | `anchor-{stopId}` | card | First occurrence of the highest-rated anchor stop in each city |

#### 3C. Day Overview Slides

| Slide | Key | Layout | When |
|-------|-----|--------|------|
| Day overview | `day-{dayId}` | card | One per day with stops |

**Contents:** Day number label, day title, narrative + reasoning body, stop list (max 5, anchors prioritized).

**Stop list items show:** name, type · duration, time, anchor icon if applicable. Accent bar uses day color.

#### Card Positioning — MUST BE STATIC

Cards (anchor spotlights, day overviews) must lock into position when their slide is selected. No sliding, no bouncing, no flying across the screen.

**Current problem:** `pickPosition()` randomly assigns a position (topLeft, topRight, etc.) and the card DOM element has CSS transitions on `top/left/right/bottom`. When navigating between card slides, the card visually slides from one position to another. Additionally, positions are recalculated on every render, so they can shift when new chunks arrive and the slide array rebuilds.

**Required fix:**
- Assign each card slide a **deterministic, stable position** at creation time (based on slide index, not random). Store the position in the slide data so it never changes.
- **Remove all position transitions** from the card element. The only transition should be `opacity` (fade in/out). When you navigate to a card slide, it fades in at its assigned position. When you navigate away, it fades out. No movement.
- Position must survive slide array rebuilds — existing slides keep their positions when new chunks add slides to the array.

#### Growing behavior:
- When TripTour first mounts, it polls Supabase and gets whatever days/stops exist
- Every 4s it re-polls and rebuilds slides
- New day slides appear at the END of the day section (after existing ones)
- Slide counter shows "3/7+" when more data is expected
- At the last slide, if `!generationComplete`, show a loading spinner instead of the right arrow

#### Final Slide

When all chunks have landed and the user reaches the final day slide, show an **"Explore my trip"** button. This is the exit point — clicking it takes the user to the workspace.

---

## Background Images

Every slide (hype and day) displays **2 high-quality destination images** that slowly cycle in the background behind the text card. The images and the text are separate layers — **no overlay, no scrim on the images themselves.** The text lives in its own card; the images are purely atmospheric behind it.

### Image delivery — must be reliable

Images cannot be fetched on-the-fly from external APIs during the slideshow. They need to be **packaged with the day chunks** during generation and stored so they deploy with high certainty.

**Storage approach:**
- During chunk generation (in `curate()`), fetch and store image URLs or image data alongside the day/stop data
- Store image references in Supabase (either as URLs to a reliable CDN, or as stored objects in Supabase Storage)
- TripTour reads image references from the same Supabase polling it already does for days/stops
- Images must be pre-loaded before the slide transitions to them — no blank frames

### Image sourcing — open discussion

Need high-resolution destination photography that won't jam up the generation process. Options to evaluate:

- **Unsplash API** — Free, high quality, reliable CDN. Rate limited but generous. Could fetch during generation and store URLs.
- **Google Places Photos** — Tied to specific places (good for day slides), requires API key, has usage costs.
- **Pexels API** — Similar to Unsplash, free tier available.
- **Pre-curated library** — Build a destination image bank over time. Most reliable but most upfront work.

**Key constraint:** Image fetching happens during generation, not during slideshow playback. Whatever source we choose, it runs in `curate()` alongside the AI calls and writes results to Supabase. The slideshow only reads what's already stored.

### Display behavior:
- Each slide has 2 images
- Images display full-bleed behind the text card
- Crossfade between the 2 images on a slow timer (~6-8 seconds per image)
- Fallback: if images aren't available for a slide, use the existing gradient backgrounds

---

## Complete Slide Sequence (Summary)

```
[Hype: Destination] → [Hype: Food] → [Hype: Gems]
  → [City Arrival]* → [Anchor Spotlight]* → [Day 1] → [Day 2]
  → [City Arrival]* → [Anchor Spotlight]* → [Day 3] → [Day 4]
  → ... (slides grow as chunks land)
  → [Final Day + "Explore my trip" button] → EXIT TO WORKSPACE

*  = conditional (multi-city only for arrivals, best anchor per city)
```

No wrap-up slides. The tour ends with the "Explore my trip" button on the final slide.

---

## State Machine — Phase Transitions

```
CINEMATIC ──(firstChunkDone + 6s min)──→ TOUR ──("Explore my trip" or escape)──→ WORKSPACE
     │                                                                               ↑
     └──(generationDone + stuck in cinematic)────────────────────────────────────────┘
```

### States

| State | Component | What's Visible |
|-------|-----------|----------------|
| `cinematic` | CuratingPage + MapCinematic | Dark map with zoom, "I'm curating your trip" overlay |
| `tour` | TripTour | Full-screen slideshow with background images |
| `workspace` | TripPage | Three-panel layout (stops, chat, map) |

### Transition: cinematic → tour
- **Trigger:** `firstChunkDone` becomes true (one-shot boolean, fires when `generatedDays` first ≥ 2)
- **Guard:** `phase === "cinematic"` AND `!tourLaunched.current`
- **Timing:** `Math.max(0, 6000 - elapsed)` — waits for minimum 6s cinematic display
- **Action:** Set `tourLaunched.current = true`, set phase to "tour"
- **KEY DESIGN:** `firstChunkDone` only transitions `false → true` once. The effect depends on `[phase, firstChunkDone]`. Timer is set exactly once and never canceled by subsequent `generatedDays` increments.

### Transition: tour → workspace
- **Trigger:** User clicks "Explore my trip" on the final slide, OR presses Escape at any point
- **Action:** `sessionStorage.setItem(tour_seen_{tripId})`, `router.push(/trip/{tripId})`

### Safety net: cinematic → tour (edge case)
- **Trigger:** `generationDone && phase === "cinematic" && !tourLaunched.current`
- **Action:** Force `tourLaunched.current = true`, set phase to "tour"
- **When this fires:** Only if generation completes before `firstChunkDone` somehow (e.g., 0 or 1 days generated total)

---

## Data Flow

### What the curating page generates (API → Supabase)

```
curate() starts
  ├── Fetch trip data from Supabase
  ├── Check if days already exist → redirect to workspace if yes
  ├── Calculate totalDays from trip.duration
  ├── Loop: generate chunks of 2 days each
  │     ├── POST /api/ai/chat (system prompt + user prompt)
  │     ├── Parse JSON response
  │     ├── For each day in response:
  │     │     ├── INSERT into `days` table
  │     │     ├── INSERT stops into `stops` table
  │     │     ├── Fetch + store 2 background images for the day (see Background Images)
  │     │     └── setGeneratedDays(++saved) ← triggers firstChunkDone when ≥ 2
  │     └── Retry once on failure
  ├── Fetch + store background images for hype slides (destination-level)
  ├── Generate trip summary (separate API call)
  │     └── UPDATE trip.trip_summary
  └── setGenerationDone(true)
```

**Chunk definition:** 1 chunk = 1 API call = 2 days of stops + their background images. A 7-day trip has 4 chunks (2+2+2+1).

### What TripTour reads (Supabase polling)

```
Every 4 seconds (while !generationComplete):
  ├── SELECT * FROM days WHERE trip_id = X ORDER BY day_number
  ├── SELECT * FROM stops WHERE trip_id = X AND version_owner IS NULL ORDER BY sort_order
  ├── Read image references for available days
  └── Rebuild slides from days + stops + images + trip metadata

On generationComplete:
  ├── One final fetch of days + stops + images
  └── Fetch updated trip (for trip_summary — available but not displayed in tour)
```

---

## Known Issues & Required Fixes

### 1. Card position sliding (HIGH PRIORITY — BLOCKING)

**Problem:** Card slides fly across the screen when navigating between them. Caused by CSS transitions on positional properties (`top`, `left`, `right`, `bottom`) combined with random position assignment.

**Fix:** Remove all positional transitions. Assign deterministic positions at slide creation time (stored in slide data). Only transition `opacity`. Cards fade in/out at their fixed location.

### 2. Card positions unstable across renders

**Problem:** `pickPosition()` runs on every render. When new chunks arrive and the slide array rebuilds, existing card positions can change.

**Fix:** Use a deterministic position function based on slide index (e.g., `POSITIONS[index % POSITIONS.length]`). Position is computed once and stored in the slide object. Rebuilds preserve existing positions.

### 3. Headlines too long on hype slides

**Problem:** Headlines like "I'm going to show you things most people walk right past" are wordy and read awkwardly as display text.

**Fix:** Cap headlines at ~5 words. Move the personality into the body paragraph. Examples: "Things most people miss." not "I'm going to show you things most people walk right past."

### 4. "Co-Pilot" terminology in cinematic overlay

**Problem:** Progress overlay says "Your Co-Pilot is building your trip."

**Fix:** Replace with "I'm curating your trip" + spinning animation.

### 5. Background images not yet implemented (NEW FEATURE)

**Problem:** Slides currently use flat gradient backgrounds. They need 2 high-quality destination photos cycling behind the text card.

**Fix:** See Background Images section. Images must be fetched during generation, stored in Supabase, and read by TripTour during polling. No on-the-fly external API calls during slideshow.

### 6. Loading spinner screen before cinematic

**Problem:** There's a 2-second loading spinner before the map appears. Unnecessary dead time.

**Fix:** Remove the loading phase. Go straight to cinematic on mount. Map handles its own loading state (hidden until `idle` event).

### 7. Final slide needs exit button

**Problem:** No clear exit point from the tour when all slides have been viewed.

**Fix:** Add "Explore my trip" button on the final day slide. Button triggers `onComplete` → workspace.

---

## File Map

| File | Role |
|------|------|
| `src/app/trip/[tripId]/curating/page.tsx` | Orchestrator — runs generation, manages phase state machine, renders cinematic or tour |
| `src/components/TripTour.tsx` | Slideshow — polls Supabase, builds slides, renders full-screen tour |
| `src/components/MapCinematic.tsx` | Map reveal — MapLibre GL, dark tiles, zoom animation |
| `src/components/TripLayout.tsx` | Workspace — three-panel layout (not part of tour) |
| `src/app/trip/[tripId]/page.tsx` | Workspace page — loads TripLayout |

---

## Next Steps (Priority Order)

1. **Fix card positioning** — Deterministic positions, opacity-only transitions, stable across rebuilds.
2. **Shorten hype headlines** — 5 words max, move voice into body text.
3. **Remove loading spinner phase** — Cinematic starts immediately on mount.
4. **Remove wrap-up slides** — Tour ends after the last day slide with "Explore my trip" button.
5. **Remove map pin drops** — Cinematic is map + zoom only, no pins.
6. **Revise map zoom** — Zoom in tighter on destination, not fitBounds to pins.
7. **Replace cinematic overlay** — "I'm curating your trip" with spinning animation.
8. **Background images** — Decide on image source, build fetch-during-generation pipeline, Supabase storage, crossfade display. Biggest new feature — needs its own design pass.
