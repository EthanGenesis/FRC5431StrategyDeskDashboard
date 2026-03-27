# Deployment Runbook

This is the zero-to-live runbook for publishing TBSB Dashboard with:

- `GitHub` as source control
- `Vercel` for hosting
- `Supabase` for shared persistence and server-side cache storage

This repo is currently a `Next.js 16` app that already depends on `TBA_AUTH_KEY`. Shared desk data now persists in Supabase, with event-scoped workspaces for shared collaboration and session-only personal preferences for theme/language/webhooks/loading context. The files added for the production migration baseline are:

- [.env.example](/c:/Users/ethan/Desktop/tbsb-dashboard/.env.example)
- [lib/env.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/env.ts)
- [lib/supabase.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/supabase.ts)
- [lib/supabase-browser.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/supabase-browser.ts)
- [lib/supabase-server.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/supabase-server.ts)
- [lib/persistence-surfaces.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/persistence-surfaces.ts)
- [lib/persistence-types.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/persistence-types.ts)
- [supabase/001_shared_workspace.sql](/c:/Users/ethan/Desktop/tbsb-dashboard/supabase/001_shared_workspace.sql)

Optional live-ops integrations added in the final major pass:

- TBA webhook receiver: `POST /api/webhook/tba`
- FIRST official API cross-check support
- Nexus event-ops support
- Supabase Realtime for event-scoped collaboration and live desk updates

Official platform references:

- GitHub: `https://docs.github.com/en/repositories/creating-and-managing-repositories/quickstart-for-repositories`
- Vercel Git deployments: `https://vercel.com/docs/deployments/git/vercel-for-github`
- Supabase Next.js quickstart: `https://supabase.com/docs/guides/getting-started/quickstarts/nextjs`

## Production Model

Chosen production model for this repo:

- public GitHub repo
- direct deploys from `main`
- shared-link app for trusted users
- shared read/write workspace access for anyone who has the app link
- shared desk data is scoped by loaded event using workspace keys like `event:2026txabc`
- theme, language, loaded team, loaded event, and webhook settings are not shared globally
- Supabase stores:
  - compare drafts/sets
  - predict scenarios
  - alliance scenarios
  - pick lists
  - playoff results
  - strategy records
  - event-scoped shared workspace settings
  - snapshot and upstream cache data

Important security note:

- this is a collaboration-by-shared-link model, not a hardened permission model
- anyone who has the deployed app URL and the shipped browser app can use the public Supabase client to read and write the event workspaces allowed by RLS
- this is acceptable only if you intentionally treat the app URL as a trusted private team link
- if you later need per-user accountability or stronger write protection, you should move back to authenticated users and narrower write policies

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

Optional but recommended for the final live-ops pass:

- `TBA_WEBHOOK_SECRET`
- `FIRST_API_BASE_URL`
- `FIRST_API_USERNAME`
- `FIRST_API_AUTH_TOKEN`
- `NEXUS_API_BASE_URL`
- `NEXUS_API_KEY`

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
   - `Publishable key`
   - `service_role` key

### Auth setup

Supabase Auth is optional for the first cut of this shared-link model.

- you can leave email/password auth disabled if you are not using signed-in identities yet
- the app uses the Supabase public client key for event-scoped shared reads and writes
- the `service_role` key remains server-only and is still used for trusted server-side cache persistence when needed

### Apply the shared workspace schema

Open the SQL editor in Supabase and run:

- [supabase/001_shared_workspace.sql](/c:/Users/ethan/Desktop/tbsb-dashboard/supabase/001_shared_workspace.sql)

If you already ran an older version of this SQL file, run the updated file again so the RLS policies allow the new `event:*` workspace keys.

This creates:

- `tbsb_workspace_settings`
- `tbsb_compare_drafts`
- `tbsb_compare_sets`
- `tbsb_predict_scenarios`
- `tbsb_alliance_scenarios`
- `tbsb_pick_lists`
- `tbsb_playoff_results`
- `tbsb_strategy_records`
- `tbsb_event_live_signals`
- `tbsb_source_validation`
- `tbsb_snapshot_cache`
- `tbsb_upstream_cache`

It also adds the required Supabase Realtime publication entries for the shared desk tables. If you ran an older version before Realtime support existed, rerun the latest SQL so the publication includes the live-collaboration tables.

## 4. Fill Local Supabase Env Vars

Update `.env.local` with:

```env
TBA_AUTH_KEY=...

NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
TBA_WEBHOOK_SECRET=
FIRST_API_BASE_URL=https://frc-api.firstinspires.org/v3.0
FIRST_API_USERNAME=
FIRST_API_AUTH_TOKEN=
NEXUS_API_BASE_URL=https://frc.nexus/api/v1
NEXUS_API_KEY=

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
- in this model, the publishable key is intentionally enough to read and write the event-scoped shared workspace tables allowed by RLS
- server-side cache writes use the service-role client, which bypasses RLS; you do not need separate RLS write policies for that server-only path

## 5. Vercel Project Setup

In Vercel:

1. Click `Add New Project`
2. Import the GitHub repository
3. Framework preset should auto-detect as `Next.js`
4. Keep the production branch as `main`

Add environment variables in Vercel for `Production`, and preferably also `Preview` and `Development`:

- `TBA_AUTH_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional live-ops vars:
  - `TBA_WEBHOOK_SECRET`
  - `FIRST_API_BASE_URL`
  - `FIRST_API_USERNAME`
  - `FIRST_API_AUTH_TOKEN`
  - `NEXUS_API_BASE_URL`
  - `NEXUS_API_KEY`
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
- public visitors can write shared workspace data
- same-event collaboration updates propagate through Supabase Realtime
- snapshot and upstream cache rows are still written only from trusted server-side code
- `tbsb_event_live_signals` receives TBA webhook/live desk events
- `tbsb_source_validation` stores the official-vs-working validation snapshot per event workspace
- shared workspace rows exist in Supabase
- snapshot / cache rows can be written server-side

Optional live-ops checks:

- `POST /api/webhook/tba` accepts a valid TBA webhook payload and appends a row to `tbsb_event_live_signals`
- FIRST official credentials unlock visible overlap checks in the `EVENT` workspace
- Nexus credentials unlock queue/announcements/parts/pit map/inspection panels where supported

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

Your current product decision is:

- Supabase is the primary storage layer for the whole project base
- browser storage may still exist as a temporary offline/fallback cache during migration, but saved project artifacts should be treated as Supabase-owned

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

1. add shared workspace read/write service layer
2. migrate settings + compare storage first
3. migrate predict/alliance/playoff artifacts
4. migrate strategy records
5. move snapshot/upstream caching to trusted server-side Supabase writes
6. leave browser storage only as a migration fallback until every saved artifact is Supabase-backed

That ordering gives you the lowest-risk path from local-only persistence to shared production persistence.
