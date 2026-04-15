# Co-Pilot Trip Dashboard — Build Tracker
### Last updated: April 15, 2026

---

## COMPLETED

- [x] **Competitive study** — Deep analysis of 6 travel planning apps (see resources below)
- [x] **Product critique** — Codebase review and gap analysis against 3 targets
- [x] **MCP fix: SHA passthrough** — get_file_contents now returns blob SHA
- [x] **MCP fix: replace_in_file** — New tool for surgical edits to large files

---

## TARGET 1 — Claude's Voice & Personality ✅ COMPLETE
*The real differentiator. Claude as a travel agent with taste, not an assistant returning data.*

- [x] **1.1 — Rewrite core system prompt as personality document**
- [x] **1.2 — Kill generic prompt chips, replace with contextual opinionated ones**
- [x] **1.3 — Split system prompt into two layers (personality + operational)**
- [x] **1.4 — Redesign the curating prompt to generate voice, not just data**
- [x] **1.5 — Make tool call responses feel like a person, not a system**
- [x] **1.6 — Add voice calibration examples (4 GOOD/BAD pairs)**
- [x] **1.7 — Update ITINERARY_SYSTEM_PROMPT in page.tsx (chat-based generation)**

---

## TARGET 2 — Layout, Tour & Anchoring
*Originally "Vibe → Day-View → Map as One Flow." Reframed after product decisions.*

### Design decisions that shaped this target:
- Vibe sessions and collab states (2.2-2.4 original) dissolved as formal concepts
- Product principle: "opinionated first draft → react and refine" — Claude brings a strong take, the family reacts
- The 3-column layout was correct — the fix was interaction wiring, not spatial repositioning
- Anchoring replaced vibe_status as the concrete user-facing mechanism

### Done:
- [x] **2.1 — Dynamic resize overlapping card layout**
  - Three cards overlap by ~18px at edges, click to focus
  - Independent expansion: both side panels can expand simultaneously over chat
  - Chat starts focused (z:3), click any card to bring it forward
  - Smooth cubic-bezier transitions on all properties
  - File: src/components/TripLayout.tsx

- [x] **2.2 — Trip tour slideshow (story mode)**
  - 8-10 slide minimum regardless of trip length
  - Mixed slide types: opening pitch, city arrival, anchor spotlight, day overview, food narrative, gear shift, hidden gem, closer
  - Template engine derives slides from curation data (no separate generation)
  - Floating day card moves to content-aware positions per slide
  - Arrow navigation + keyboard (arrows, escape)
  - Gradient placeholders for future destination photos
  - File: src/components/TripTour.tsx

- [x] **2.3 — Tour wired into workspace**
  - Renders as fixed overlay (z:9999) on top of workspace
  - Workspace loads behind tour — instant transition on "Start planning"
  - SessionStorage gate: tour shows once per trip per session
  - "Dive in" skips to workspace, "Tour the trip" enters slideshow
  - File: src/app/trip/[tripId]/page.tsx

### Remaining:
- [x] **2.4 — Anchoring: teach Claude about anchored stops**
  - Updated claude.ts OPERATIONAL_RULES with anchoring behavior
  - Claude never touches anchored stops when trimming
  - Claude acknowledges anchors and proactively suggests anchoring
  - Itinerary state now shows ⚓ ANCHORED marker for anchored stops

- [x] **2.5 — Anchoring: Claude sets anchors during initial curation**
  - Added is_anchor to JSON schema and StopData interface in curating prompt
  - Claude instructed to anchor 1-3 stops per day it's most confident about
  - is_anchor saved to Supabase during curation insert

### Future optimizations (not blocking):
- [ ] Map cinematic animation during loading (pins drop as coordinates arrive)
- [ ] 75% completion threshold gate for progressive tour reveal
- [ ] Destination photography integration for tour slide backgrounds
- [ ] Curation → map cinematic → tour seamless flow

---

## TARGET 3 — Day-View as the Cleanest Screen
*Visual hierarchy discipline. Every element earns its pixels.*

- [ ] **3.1 — Break the 64KB page.tsx into components**
  - Extract: StopsPanel, ChatPanel, MapPanel, TripSplash, Lightbox, AccommodationCard, AddStopForm
  - Prerequisite for iterating on visual hierarchy

- [ ] **3.2 — Fix visual hierarchy in stops panel**
  - Day narrative vs stop name sizing, accommodation card rhythm, add-stop form placement
  - Three things at a glance: what, when, where — everything else one tap deeper

- [ ] **3.3 — Polish stop card design**
  - Wire up getStopBadge helper for type badges
  - Refine SortableStopRow details

- [ ] **3.4 — Map panel polish**
  - Accommodation pin differentiation, selected stop interaction refinement

---

## BACKLOG (from competitive study)

- [ ] Real-time collaborative voting/polling for group decisions
- [ ] Day-of re-planning based on weather/conditions
- [ ] Cross-trip learning (personal travel intelligence)
- [ ] Multi-currency budget tracking
- [ ] Offline maps with full itinerary
- [ ] Booking confirmation parsing beyond Gmail
- [ ] Physical Travel Book product (future revenue)

---

## RESOURCES

### Competitive study apps
| App | URL | Key takeaway |
|-----|-----|-------------|
| Wanderlog | https://wanderlog.com | UX benchmark — map+itinerary co-view, best polish |
| Polarsteps | https://polarsteps.com | Post-trip storytelling, Physical Travel Book product |
| Stippl | https://stippl.io | Day-by-day organization, clean visual hierarchy |
| Roadtrippers | https://roadtrippers.com | Route-based planning, driving focus |
| Mindtrip.ai | https://mindtrip.ai | AI-native chat interface, closest to Co-Pilot concept |
| TripNoted | https://tripnoted.com | Collaborative planning, group voting |

### Positioning
Co-Pilot's gap: nobody owns family-specific, vibe-first planning with an AI that has personality. "Take the day organization of Stippl, combine it with the AI interface of Mindtrip, give it the polish of Wanderlog, with collab/vibe as the backbone." The atomic unit is a feeling, and places are the output filtered through Claude's taste.

### Key files
| File | Purpose |
|------|---------|
| src/lib/claude.ts | Co-Pilot personality, system prompt, tools, prompt chips |
| src/app/trip/[tripId]/curating/page.tsx | Curation prompt, loading screen |
| src/app/trip/[tripId]/page.tsx | Main workspace (64KB monolith — Target 3.1) |
| src/components/TripLayout.tsx | Overlapping card layout |
| src/components/TripTour.tsx | Story-mode slideshow |
| src/components/DayBar.tsx | Day pill navigation |
| src/components/AnchorIcon.tsx | Anchor toggle icon |
