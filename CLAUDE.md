# Family Trip App — Design Rules

These rules apply to ALL future changes. Do not override without explicit instruction from Charles.

## Color System
- Day colors follow a green → blue → purple gradient encoding early/mid/late trip
- Generate colors dynamically based on number of days
- Day color carries through: tabs, map pins, stop card accent bars, route lines, day narrative background
- Unselected day tabs at 50% opacity. Selected tab full brightness with slight vertical lift
- Tabs should NEVER appear black or gray

## Map Behavior
- All days' pins always visible. Selected day pins at radius 14, full opacity. Other days at radius 10, 60% opacity
- Selecting a day auto-zooms map to fit that day's stops (excluding transit stops)
- Selected pin stays enlarged until another is clicked
- Dashed route polyline connects stops in order for the selected day
- Transit stops (stop_type = 'transit') do NOT get map pins and are excluded from fitBounds
- Multi-city days get split map panels when stop clusters are >30km apart

## Stop Cards
- Default collapsed view shows: name, start time, duration, and first 2-3 lines of description
- NEVER show latitude/longitude on cards
- Expanded view adds: full description, photos with lightbox, cost, voting
- Transit stops render as styled text rows between cards, not as cards themselves

## Content Generation (AI)
- Every day gets a 2-3 sentence narrative blurb setting the tone
- Every stop gets a description that explains WHY it's worth visiting for THIS family
- Descriptions reference family composition and feel like a friend's recommendation
- Transit entries saved with stop_type = 'transit'

## Layout
- Concept C split dashboard on desktop. Stacked cards with bottom tabs on mobile
- Day tabs never overlap content below
- No success banners or dismissible notifications for obvious state changes

## Persistence
- Chat history saves to ai_conversations table
- All trips visible on home page regardless of session state
- Users can rejoin trips by picking their name
