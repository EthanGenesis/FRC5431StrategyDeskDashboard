create extension if not exists pgcrypto;

create or replace function public.tbsb_is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.tbsb_admin_users
    where user_id = auth.uid()
  );
$$;

create table if not exists public.tbsb_admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tbsb_workspace_settings (
  workspace_key text primary key default 'shared',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.tbsb_compare_drafts (
  id text primary key,
  workspace_key text not null default 'shared',
  scope text not null check (scope in ('current', 'historical')),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.tbsb_compare_sets (
  id text primary key,
  workspace_key text not null default 'shared',
  label text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.tbsb_predict_scenarios (
  id text primary key,
  workspace_key text not null default 'shared',
  label text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.tbsb_alliance_scenarios (
  id text primary key,
  workspace_key text not null default 'shared',
  label text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.tbsb_pick_lists (
  id text primary key,
  workspace_key text not null default 'shared',
  label text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.tbsb_playoff_results (
  id text primary key,
  workspace_key text not null default 'shared',
  label text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.tbsb_strategy_records (
  id text primary key,
  workspace_key text not null default 'shared',
  event_key text not null,
  match_key text not null,
  match_label text not null,
  event_name text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.tbsb_snapshot_cache (
  cache_key text primary key,
  source text not null,
  event_key text,
  team_number integer,
  generated_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tbsb_upstream_cache (
  cache_key text primary key,
  source text not null,
  request_path text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists tbsb_compare_drafts_workspace_scope_idx
  on public.tbsb_compare_drafts (workspace_key, scope);

create index if not exists tbsb_compare_sets_workspace_idx
  on public.tbsb_compare_sets (workspace_key, updated_at desc);

create index if not exists tbsb_predict_scenarios_workspace_idx
  on public.tbsb_predict_scenarios (workspace_key, updated_at desc);

create index if not exists tbsb_alliance_scenarios_workspace_idx
  on public.tbsb_alliance_scenarios (workspace_key, updated_at desc);

create index if not exists tbsb_pick_lists_workspace_idx
  on public.tbsb_pick_lists (workspace_key, updated_at desc);

create index if not exists tbsb_playoff_results_workspace_idx
  on public.tbsb_playoff_results (workspace_key, updated_at desc);

create index if not exists tbsb_strategy_records_workspace_event_idx
  on public.tbsb_strategy_records (workspace_key, event_key, updated_at desc);

create index if not exists tbsb_snapshot_cache_source_event_team_idx
  on public.tbsb_snapshot_cache (source, event_key, team_number, updated_at desc);

create index if not exists tbsb_upstream_cache_source_path_idx
  on public.tbsb_upstream_cache (source, request_path, updated_at desc);

alter table public.tbsb_admin_users enable row level security;
alter table public.tbsb_workspace_settings enable row level security;
alter table public.tbsb_compare_drafts enable row level security;
alter table public.tbsb_compare_sets enable row level security;
alter table public.tbsb_predict_scenarios enable row level security;
alter table public.tbsb_alliance_scenarios enable row level security;
alter table public.tbsb_pick_lists enable row level security;
alter table public.tbsb_playoff_results enable row level security;
alter table public.tbsb_strategy_records enable row level security;
alter table public.tbsb_snapshot_cache enable row level security;
alter table public.tbsb_upstream_cache enable row level security;

drop policy if exists "admin users can read admin table" on public.tbsb_admin_users;
create policy "admin users can read admin table"
  on public.tbsb_admin_users
  for select
  to authenticated
  using (public.tbsb_is_admin());

drop policy if exists "admin users manage admin table" on public.tbsb_admin_users;
create policy "admin users manage admin table"
  on public.tbsb_admin_users
  for all
  to authenticated
  using (public.tbsb_is_admin())
  with check (public.tbsb_is_admin());

drop policy if exists "public read workspace settings" on public.tbsb_workspace_settings;
create policy "public read workspace settings"
  on public.tbsb_workspace_settings
  for select
  to anon, authenticated
  using (workspace_key = 'shared');

drop policy if exists "admin write workspace settings" on public.tbsb_workspace_settings;
create policy "admin write workspace settings"
  on public.tbsb_workspace_settings
  for all
  to authenticated
  using (public.tbsb_is_admin())
  with check (public.tbsb_is_admin());

drop policy if exists "public read compare drafts" on public.tbsb_compare_drafts;
create policy "public read compare drafts"
  on public.tbsb_compare_drafts
  for select
  to anon, authenticated
  using (workspace_key = 'shared');

drop policy if exists "admin write compare drafts" on public.tbsb_compare_drafts;
create policy "admin write compare drafts"
  on public.tbsb_compare_drafts
  for all
  to authenticated
  using (public.tbsb_is_admin())
  with check (public.tbsb_is_admin());

drop policy if exists "public read compare sets" on public.tbsb_compare_sets;
create policy "public read compare sets"
  on public.tbsb_compare_sets
  for select
  to anon, authenticated
  using (workspace_key = 'shared');

drop policy if exists "admin write compare sets" on public.tbsb_compare_sets;
create policy "admin write compare sets"
  on public.tbsb_compare_sets
  for all
  to authenticated
  using (public.tbsb_is_admin())
  with check (public.tbsb_is_admin());

drop policy if exists "public read predict scenarios" on public.tbsb_predict_scenarios;
create policy "public read predict scenarios"
  on public.tbsb_predict_scenarios
  for select
  to anon, authenticated
  using (workspace_key = 'shared');

drop policy if exists "admin write predict scenarios" on public.tbsb_predict_scenarios;
create policy "admin write predict scenarios"
  on public.tbsb_predict_scenarios
  for all
  to authenticated
  using (public.tbsb_is_admin())
  with check (public.tbsb_is_admin());

drop policy if exists "public read alliance scenarios" on public.tbsb_alliance_scenarios;
create policy "public read alliance scenarios"
  on public.tbsb_alliance_scenarios
  for select
  to anon, authenticated
  using (workspace_key = 'shared');

drop policy if exists "admin write alliance scenarios" on public.tbsb_alliance_scenarios;
create policy "admin write alliance scenarios"
  on public.tbsb_alliance_scenarios
  for all
  to authenticated
  using (public.tbsb_is_admin())
  with check (public.tbsb_is_admin());

drop policy if exists "public read pick lists" on public.tbsb_pick_lists;
create policy "public read pick lists"
  on public.tbsb_pick_lists
  for select
  to anon, authenticated
  using (workspace_key = 'shared');

drop policy if exists "admin write pick lists" on public.tbsb_pick_lists;
create policy "admin write pick lists"
  on public.tbsb_pick_lists
  for all
  to authenticated
  using (public.tbsb_is_admin())
  with check (public.tbsb_is_admin());

drop policy if exists "public read playoff results" on public.tbsb_playoff_results;
create policy "public read playoff results"
  on public.tbsb_playoff_results
  for select
  to anon, authenticated
  using (workspace_key = 'shared');

drop policy if exists "admin write playoff results" on public.tbsb_playoff_results;
create policy "admin write playoff results"
  on public.tbsb_playoff_results
  for all
  to authenticated
  using (public.tbsb_is_admin())
  with check (public.tbsb_is_admin());

drop policy if exists "public read strategy records" on public.tbsb_strategy_records;
create policy "public read strategy records"
  on public.tbsb_strategy_records
  for select
  to anon, authenticated
  using (workspace_key = 'shared');

drop policy if exists "admin write strategy records" on public.tbsb_strategy_records;
create policy "admin write strategy records"
  on public.tbsb_strategy_records
  for all
  to authenticated
  using (public.tbsb_is_admin())
  with check (public.tbsb_is_admin());

drop policy if exists "public read snapshot cache" on public.tbsb_snapshot_cache;
create policy "public read snapshot cache"
  on public.tbsb_snapshot_cache
  for select
  to anon, authenticated
  using (true);

drop policy if exists "admin write snapshot cache" on public.tbsb_snapshot_cache;
create policy "admin write snapshot cache"
  on public.tbsb_snapshot_cache
  for all
  to authenticated
  using (public.tbsb_is_admin())
  with check (public.tbsb_is_admin());

drop policy if exists "public read upstream cache" on public.tbsb_upstream_cache;
create policy "public read upstream cache"
  on public.tbsb_upstream_cache
  for select
  to anon, authenticated
  using (true);

drop policy if exists "admin write upstream cache" on public.tbsb_upstream_cache;
create policy "admin write upstream cache"
  on public.tbsb_upstream_cache
  for all
  to authenticated
  using (public.tbsb_is_admin())
  with check (public.tbsb_is_admin());

insert into public.tbsb_workspace_settings (workspace_key, payload)
values ('shared', '{}'::jsonb)
on conflict (workspace_key) do nothing;
