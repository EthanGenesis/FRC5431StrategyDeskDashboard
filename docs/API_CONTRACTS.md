# API Contracts

## Principles

- Route success payloads stay backward-compatible with the current app shell.
- Route failures should return a stable `{ "error": string }` shape when possible.
- Route handlers should validate external input at the boundary and keep transform logic in shared helpers.
- New source surfaces are added additively. Existing raw nested payloads stay available for deep tables and troubleshooting.

## Major Routes

### `GET /api/bootstrap`

Warm boot payload for the shared desk.

Core payload areas:

- shared active target
- shared refresh status
- warm current snapshot
- warm team event catalog
- bundle manifest summary keyed by bundle source

Bootstrap and warm-bundle responses may also include cache metadata when available:

- `generatedAtMs`
- `bundleKey`
- `bundleVersion`
- `etag`
- `cacheState`
- `cacheLayer`
- `refreshState`
- `freshUntil`
- `staleAt`

### `GET /api/snapshot`

Primary current-event snapshot used by the dashboard shell.

Core payload areas:

- generated timestamp
- selected event/team inputs
- TBA event/match/ranking/oprs/status payloads
- Statbotics match/team-event/team-match payloads
- official FIRST overlap payload:
  - `status`
  - `event`
  - `matches`
  - `rankings`
  - `awards`
  - `district`
- Nexus live-ops payload:
  - `status`
  - `queueText`
  - `matches`
  - `pitAddressByTeam`
  - `inspectionByTeam`
  - `loadedTeamOps`
  - optional subresource statuses:
    - `pitsStatus`
    - `inspectionStatus`
    - `pitMapStatus`
- media payload:
  - preferred webcast
  - webcast list
  - event media rows
- validation payload:
  - `firstStatus`
  - `nexusStatus`
  - `officialAvailability`
  - `officialCounts`
  - `discrepancies`
  - `staleSeconds`
  - `summary`
- live signal log:
  - normalized TBA webhook signals for the active event

### `GET /api/event-context?eventKey=...`

Loads a single event context for strategy and scoped exploration.

Core payload areas:

- event metadata
- TBA matches/rankings/oprs/status/teams
- Statbotics event-level context
- additive official/nexus/media/validation/liveSignals payloads matching the snapshot shape
- `nexus.loadedTeamOps` may be `null` here because event-context requests are event-scoped and not always tied to a loaded team

### `GET /api/team-profile?team=...&eventKey=...`

Loads a single team's current-event plus historical 2026 profile.

Core payload areas:

- season summary / rollups
- season events and season matches
- current loaded-event row and loaded-event match chronology
- historical 2026 rows excluding the loaded event

### `GET /api/event-search?query=...&team=...`

Internal event-picker route for competition-day loading.

Core behavior:

- scopes to `2026` only
- if `team` is valid, returns only that team's 2026 events from TBA
- otherwise falls back to the global 2026 event list
- filters by:
  - event key
  - short name
  - full name
  - location text
- blank `query` is allowed for team-scoped lookup so the picker can show the full event list for the typed team

### `POST /api/team-compare`

Body:

```json
{
  "teams": [5431, 111, 254],
  "eventKey": "2026miket"
}
```

Core payload areas:

- generated timestamp
- loaded event metadata
- event field averages
- compare rows with current-event and historical buckets
- derived metric surfaces for charts/tables

### `GET /api/pre-event-scout?eventKey=...`

Historical-only scouting route for the loaded event roster.

Core payload areas:

- event metadata
- roster team list
- season summary / season rollup data per team
- played/upcoming event history

### `POST /api/data-super`

Everything route for the `DATA` supertabs.

Core payload areas:

- current event core
- historical team core
- compare snapshot
- diagnostics
- raw payload references

### Warm bundle routes

Server-authoritative warm bundle routes now exist for the heavy desk tabs:

- `POST /api/compare-bundle`
- `POST /api/predict-bundle`
- `POST /api/alliance-bundle`
- `POST /api/playoff-bundle`
- `POST /api/impact-bundle`
- `POST /api/pick-list-bundle`

Each route keeps the existing UI-facing payload body for its feature area and may additionally return:

- `generatedAtMs`
- `bundleKey`
- `bundleVersion`
- `etag`
- `cacheState`
- `cacheLayer`
- `refreshState`
- `freshUntil`
- `staleAt`

Compatibility rules:

- the typed payload body remains the source of truth for the tab UI
- cache metadata is additive and must not replace existing domain payload fields
- if the hot plane is disabled or unavailable, local server handling remains the fallback

### Internal hot-plane behavior

Some routes can now operate in three modes controlled by environment:

- `disabled`
  - current route handler responds locally
- `shadow`
  - current route handler responds locally
  - an internal hot-plane request runs in parallel for parity and perf logging
- `proxy`
  - eligible routes proxy to the hot plane first
  - local route handling remains the fallback path on proxy failure

This rollout model is intentionally additive so route contracts remain stable while performance infrastructure evolves.

## Compatibility Notes

- Client code still expects some routes to provide raw nested payloads for deep tables and troubleshooting.
- Do not "clean up" route outputs by deleting fields unless the UI has first been updated and parity has been revalidated.
- Warm bundle metadata is additive and should be treated as transport/cache information, not as a replacement for existing feature payloads.
- Nexus optional subresources are event-conditional:
  - `/pits`
  - `/inspection`
  - `/map`
    `unsupported` means the event does not expose that surface, not that the integration is broken.
