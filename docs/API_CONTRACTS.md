# API Contracts

## Principles

- Route success payloads are backward-compatible with the current app.
- Route failures should return a stable `{ "error": string }` shape when possible.
- Route handlers should validate external input at the boundary and keep transform logic in shared helpers.

## Major Routes

### `GET /api/snapshot`

Primary current-event snapshot used by the dashboard shell.

Core payload areas:

- generated timestamp
- selected event/team inputs
- TBA event/match/ranking/oprs/status payloads
- Statbotics match/team-event/team-match payloads

### `GET /api/event-context?eventKey=...`

Loads a single event context for strategy and scoped exploration.

Core payload areas:

- event metadata
- TBA matches/rankings/oprs/status/teams
- Statbotics event-level context

### `GET /api/team-profile?team=...&eventKey=...`

Loads a single team’s current-event plus historical 2026 profile.

Core payload areas:

- season summary / rollups
- season events and season matches
- current loaded-event row and loaded-event match chronology
- historical 2026 rows excluding the loaded event

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

## Compatibility Notes

- Client code still expects some routes to provide raw nested payloads for deep tables and troubleshooting.
- Do not “clean up” route outputs by deleting fields unless the UI has first been updated and parity has been revalidated.
