# Family Trip Planner

Collaborative family trip planning PWA — Next.js, Supabase, Leaflet.js, Claude AI.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in Supabase credentials
3. Run `supabase/schema.sql` in Supabase SQL Editor
4. `npm run dev` for local, or push to GitHub for Vercel auto-deploy

## Stack
- **Frontend:** Next.js 14 + Tailwind CSS
- **Database:** Supabase (PostgreSQL)
- **Maps:** Leaflet.js + OpenStreetMap
- **AI:** Claude via Anthropic API
- **Hosting:** Vercel (free tier)
- **Auth:** Invite-link (no passwords)
