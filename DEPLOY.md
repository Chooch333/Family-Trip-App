# Deployment Guide

## Push to GitHub
```bash
git add .
git commit -m "Initial commit: trip planner app"
git branch -M main
git remote add origin https://github.com/Chooch333/Family-Trip-App.git
git push -u origin main
```

## Vercel Environment Variables
Add in Vercel project settings:
- `NEXT_PUBLIC_SUPABASE_URL` = `https://ksewwcnshxatsprgwmev.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (the eyJ... key)

## Database
Run `supabase/schema.sql` in Supabase SQL Editor.
