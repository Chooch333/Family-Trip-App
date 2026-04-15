# Co-Pilot Trip Dashboard — Build Tracker
### Last updated: April 15, 2026

---

## COMPLETED

- [x] **Competitive study** — Deep analysis of 6 travel planning apps
- [x] **Product critique** — Codebase review and gap analysis against 3 targets
- [x] **MCP server upgrades** — SHA passthrough, replace_in_file tool
- [x] **TARGET 1 — Claude's Voice & Personality** — Core system prompt rewrite, personality doc, voice calibration, contextual prompt chips, curating prompt redesign
- [x] **TARGET 2 — Layout, Tour & Anchoring** — Overlapping card layout with independent expansion, trip tour slideshow (template engine, 8+ slide types, floating day cards), anchoring system (Claude sets/respects anchors), MapLibre cinematic loading, Supabase polling for progressive slide reveal, 2-day chunked generation

### Recently shipped (this session):
- [x] MapLibre GL JS vector map cinematic (replaced broken Leaflet raster approach)
- [x] 2-day chunk generation (down from 3) for faster first content
- [x] TripTour polls Supabase and grows slides as chunks land
- [x] Tour launches after first chunk — generation continues behind slideshow
- [x] Wrap-up slides (food, gem, closer) gated on generationComplete
- [x] Target 3.1 partial — extracted tripHelpers.ts, SortableStopRow.tsx, Lightbox.tsx from page.tsx monolith

---

## IN PROGRESS

### Hype slides (next build)
Three personality-driven slides that play before day-by-day content. Built from trip metadata (not curation data), so they render immediately. Claude explains its vision before revealing the itinerary.
- [ ] **Destination showcase** — Claude paints the destination for this specific family
- [ ] **Food philosophy** — How Claude is thinking about the eating experience
- [ ] **Hidden gems preview** — Sets expectation this isn't a generic top-10 trip
- See: `/mnt/user-data/outputs/handoff-hype-slides.md` for full build spec

### "Co-Pilot" terminology removal
- [ ] Remove "Co-Pilot" from all user-facing text across the project
- [ ] Replace with "Claude" or first-person voice

---

## TARGET 3 — Day-View as the Cleanest Screen
*Visual hierarchy discipline. Every element earns its pixels.*

- [x] **3.1 — Break page.tsx into components** (partial)
  - Done: tripHelpers.ts, SortableStopRow.tsx, Lightbox.tsx extracted
  - Remaining: renderLeftPanel, renderChat, renderRightPanel still inline (close over ~30 state variables each — need prop interfaces to extract)

- [ ] **3.2 — Fix visual hierarchy in stops panel**
  - Day narrative (17px) vs stop name (18px) are competing — need clear hierarchy
  - Accommodation card breaks stop list rhythm
  - Add-stop form should be modal/slide-over, not wedged into the list
  - Principle: three things at a glance (what, when, where), everything else one tap deeper

- [ ] **3.3 — Polish stop card design**
  - Wire up getStopBadge helper for type badges (Food, Walking, Visit, Shopping)
  - Refine SortableStopRow spacing, typography, anchor icon placement

- [ ] **3.4 — Map panel polish**
  - Accommodation pin visual differentiation
  - Selected stop interaction refinement
  - Consider migrating workspace map from Leaflet to MapLibre (consistency with cinematic)

---

## BACKLOG

### From competitive study
- [ ] Real-time collaborative voting/polling for group decisions
- [ ] Day-of re-planning based on weather/conditions
- [ ] Cross-trip learning (personal travel intelligence)
- [ ] Multi-currency budget tracking
- [ ] Offline maps with full itinerary
- [ ] Booking confirmation parsing beyond Gmail
- [ ] Physical Travel Book product (Polarsteps-inspired, future revenue)

### From this session
- [ ] Destination photography integration for tour slide backgrounds
- [ ] Workspace map migration from Leaflet to MapLibre GL
- [ ] Tour slideshow mobile/swipe support
- [ ] Auto-advance timing for slideshow (optional)

---

## RESOURCES

### Competitive study apps
| App | URL | Key takeaway |
|-----|-----|-------------|
| Wanderlog | https://wanderlog.com | UX benchmark — map+itinerary co-view, best polish in the space |
| Polarsteps | https://polarsteps.com | Post-trip storytelling, Physical Travel Book product, trip tracking |
| Stippl | https://stippl.io | Day-by-day organization, cleanest visual hierarchy of the group |
| Roadtrippers | https://roadtrippers.com | Route-based planning, driving focus, along-the-way discovery |
| Mindtrip.ai | https://mindtrip.ai | AI-native chat interface, closest competitor to our concept, MapLibre maps |
| TripNoted | https://tripnoted.com | Collaborative planning, group voting, shared itineraries |

### Product positioning
Nobody owns family-specific, vibe-first planning with an AI that has personality. The gap: "Take the day organization of Stippl, combine it with the AI interface of Mindtrip, give it the polish of Wanderlog." The atomic unit is a feeling, and places are the output filtered through Claude's taste.

### Key files
| File | Purpose |
|------|---------|
| src/lib/claude.ts | Personality, system prompt, operational rules, tools, prompt chips |
| src/lib/tripHelpers.ts | Shared helpers (generateDayColors, getStopBadge, formatTime12) |
| src/app/trip/[tripId]/curating/page.tsx | Curation prompt, chunked generation, cinematic flow |
| src/app/trip/[tripId]/page.tsx | Main workspace (~55KB after extractions — Target 3.1) |
| src/components/TripLayout.tsx | Overlapping card layout with independent expansion |
| src/components/TripTour.tsx | Story-mode slideshow — polls Supabase, grows slides |
| src/components/MapCinematic.tsx | MapLibre GL cinematic map during curation |
| src/components/SortableStopRow.tsx | Drag-and-drop stop row with anchor toggle |
| src/components/Lightbox.tsx | Photo lightbox with keyboard nav |
| src/components/DayBar.tsx | Day pill navigation |
| src/components/AnchorIcon.tsx | Anchor toggle icon |
