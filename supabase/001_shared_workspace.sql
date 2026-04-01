create extension if not exists pgcrypto;

create or replace function public.tbsb_is_allowed_workspace_key(value text)
returns boolean
language sql
immutable
as $$
  select value = 'shared' or value like 'event:%'
$$;

create table if not exists public.tbsb_workspace_settings (
  workspace_key text primary key default 'shared',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.tbsb_active_target (
  workspace_key text primary key default 'shared',
  season_year integer not null default 2026,
  team_number integer,
  event_key text not null default '',
  event_name text not null default '',
  event_short_name text not null default '',
  event_location text not null default '',
  start_date date,
  end_date date,
  last_snapshot_generated_at timestamptz,
  last_event_context_generated_at timestamptz,
  last_team_catalog_generated_at timestamptz,
  last_refreshed_at timestamptz,
  refresh_state text not null default 'idle' check (refresh_state in ('idle', 'loading', 'ready', 'error')),
  refresh_error text,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.tbsb_team_event_catalog (
  workspace_key text not null default 'shared',
  team_number integer not null,
  season_year integer not null default 2026,
  payload jsonb not null default '[]'::jsonb,
  generated_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_key, team_number, season_year)
);

create table if not exists public.tbsb_refresh_status (
  workspace_key text primary key default 'shared',
  state text not null default 'idle' check (state in ('idle', 'loading', 'ready', 'error')),
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  detail jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tbsb_bundle_status (
  bundle_key text primary key,
  workspace_key text not null default 'shared',
  source text not null,
  event_key text,
  team_number integer,
  scenario_id text,
  state text not null default 'idle' check (state in ('idle', 'loading', 'ready', 'error')),
  generated_at timestamptz,
  error text,
  meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tbsb_parity_audit_log (
  id uuid primary key default gen_random_uuid(),
  route_key text not null,
  workspace_key text not null default 'shared',
  event_key text,
  team_number integer,
  scenario_id text,
  status text not null check (status in ('match', 'diff', 'error', 'skipped')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tbsb_perf_samples (
  id uuid primary key default gen_random_uuid(),
  route_key text not null,
  workspace_key text not null default 'shared',
  event_key text,
  team_number integer,
  scenario_id text,
  status_code integer not null,
  duration_ms integer not null,
  cache_state text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
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

create table if not exists public.tbsb_event_live_signals (
  id uuid primary key default gen_random_uuid(),
  workspace_key text not null,
  event_key text not null,
  source text not null,
  signal_type text not null,
  title text not null,
  body text not null default '',
  dedupe_key text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tbsb_source_validation (
  workspace_key text primary key,
  event_key text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
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

create index if not exists tbsb_team_event_catalog_workspace_updated_idx
  on public.tbsb_team_event_catalog (workspace_key, updated_at desc);

create index if not exists tbsb_bundle_status_workspace_updated_idx
  on public.tbsb_bundle_status (workspace_key, updated_at desc);

create index if not exists tbsb_parity_audit_log_route_created_idx
  on public.tbsb_parity_audit_log (route_key, created_at desc);

create index if not exists tbsb_parity_audit_log_workspace_created_idx
  on public.tbsb_parity_audit_log (workspace_key, created_at desc);

create index if not exists tbsb_perf_samples_route_created_idx
  on public.tbsb_perf_samples (route_key, created_at desc);

create index if not exists tbsb_perf_samples_workspace_created_idx
  on public.tbsb_perf_samples (workspace_key, created_at desc);

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

create index if not exists tbsb_event_live_signals_workspace_event_idx
  on public.tbsb_event_live_signals (workspace_key, event_key, created_at desc);

create unique index if not exists tbsb_event_live_signals_workspace_dedupe_idx
  on public.tbsb_event_live_signals (workspace_key, dedupe_key)
  where dedupe_key is not null;

create index if not exists tbsb_snapshot_cache_source_event_team_idx
  on public.tbsb_snapshot_cache (source, event_key, team_number, updated_at desc);

create index if not exists tbsb_upstream_cache_source_path_idx
  on public.tbsb_upstream_cache (source, request_path, updated_at desc);

alter table public.tbsb_workspace_settings enable row level security;
alter table public.tbsb_active_target enable row level security;
alter table public.tbsb_team_event_catalog enable row level security;
alter table public.tbsb_refresh_status enable row level security;
alter table public.tbsb_bundle_status enable row level security;
alter table public.tbsb_parity_audit_log enable row level security;
alter table public.tbsb_perf_samples enable row level security;
alter table public.tbsb_compare_drafts enable row level security;
alter table public.tbsb_compare_sets enable row level security;
alter table public.tbsb_predict_scenarios enable row level security;
alter table public.tbsb_alliance_scenarios enable row level security;
alter table public.tbsb_pick_lists enable row level security;
alter table public.tbsb_playoff_results enable row level security;
alter table public.tbsb_strategy_records enable row level security;
alter table public.tbsb_event_live_signals enable row level security;
alter table public.tbsb_source_validation enable row level security;
alter table public.tbsb_snapshot_cache enable row level security;
alter table public.tbsb_upstream_cache enable row level security;

drop policy if exists "public read workspace settings" on public.tbsb_workspace_settings;
create policy "public read workspace settings"
  on public.tbsb_workspace_settings
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read active target" on public.tbsb_active_target;
create policy "public read active target"
  on public.tbsb_active_target
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "shared workspace write active target" on public.tbsb_active_target;
create policy "shared workspace write active target"
  on public.tbsb_active_target
  for all
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key))
  with check (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read team event catalog" on public.tbsb_team_event_catalog;
create policy "public read team event catalog"
  on public.tbsb_team_event_catalog
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read refresh status" on public.tbsb_refresh_status;
create policy "public read refresh status"
  on public.tbsb_refresh_status
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read bundle status" on public.tbsb_bundle_status;
create policy "public read bundle status"
  on public.tbsb_bundle_status
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "shared workspace write workspace settings" on public.tbsb_workspace_settings;
create policy "shared workspace write workspace settings"
  on public.tbsb_workspace_settings
  for all
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key))
  with check (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read compare drafts" on public.tbsb_compare_drafts;
create policy "public read compare drafts"
  on public.tbsb_compare_drafts
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "shared workspace write compare drafts" on public.tbsb_compare_drafts;
create policy "shared workspace write compare drafts"
  on public.tbsb_compare_drafts
  for all
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key))
  with check (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read compare sets" on public.tbsb_compare_sets;
create policy "public read compare sets"
  on public.tbsb_compare_sets
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "shared workspace write compare sets" on public.tbsb_compare_sets;
create policy "shared workspace write compare sets"
  on public.tbsb_compare_sets
  for all
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key))
  with check (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read predict scenarios" on public.tbsb_predict_scenarios;
create policy "public read predict scenarios"
  on public.tbsb_predict_scenarios
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "shared workspace write predict scenarios" on public.tbsb_predict_scenarios;
create policy "shared workspace write predict scenarios"
  on public.tbsb_predict_scenarios
  for all
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key))
  with check (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read alliance scenarios" on public.tbsb_alliance_scenarios;
create policy "public read alliance scenarios"
  on public.tbsb_alliance_scenarios
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "shared workspace write alliance scenarios" on public.tbsb_alliance_scenarios;
create policy "shared workspace write alliance scenarios"
  on public.tbsb_alliance_scenarios
  for all
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key))
  with check (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read pick lists" on public.tbsb_pick_lists;
create policy "public read pick lists"
  on public.tbsb_pick_lists
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "shared workspace write pick lists" on public.tbsb_pick_lists;
create policy "shared workspace write pick lists"
  on public.tbsb_pick_lists
  for all
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key))
  with check (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read playoff results" on public.tbsb_playoff_results;
create policy "public read playoff results"
  on public.tbsb_playoff_results
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "shared workspace write playoff results" on public.tbsb_playoff_results;
create policy "shared workspace write playoff results"
  on public.tbsb_playoff_results
  for all
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key))
  with check (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read strategy records" on public.tbsb_strategy_records;
create policy "public read strategy records"
  on public.tbsb_strategy_records
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "shared workspace write strategy records" on public.tbsb_strategy_records;
create policy "shared workspace write strategy records"
  on public.tbsb_strategy_records
  for all
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key))
  with check (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read event live signals" on public.tbsb_event_live_signals;
create policy "public read event live signals"
  on public.tbsb_event_live_signals
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read source validation" on public.tbsb_source_validation;
create policy "public read source validation"
  on public.tbsb_source_validation
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read snapshot cache" on public.tbsb_snapshot_cache;
create policy "public read snapshot cache"
  on public.tbsb_snapshot_cache
  for select
  to anon, authenticated
  using (true);

drop policy if exists "public read upstream cache" on public.tbsb_upstream_cache;
create policy "public read upstream cache"
  on public.tbsb_upstream_cache
  for select
  to anon, authenticated
  using (true);

insert into public.tbsb_workspace_settings (workspace_key, payload)
values ('shared', '{}'::jsonb)
on conflict (workspace_key) do nothing;

insert into public.tbsb_active_target (workspace_key)
values ('shared')
on conflict (workspace_key) do nothing;

insert into public.tbsb_refresh_status (workspace_key)
values ('shared')
on conflict (workspace_key) do nothing;

do $$
begin
  begin
    alter publication supabase_realtime add table public.tbsb_workspace_settings;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tbsb_active_target;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tbsb_team_event_catalog;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tbsb_refresh_status;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tbsb_bundle_status;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tbsb_compare_drafts;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tbsb_compare_sets;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tbsb_predict_scenarios;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tbsb_alliance_scenarios;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tbsb_pick_lists;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tbsb_playoff_results;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tbsb_strategy_records;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tbsb_event_live_signals;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tbsb_source_validation;
  exception when duplicate_object then null;
  end;
end
$$;
