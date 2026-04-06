# ===========================================
# DEPLOYMENT GUIDE — FOR CLAUDE CODE IN CODESPACE
# ===========================================
# 
# Hand this entire file to Claude Code along with the project zip.
# Tell Claude Code: "Follow the instructions in DEPLOY.md to set up
# and push this project to my GitHub repo."
#
# Prerequisites already done:
#   - GitHub repo: https://github.com/Chooch333/Family-Trip-App.git
#   - Supabase project: https://ksewwcnshxatsprgwmev.supabase.co
#   - Vercel account linked to GitHub
#

## Step 1: Extract and initialize

1. Unzip `family-trip-app.zip` into the current directory
2. Run `npm install`
3. Make sure `.env.local` is present with the Supabase credentials
4. Make sure `.env.local` is listed in `.gitignore` (it already is)

## Step 2: Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit: Next.js app with PWA, Supabase schema, Concept C dashboard"
git branch -M main
git remote add origin https://github.com/Chooch333/Family-Trip-App.git
git push -u origin main
```

## Step 3: Vercel will auto-deploy

Once the code is on GitHub, Vercel should detect it if the repo is 
already imported. If not, Charles needs to:
1. Go to vercel.com → "Add New Project" → Import the Family-Trip-App repo
2. Framework preset: Next.js (should auto-detect)
3. Add these environment variables in Vercel project settings:
   - NEXT_PUBLIC_SUPABASE_URL = https://ksewwcnshxatsprgwmev.supabase.co
   - NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzZXd3Y25zaHhhdHNwcmd3bWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NzYyMjksImV4cCI6MjA5MTA1MjIyOX0.z7XGKYTsoUJRgWY5NdXDV727ohVrmGs2L1pCft8Conk
4. Deploy

## Step 4: Run the database schema

Charles does this manually in the Supabase dashboard:
1. Go to supabase.com → Family Trip App project → SQL Editor
2. Click "New Query"
3. Paste the ENTIRE contents of supabase/schema.sql
4. Click "Run"
5. Should see "Success. No rows returned." — that means all tables were created.

## Step 5: Verify

1. Visit the Vercel deployment URL
2. You should see the landing page with "Family Trip Planner" and a "Create a new trip" button
3. Create a trip, confirm it redirects to the dashboard
4. Check Supabase Table Editor to see the trip row was created

## Troubleshooting

- If `npm run build` fails, check for TypeScript errors and fix them
- If the app loads but can't create trips, the Supabase schema hasn't been run yet
- If you see "Failed to create trip", check that the environment variables are set in Vercel
- The .env.local file is for local dev only — Vercel needs its own env vars set in the dashboard
