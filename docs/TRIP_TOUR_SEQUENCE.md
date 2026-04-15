# Trip Tour — Sequencing & Coordination Spec

## What This Doc Is

The Trip Tour is a cinematic presentation experience that plays when a user creates a new trip. It has three acts: a map reveal, personality-driven hype slides, and a growing day-by-day walkthrough. This doc maps every visual beat, the data each beat depends on, and the state coordination that connects them.

---

## The Full User Journey (What They See)

### ACT 1 — The Map (cinematic phase)

| Beat | Visual | Duration | Trigger |
|------|--------|----------|---------|
| 1.1 | Black screen, loading spinner, "Building your trip" | ~2s | Page mount |
| 1.2 | Dark map fades in, centered on destination | ~1.5s | Map `idle` event fires |
| 1.3 | Pins drop onto map (staggered CSS animation) | ~2s | First Supabase stops with coordinates land |
| 1.4 | Map zooms to fit all pins | ~3.5s | `fitBounds` with easing |
| 1.5 | Static map holds with progress overlay | Ongoing | Waiting for `firstChunkDone` |

**Data needed for Act 1:**
- `trip.destination` (geocoding for initial center) — available immediately
- Stop coordinates from Supabase (for pins) — arrive as chunks land
- `generatedDays` count (for progress bar) — updates per saved day

**Progress overlay during Act 1:**
- Top center: "Claude is building your trip" + "Day X of Y" + progress bar
- Bottom right: Staggered status messages (personality-driven)

**Exit condition:** `firstChunkDone === true` (generatedDays ≥ 2) AND at least 6 seconds elapsed since cinematic start.

---

### ACT 2 — The Hype Slides (tour phase, immediate)

These render entirely from `trip` metadata. No Supabase polling needed. They exist to give the user something engaging while remaining chunks generate.

| Slide | Key | Layout | Label | Headline | Body Source |
|-------|-----|--------|-------|----------|-------------|
| 2.1 | `hype-destination` | center | THE DESTINATION | `trip.destination` | `buildDestinationHype(trip)` |
| 2.2 | `hype-food` | center | THE FOOD PHILOSOPHY | "Here's how I'm thinking about food." | `buildFoodHype(trip)` |
| 2.3 | `hype-gems` | center | HIDDEN GEMS | "I'm going to show you things most people walk right past." | `buildGemsHype(trip)` |

**Data needed:** `trip.destination`, `trip.group_type`, `trip.group_detail`, `trip.interests`, `trip.travel_dates`, `trip.extra_notes`

**Design:** Full-screen text over gradient background. No buttons — arrow navigation only. Each slide has a unique gradient and accent color.

**Gradients:**
- Destination: deep teal (`#1a3a4a → #0a2a3a → #2a4a5a`)
- Food: warm copper (`#3a1a0a → #6a3a1a → #4a2a10`)
- Gems: deep purple (`#2a1a3a → #3a2a4a → #1a1a2a`)

**User behavior during Act 2:** Clicking/tapping right arrow or pressing → / spacebar to advance. By the time they finish 3 hype slides (maybe 15-30 seconds of reading), the first chunk's day slides should be ready.

---

### ACT 3 — The Day Slides (tour phase, growing)

These grow as Supabase chunks land. TripTour polls every 4 seconds.

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

**ISSUE — Card Position:** Currently uses `pickPosition()` which randomly selects from 5 positions and applies CSS `transition` on top/left/right/bottom. When slides change, the card visually slides across the screen to its new position. This needs to be fixed.

**FIX NEEDED:** Cards should fade in at their position, not slide from the previous card's position. Either:
- Remove the position transition (use opacity only)
- OR assign a fixed position for all card slides (e.g., always top-left)
- OR fade out old card → fade in new card at new position (no sliding)

#### 3C. Day Overview Slides

| Slide | Key | Layout | When |
|-------|-----|--------|------|
| Day overview | `day-{dayId}` | card | One per day with stops |

**Contents:** Day number label, day title, narrative + reasoning body, stop list (max 5, anchors prioritized).

**Card position:** Same issue as anchor spotlight — random position with sliding transition.

**Stop list items show:** name, type · duration, time, anchor icon if applicable. Accent bar uses day color.

#### Growing behavior:
- When TripTour first mounts, it polls Supabase and gets whatever days/stops exist
- Every 4s it re-polls and rebuilds slides
- New day slides appear at the END of the day section (after existing ones)
- Slide counter shows "3/7+" when more data is expected
- At the last slide, if `!generationComplete`, show a loading spinner instead of the right arrow

---

### ACT 4 — The Wrap-Up Slides (only when `generationComplete`)

These only appear once all chunks have been generated and `generationComplete` prop is true.

| Slide | Key | Layout | Label | When |
|-------|-----|--------|-------|------|
| Food narrative | `food` | center | "How I'm feeding you" | ≥ 3 food stops exist |
| Hidden gem spotlight | `gem` | center | "The one you'd miss" | A non-anchor stop with a long ai_note exists |
| Closer / Pitch | `closer` | center | "Claude built you a trip" | Always |

**Closer details:**
- Headline: `trip.name`
- Body: `trip.trip_summary` (generated after all chunks, fetched on generationComplete)
- Buttons: "Start planning" (→ workspace) and "Dive in" (→ workspace)
- This is the final slide in the entire tour

---

## Complete Slide Sequence (Summary)

```
[Hype: Destination] → [Hype: Food] → [Hype: Gems]
  → [City Arrival]* → [Anchor Spotlight]* → [Day 1] → [Day 2] → ...
  → [City Arrival]* → [Anchor Spotlight]* → [Day N] → [Day N+1] → ...
  → [Food Narrative]** → [Hidden Gem]** → [Closer]**

*  = conditional (multi-city only for arrivals, best anchor per city)
** = only when generationComplete
```

---

## State Machine — Phase Transitions

```
LOADING ──(2s timeout)──→ CINEMATIC ──(firstChunkDone + 6s min)──→ TOUR ──(onComplete)──→ WORKSPACE
                              │                                                              ↑
                              └──(generationDone + stuck in cinematic)────────────────────────┘
```

### States

| State | Component | What's Visible |
|-------|-----------|----------------|
| `loading` | CuratingPage | Black screen, spinner, "Building your trip" |
| `cinematic` | CuratingPage + MapCinematic | Dark map with pins, progress overlay |
| `tour` | TripTour | Full-screen slideshow |
| `workspace` | TripPage | Three-panel layout (stops, chat, map) |

### Transition: loading → cinematic
- **Trigger:** 2-second setTimeout after mount
- **Guard:** `phaseRef.current === "loading"`
- **Action:** Set `cinematicStartRef` to `Date.now()`, set phase to "cinematic"

### Transition: cinematic → tour
- **Trigger:** `firstChunkDone` becomes true (one-shot boolean, fires when `generatedDays` first ≥ 2)
- **Guard:** `phase === "cinematic"` AND `!tourLaunched.current`
- **Timing:** `Math.max(0, 6000 - elapsed)` — waits for minimum 6s cinematic display
- **Action:** Set `tourLaunched.current = true`, set phase to "tour"
- **KEY DESIGN:** `firstChunkDone` only transitions `false → true` once. The effect depends on `[phase, firstChunkDone]`. Timer is set exactly once and never canceled by subsequent `generatedDays` increments.

### Transition: tour → workspace
- **Trigger:** User clicks "Start planning" or "Dive in" on closer slide, OR presses Escape
- **Action:** `sessionStorage.setItem(tour_seen_{tripId})`, `router.push(/trip/{tripId})`

### Safety net: cinematic → workspace (edge case)
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
  │     │     └── setGeneratedDays(++saved) ← triggers firstChunkDone when ≥ 2
  │     └── Retry once on failure
  ├── Generate trip summary (separate API call)
  │     └── UPDATE trip.trip_summary
  └── setGenerationDone(true)
```

### What TripTour reads (Supabase polling)

```
Every 4 seconds (while !generationComplete):
  ├── SELECT * FROM days WHERE trip_id = X ORDER BY day_number
  ├── SELECT * FROM stops WHERE trip_id = X AND version_owner IS NULL ORDER BY sort_order
  └── Rebuild slides from days + stops + trip metadata

On generationComplete:
  ├── One final fetch of days + stops
  ├── Fetch updated trip (for trip_summary)
  └── Add wrap-up slides (food narrative, hidden gem, closer)
```

---

## Known Issues & Required Fixes

### 1. Card slides visually slide across screen (HIGH PRIORITY)

**Problem:** Card-layout slides (anchor spotlights, day overviews) use `pickPosition()` to randomly assign a screen position (topLeft, topRight, bottomRight, etc.). The card element has CSS `transition` on `top`, `left`, `right`, `bottom`. When navigating between two card slides with different positions, the card visually slides from position A to position B.

**Impact:** Looks broken — cards flying across the screen between slides.

**Fix options:**
- **Option A (recommended):** Remove position transitions entirely. Only transition `opacity`. Card appears at its position instantly via fade.
- **Option B:** Use a single fixed position for all card slides (e.g., always top-left with slight offset variation).
- **Option C:** Unmount the old card, mount the new one — no shared DOM element to transition.

### 2. Card position randomness is per-render, not stable

**Problem:** `pickPosition()` runs on every render. If the slide array rebuilds (new chunk arrives), positions can change for existing slides.

**Fix:** Compute positions once when a slide is first created and store them in the slide data. Or use a deterministic position based on day index.

### 3. Slide counter flickers during rebuilds

**Problem:** When new days arrive, the slide array rebuilds. The counter "5/7+" might briefly show "5/9+" as new slides are inserted.

**Fix:** Minor — not blocking. Could smooth with a transition or debounce.

### 4. "Co-Pilot" terminology in cinematic overlay

**Problem:** The progress overlay says "Your Co-Pilot is building your trip" — should say "Claude."

**Fix:** Text change in curating/page.tsx.

---

## File Map

| File | Role |
|------|------|
| `src/app/trip/[tripId]/curating/page.tsx` | Orchestrator — runs generation, manages phase state machine, renders cinematic or tour |
| `src/components/TripTour.tsx` | Slideshow — polls Supabase, builds slides, renders full-screen tour |
| `src/components/MapCinematic.tsx` | Map reveal — MapLibre GL, dark tiles, pin drops, zoom animation |
| `src/components/TripLayout.tsx` | Workspace — three-panel layout (not part of tour) |
| `src/app/trip/[tripId]/page.tsx` | Workspace page — loads TripLayout |

---

## Next Steps

1. **Fix card sliding** — Remove position transitions from the floating card element. Fade only.
2. **Stabilize card positions** — Deterministic based on day index, not random per-render.
3. **Test the full sequence end-to-end** with a fresh trip.
4. **Replace "Co-Pilot" with "Claude"** in the cinematic overlay text.
5. **Consider:** Should the cinematic progress overlay stay visible during the tour? Currently it disappears when phase changes to "tour." The hype slides could benefit from a subtle "still building..." indicator.
