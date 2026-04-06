-- FAMILY TRIP APP — DATABASE SCHEMA
-- Run this in Supabase SQL Editor

create extension if not exists "uuid-ossp";

create table public.trips (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  description text,
  start_date date,
  end_date date,
  cover_color text default '#1D9E75',
  invite_code text unique not null,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.trip_members (
  id uuid default uuid_generate_v4() primary key,
  trip_id uuid references public.trips(id) on delete cascade not null,
  display_name text not null,
  avatar_color text not null default '#888888',
  avatar_initial text not null default '?',
  role text not null default 'member' check (role in ('organizer', 'member')),
  is_online boolean default false,
  last_seen_at timestamptz default now(),
  session_token text unique,
  joined_at timestamptz default now()
);
create index idx_members_session on public.trip_members(session_token);
create index idx_members_trip on public.trip_members(trip_id);

create table public.days (
  id uuid default uuid_generate_v4() primary key,
  trip_id uuid references public.trips(id) on delete cascade not null,
  day_number integer not null,
  date date,
  title text,
  color text not null default '#1D9E75',
  created_at timestamptz default now(),
  unique(trip_id, day_number)
);
create index idx_days_trip on public.days(trip_id);

create table public.stops (
  id uuid default uuid_generate_v4() primary key,
  trip_id uuid references public.trips(id) on delete cascade not null,
  day_id uuid references public.days(id) on delete cascade not null,
  name text not null,
  description text,
  latitude double precision,
  longitude double precision,
  google_place_id text,
  photos jsonb default '[]'::jsonb,
  start_time time,
  duration_minutes integer default 60,
  sort_order integer not null default 0,
  cost_estimate decimal(10,2),
  cost_currency text default 'EUR',
  notes text,
  transit_note text,
  transit_minutes integer,
  tags jsonb default '[]'::jsonb,
  version_owner uuid references public.trip_members(id) on delete cascade,
  master_stop_id uuid references public.stops(id) on delete set null,
  created_by uuid references public.trip_members(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_stops_day on public.stops(day_id);
create index idx_stops_trip on public.stops(trip_id);
create index idx_stops_version on public.stops(version_owner);
create index idx_stops_sort on public.stops(day_id, sort_order);

create table public.votes (
  id uuid default uuid_generate_v4() primary key,
  stop_id uuid references public.stops(id) on delete cascade not null,
  member_id uuid references public.trip_members(id) on delete cascade not null,
  vote smallint not null check (vote in (1, -1)),
  created_at timestamptz default now(),
  unique(stop_id, member_id)
);
create index idx_votes_stop on public.votes(stop_id);

create table public.proposals (
  id uuid default uuid_generate_v4() primary key,
  trip_id uuid references public.trips(id) on delete cascade not null,
  proposed_by uuid references public.trip_members(id) on delete cascade not null,
  action text not null check (action in ('add_stop', 'remove_stop', 'move_stop', 'edit_stop')),
  stop_data jsonb not null,
  target_day_id uuid references public.days(id) on delete set null,
  target_sort_order integer,
  affected_stop_id uuid references public.stops(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  reviewed_by uuid references public.trip_members(id) on delete set null,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);
create index idx_proposals_trip on public.proposals(trip_id);
create index idx_proposals_status on public.proposals(status);

create table public.ai_conversations (
  id uuid default uuid_generate_v4() primary key,
  trip_id uuid references public.trips(id) on delete cascade not null,
  member_id uuid references public.trip_members(id) on delete cascade not null,
  messages jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_ai_conv_trip on public.ai_conversations(trip_id);

create table public.journal_entries (
  id uuid default uuid_generate_v4() primary key,
  trip_id uuid references public.trips(id) on delete cascade not null,
  stop_id uuid references public.stops(id) on delete set null,
  member_id uuid references public.trip_members(id) on delete cascade not null,
  entry_type text not null default 'text' check (entry_type in ('text', 'photo', 'voice')),
  content text,
  media_url text,
  captured_at timestamptz default now(),
  created_at timestamptz default now()
);
create index idx_journal_trip on public.journal_entries(trip_id);
create index idx_journal_stop on public.journal_entries(stop_id);

create or replace function public.update_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

create trigger trips_updated_at before update on public.trips for each row execute function public.update_updated_at();
create trigger stops_updated_at before update on public.stops for each row execute function public.update_updated_at();
create trigger ai_conv_updated_at before update on public.ai_conversations for each row execute function public.update_updated_at();

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.days enable row level security;
alter table public.stops enable row level security;
alter table public.votes enable row level security;
alter table public.proposals enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.journal_entries enable row level security;

create policy "Allow all on trips" on public.trips for all using (true) with check (true);
create policy "Allow all on trip_members" on public.trip_members for all using (true) with check (true);
create policy "Allow all on days" on public.days for all using (true) with check (true);
create policy "Allow all on stops" on public.stops for all using (true) with check (true);
create policy "Allow all on votes" on public.votes for all using (true) with check (true);
create policy "Allow all on proposals" on public.proposals for all using (true) with check (true);
create policy "Allow all on ai_conversations" on public.ai_conversations for all using (true) with check (true);
create policy "Allow all on journal_entries" on public.journal_entries for all using (true) with check (true);
