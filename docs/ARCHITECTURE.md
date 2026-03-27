# Architecture

## Purpose

This dashboard is an FRC strategy and analytics workspace with four top-level scopes:

- `Current`
- `Historical`
- `Predict`
- `Settings`

The application is intentionally split by decision context rather than by raw data source. Current-event workflows stay current-only, historical scouting stays historical-only, prediction tooling stays operational, and debugging stays in settings.

## Runtime Shape

### App shell

- [app/page.tsx](/c:/Users/ethan/Desktop/tbsb-dashboard/app/page.tsx) is the Next entrypoint.
- [components/dashboard/DashboardPage.jsx](/c:/Users/ethan/Desktop/tbsb-dashboard/components/dashboard/DashboardPage.jsx) is still the main client shell for top-level navigation, scoped tab state, and cross-tab orchestration.

### Shared data/logic layer

- [lib/logic.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/logic.ts) contains reusable match/team utility logic.
- [lib/analytics.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/analytics.ts) is the normalization and derived-metrics layer for event, season, compare, and rolling analytics.
- [lib/analytics-registry.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/analytics-registry.ts) is the central metric registry plus chart/matrix projection helpers.
- [lib/server-data.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/server-data.ts) is the shared server fetch/transform path for route handlers.
- [lib/httpCache.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/httpCache.ts) is the safe response-reading and client fetch utility layer.

### Feature surfaces

- `Compare` is centered in [components/CompareTab.jsx](/c:/Users/ethan/Desktop/tbsb-dashboard/components/CompareTab.jsx).
- `TEAM_PROFILE` is centered in [components/TeamProfileTab.jsx](/c:/Users/ethan/Desktop/tbsb-dashboard/components/TeamProfileTab.jsx).
- `PRE_EVENT` is centered in [components/PreEventTab.jsx](/c:/Users/ethan/Desktop/tbsb-dashboard/components/PreEventTab.jsx).
- Strategy drawing and strategy records are centered in [components/StrategyWorkspace.jsx](/c:/Users/ethan/Desktop/tbsb-dashboard/components/StrategyWorkspace.jsx) and [components/StrategyBoard.tsx](/c:/Users/ethan/Desktop/tbsb-dashboard/components/StrategyBoard.tsx).
- The exhaustive analytics workspace is [components/DataSuperTab.jsx](/c:/Users/ethan/Desktop/tbsb-dashboard/components/DataSuperTab.jsx).

## Data Flow

### Server routes

Major routes live under `app/api` and follow the same pattern:

1. Parse and validate request input.
2. Load shared event/team context through server helpers.
3. Build route-specific derived structures.
4. Return stable JSON payloads that remain backward-compatible with the current UI.

### Client flow

1. The dashboard shell loads the current snapshot and app settings.
2. Individual tabs lazily fetch deeper route payloads when a workflow needs them.
3. Analytics helpers normalize the raw payloads into chart/table-ready rows.
4. Shared UI blocks render charts, tables, matrices, and safe rich text.

## State Ownership

### Shared state

These are intentionally shared because they affect multiple scopes:

- loaded event/team settings
- compare saved sets
- alliance/playoff saved artifacts
- strategy records

### Persistence baseline

Current browser-side persistence lives in:

- [lib/storage.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/storage.ts)
- [lib/compare-storage.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/compare-storage.ts)
- [lib/strategy-storage.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/strategy-storage.ts)
- [components/dashboard/DashboardPage.jsx](/c:/Users/ethan/Desktop/tbsb-dashboard/components/dashboard/DashboardPage.jsx) for local JSON-backed saved artifacts

The production migration baseline now adds:

- [lib/supabase.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/supabase.ts)
- [lib/supabase-browser.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/supabase-browser.ts)
- [lib/supabase-server.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/supabase-server.ts)
- [lib/persistence-surfaces.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/persistence-surfaces.ts)
- [supabase/001_shared_workspace.sql](/c:/Users/ethan/Desktop/tbsb-dashboard/supabase/001_shared_workspace.sql)

This allows the app to move from browser-only persistence toward event-scoped shared Supabase workspaces without changing the public route structure.

Current deployment intent:

- the deployed app is a trusted shared-link workspace
- anyone with the link can use the current event workspace and save project artifacts
- Supabase is the primary storage layer for saved project data
- theme, language, loaded team, loaded event, and webhook settings are intentionally session-only instead of globally shared

### Scoped state

These are intentionally scope-local:

- current inner tab
- historical inner tab
- predict inner tab
- per-scope compare draft state
- tab-local filters, sort mode, and chart picks

## No-Regression Rule

Behavior preservation is enforced by:

- [PARITY_CHECKLIST.md](/c:/Users/ethan/Desktop/tbsb-dashboard/PARITY_CHECKLIST.md)
- unit/integration tests
- Playwright smoke coverage
- required quality gates in CI

Any refactor must preserve reachable workflows before it is considered complete.
