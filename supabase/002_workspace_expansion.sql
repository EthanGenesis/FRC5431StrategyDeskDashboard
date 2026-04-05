create table if not exists public.tbsb_workspace_notes (
  id text primary key,
  workspace_key text not null default 'shared',
  scope text not null check (scope in ('event', 'team', 'match')),
  event_key text,
  team_number integer,
  match_key text,
  label text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.tbsb_workspace_activity (
  id text primary key,
  workspace_key text not null default 'shared',
  scope text not null default 'workspace' check (scope in ('workspace', 'event', 'team', 'match')),
  event_key text,
  team_number integer,
  match_key text,
  action text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tbsb_workspace_checklists (
  id text primary key,
  workspace_key text not null default 'shared',
  scope text not null check (scope in ('event', 'team', 'match')),
  event_key text,
  team_number integer,
  match_key text,
  label text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users (id) on delete set null
);

create index if not exists tbsb_workspace_notes_workspace_updated_idx
  on public.tbsb_workspace_notes (workspace_key, updated_at desc);

create index if not exists tbsb_workspace_notes_scope_idx
  on public.tbsb_workspace_notes (workspace_key, scope, event_key, team_number, match_key);

create index if not exists tbsb_workspace_activity_workspace_created_idx
  on public.tbsb_workspace_activity (workspace_key, created_at desc);

create index if not exists tbsb_workspace_activity_scope_idx
  on public.tbsb_workspace_activity (workspace_key, scope, event_key, team_number, match_key, created_at desc);

create index if not exists tbsb_workspace_checklists_workspace_updated_idx
  on public.tbsb_workspace_checklists (workspace_key, updated_at desc);

create index if not exists tbsb_workspace_checklists_scope_idx
  on public.tbsb_workspace_checklists (workspace_key, scope, event_key, team_number, match_key);

alter table public.tbsb_workspace_notes enable row level security;
alter table public.tbsb_workspace_activity enable row level security;
alter table public.tbsb_workspace_checklists enable row level security;

drop policy if exists "public read workspace notes" on public.tbsb_workspace_notes;
create policy "public read workspace notes"
  on public.tbsb_workspace_notes
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "shared workspace write workspace notes" on public.tbsb_workspace_notes;
create policy "shared workspace write workspace notes"
  on public.tbsb_workspace_notes
  for all
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key))
  with check (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read workspace activity" on public.tbsb_workspace_activity;
create policy "public read workspace activity"
  on public.tbsb_workspace_activity
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "shared workspace write workspace activity" on public.tbsb_workspace_activity;
create policy "shared workspace write workspace activity"
  on public.tbsb_workspace_activity
  for all
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key))
  with check (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "public read workspace checklists" on public.tbsb_workspace_checklists;
create policy "public read workspace checklists"
  on public.tbsb_workspace_checklists
  for select
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key));

drop policy if exists "shared workspace write workspace checklists" on public.tbsb_workspace_checklists;
create policy "shared workspace write workspace checklists"
  on public.tbsb_workspace_checklists
  for all
  to anon, authenticated
  using (public.tbsb_is_allowed_workspace_key(workspace_key))
  with check (public.tbsb_is_allowed_workspace_key(workspace_key));

do $$
begin
  begin
    alter publication supabase_realtime add table public.tbsb_workspace_notes;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tbsb_workspace_activity;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tbsb_workspace_checklists;
  exception when duplicate_object then null;
  end;
end
$$;
