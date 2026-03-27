# Deployment Runbook

This is the zero-to-live runbook for publishing TBSB Dashboard with:

- `GitHub` as source control
- `Vercel` for hosting
- `Supabase` for authentication and persistence

This repo is currently a `Next.js 16` app that already depends on `TBA_AUTH_KEY` and still stores most saved data in browser storage / IndexedDB. The files added for the production migration baseline are:

- [.env.example](/c:/Users/ethan/Desktop/tbsb-dashboard/.env.example)
- [lib/env.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/env.ts)
- [lib/supabase.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/supabase.ts)
- [lib/supabase-browser.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/supabase-browser.ts)
- [lib/supabase-server.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/supabase-server.ts)
- [lib/persistence-surfaces.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/persistence-surfaces.ts)
- [lib/persistence-types.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/persistence-types.ts)
- [supabase/001_shared_workspace.sql](/c:/Users/ethan/Desktop/tbsb-dashboard/supabase/001_shared_workspace.sql)

Official platform references:

- GitHub: `https://docs.github.com/en/repositories/creating-and-managing-repositories/quickstart-for-repositories`
- Vercel Git deployments: `https://vercel.com/docs/deployments/git/vercel-for-github`
- Supabase Next.js quickstart: `https://supabase.com/docs/guides/getting-started/quickstarts/nextjs`

## Production Model

Chosen production model for this repo:

- public GitHub repo
- direct deploys from `main`
- public read-only app for visitors
- one shared workspace named `shared`
- one admin email/password login
- Supabase stores:
  - shared settings
  - compare drafts/sets
  - predict scenarios
  - alliance scenarios
  - pick lists
  - playoff results
  - strategy records
  - snapshot and upstream cache data

## 1. Local Prerequisites

Install:

- Node `22.x`
- npm
- Git
- a GitHub account
- a Vercel account
- a Supabase account

Verify locally:

```bash
node -v
npm -v
git --version
```

If `git` is not recognized on your machine, install Git first before continuing.

Copy the env template:

```bash
copy .env.example .env.local
```

Fill in at least:

- `TBA_AUTH_KEY`

Do not commit `.env.local`.

Run the local quality gate before publishing anything:

```bash
npm run format:check
npm run lint
npm run deps:check
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## 2. Publish To GitHub

This repo currently needs standard Git initialization if `.git` does not already exist.

Initialize locally:

```bash
git init
git branch -M main
git add .
git commit -m "Initial production-ready baseline"
```

Create a new **public** GitHub repository in the GitHub UI, then connect and push:

```bash
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

Important checks:

- `.env.local` must not be pushed
- `.env.example` should be pushed
- `.github/workflows/ci.yml` should stay enabled

Recommended update flow after launch:

```bash
git add .
git commit -m "Describe the change"
git push origin main
```

## 3. Create The Supabase Project

In Supabase:

1. Create a new project.
2. Choose the region closest to you / expected users.
3. Save the database password somewhere secure.
4. Open `Project Settings -> API` and collect:
   - `Project URL`
   - `anon public` key
   - `service_role` key

### Auth setup

In `Authentication -> Providers`:

- enable `Email`
- use email/password auth
- for a single-admin setup, disable open public signups after creating the admin account if you do not want unsolicited accounts

Create the admin user:

1. Open `Authentication -> Users`
2. Create the admin email/password user

### Apply the shared workspace schema

Open the SQL editor in Supabase and run:

- [supabase/001_shared_workspace.sql](/c:/Users/ethan/Desktop/tbsb-dashboard/supabase/001_shared_workspace.sql)

This creates:

- `tbsb_admin_users`
- `tbsb_workspace_settings`
- `tbsb_compare_drafts`
- `tbsb_compare_sets`
- `tbsb_predict_scenarios`
- `tbsb_alliance_scenarios`
- `tbsb_pick_lists`
- `tbsb_playoff_results`
- `tbsb_strategy_records`
- `tbsb_snapshot_cache`
- `tbsb_upstream_cache`

### Grant admin rights to your auth user

After the admin auth user exists, run this in Supabase SQL:

```sql
insert into public.tbsb_admin_users (user_id, email)
select id, email
from auth.users
where email = 'your-admin-email@example.com'
on conflict (user_id) do update
set email = excluded.email;
```

This is what allows the admin account to pass the `tbsb_is_admin()` RLS check.

## 4. Fill Local Supabase Env Vars

Update `.env.local` with:

```env
TBA_AUTH_KEY=...

NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

APP_LOG_LEVEL=info
OTEL_ENABLED=false
OTEL_DIAG_LOGGING=false
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_SERVICE_NAME=tbsb-dashboard
```

Rules:

- `NEXT_PUBLIC_*` values are safe for the browser
- `SUPABASE_SERVICE_ROLE_KEY` is server-only
- never expose the service role key in client code

## 5. Vercel Project Setup

In Vercel:

1. Click `Add New Project`
2. Import the GitHub repository
3. Framework preset should auto-detect as `Next.js`
4. Keep the production branch as `main`

Add environment variables in Vercel for `Production`, and preferably also `Preview` and `Development`:

- `TBA_AUTH_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional:
  - `APP_LOG_LEVEL`
  - `OTEL_ENABLED`
  - `OTEL_DIAG_LOGGING`
  - `OTEL_EXPORTER_OTLP_ENDPOINT`
  - `OTEL_SERVICE_NAME`

Recommended Vercel settings:

- Build command: default Next.js build is fine
- Output directory: default
- Install command: default npm install is fine
- Node version: `22`

Deploy the project. The first public URL should be the generated:

- `https://<your-project>.vercel.app`

## 6. Verify Production

After the first Vercel deploy:

1. Open the `*.vercel.app` URL
2. Confirm the dashboard loads
3. Confirm TBA-backed routes work
4. Confirm missing env errors do not appear
5. Confirm the app still passes local gates

Supabase-specific checks:

- public visitors can read shared data
- public visitors cannot write data
- the admin account can sign in
- the admin account can write data
- shared workspace rows exist in Supabase
- snapshot / cache rows can be written server-side

GitHub/Vercel checks:

- push a small change to `main`
- confirm Vercel creates a production deployment automatically

## 7. Current Persistence Surfaces To Migrate

The current local storage / IndexedDB surfaces already in this app are mapped in:

- [lib/persistence-surfaces.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/persistence-surfaces.ts)

Current local sources include:

- settings
- last snapshot cache
- predict scenarios
- alliance scenarios
- pick lists
- playoff results
- compare drafts
- compare sets
- strategy records in IndexedDB

These are the first surfaces that should move to Supabase-backed storage while keeping the live dashboard behavior intact.

## 8. Repo-Side Implementation Baseline Already Added

The repo is now prepared for the production migration with:

- Node `22.x` baseline in [package.json](/c:/Users/ethan/Desktop/tbsb-dashboard/package.json) and [.nvmrc](/c:/Users/ethan/Desktop/tbsb-dashboard/.nvmrc)
- env template in [.env.example](/c:/Users/ethan/Desktop/tbsb-dashboard/.env.example)
- optional Supabase env parsing in [lib/env.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/env.ts)
- Next.js/Supabase client helpers in [lib/supabase.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/supabase.ts), [lib/supabase-browser.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/supabase-browser.ts), and [lib/supabase-server.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/supabase-server.ts)
- shared workspace schema + RLS in [supabase/001_shared_workspace.sql](/c:/Users/ethan/Desktop/tbsb-dashboard/supabase/001_shared_workspace.sql)

What is still manual:

- creating the actual GitHub repo
- creating the actual Supabase project
- creating the actual Vercel project
- entering real secrets
- wiring the current browser-only save flows to the new Supabase persistence layer

## 9. Recommended Next Build Phase

After infrastructure is created, the next code phase should be:

1. add admin sign-in UI
2. add shared workspace read/write service layer
3. migrate settings + compare storage first
4. migrate predict/alliance/playoff artifacts
5. migrate strategy records
6. move snapshot/upstream caching to trusted server-side Supabase writes

That ordering gives you the lowest-risk path from local-only persistence to shared production persistence.
