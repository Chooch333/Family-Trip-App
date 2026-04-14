# Co-Pilot Trip Dashboard — Build Tracker
### Last updated: April 14, 2026

---

## COMPLETED

- [x] **Competitive study** — Deep analysis of Wanderlog, Polarsteps, Stippl, Roadtrippers, Mindtrip, TripNoted
- [x] **Product critique** — Codebase review and gap analysis against 3 targets
- [x] **MCP fix: SHA passthrough** — get_file_contents now returns blob SHA
- [x] **MCP fix: replace_in_file** — New tool for surgical edits to large files
- [x] **Cleanup** — Delete src/lib/CLAUDE_REWRITE_INSTRUCTIONS.md

---

## TARGET 1 — Claude's Voice & Personality ✅ COMPLETE
*The real differentiator. Claude as a travel agent with taste, not an assistant returning data.*

- [x] **1.1 — Rewrite core system prompt as personality document**
  - CO_PILOT_PERSONALITY constant — character brief covering voice, relationship, situation handling
  - Anchors every response regardless of trip, day, or tool call

- [x] **1.2 — Kill generic prompt chips, replace with contextual opinionated ones**
  - getPromptChips now accepts activeDay and activeDayStops
  - Chips reference day title, stop count, accommodation, interests, group type

- [x] **1.3 — Split system prompt into two layers**
  - Layer 1: CO_PILOT_PERSONALITY (constant identity)
  - Layer 2: OPERATIONAL_RULES (tool use, edge cases)
  - buildSystemPrompt assembles 5 priority layers

- [x] **1.4 — Redesign the curating prompt to generate voice, not just data**
  - Rewrote curating/page.tsx system prompt with Co-Pilot personality
  - Added FIELD VOICE GUIDE for trip_summary, narrative, reasoning, description, ai_note
  - Loading screen copy now personality-aligned ("Walking the streets of X in my head")

- [x] **1.5 — Make tool call responses feel like a person, not a system**
  - Covered by OPERATIONAL_RULES in personality doc: "your text response should feel like a person explaining what they just did"
  - executeToolCall return strings are internal only — Claude's text response is what users see
  - Status: test and observe — if voice regresses around tool calls, add reinforcement

- [x] **1.6 — Add voice calibration examples**
  - Added 4 concrete GOOD/BAD example pairs to CO_PILOT_PERSONALITY
  - Covers: restaurant recs, trimming a packed day, rain contingency, post-dinner suggestions
  - Prevents regression to generic assistant register

### Remaining note:
- [ ] **1.7 — Update ITINERARY_SYSTEM_PROMPT in page.tsx (chat-based generation)**
  - The prompt in page.tsx used when someone types a trip directly in chat (bypassing intake flow) still has the old generic voice
  - Lower priority since most users go through intake → curating flow
  - Use replace_in_file in a new chat session to update

---

## TARGET 2 — Vibe → Day-View → Map as One Flow
*Chat drives everything. Vibe planning is the core, not a loading screen.*

- [ ] **2.1 — Restructure TripLayout from 3-column peer to chat-as-command-bar**
  - Current: stops | chat | map as equal columns
  - Goal: stops + map on top, chat bar anchored at bottom
  - Biggest architectural change in the app

- [ ] **2.2 — Build interactive vibe planning environment**
  - Current curating page is a one-shot loading screen
  - Goal: interactive vibe conversation before itinerary materializes
  - Schema supports it: days.vibe_status, days.reasoning, days.narrative

- [ ] **2.3 — Wire vibe → logistics pipeline as continuous flow**
  - Vibe decisions cascade into day-view into map as one motion

- [ ] **2.4 — Day narrative should be interactive, not static**
  - Currently static text in stops panel header
  - Should be editable, Claude-refinable, connected to vibe status

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
