# Transcript Feature Matrix

This matrix is the additive gap audit for the original strategy-desk transcript and the later finish-line chat additions against the current repo after the final zero-dollar software-only pass on April 6, 2026.

Status key:

- `Exists`: already present in the product before this pass
- `Expanded`: existed, then got materially upgraded in this pass
- `Added`: newly added in this pass
- `Dynamic by design`: intentionally not precomputed or globally persisted

## Core Desk And Event-Day Ops

| Feature                                                    | Status   | Notes                                                                            |
| ---------------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| Shared loaded event/team desk state                        | Exists   | Shared active target + bootstrap are already part of the shared workspace model. |
| Queue 5 / Queue 2 / Queue 1 / Playing Now pinned awareness | Expanded | Queue ladder and desk-ops strip now expose the alert ladder directly.            |
| Persistent source trust / freshness context                | Added    | `Desk Ops` now shows FIRST / Nexus / official trust summary and mismatch counts. |
| "What changed" event-day deltas                            | Added    | `Desk Ops` now surfaces recent deltas for rank/queue/source changes.             |
| Exact rival-pressure board                                 | Added    | `Desk Ops` now shows the live rival pressure band with RP/composite context.     |
| Better key-match watchlist explanations                    | Added    | `Desk Ops` now surfaces both alliances, predicted context, and rival narratives. |
| "What this next result means" quick impact text            | Added    | `Desk Ops` now shows best/floor rank movement and quick impact calls.            |
| Field-delay diagnostics                                    | Added    | `Desk Ops` now summarizes queue/on-deck/start timing drift vs TBA time.          |
| Rival-highlighted key matches                              | Added    | Rival teams now render as highlighted chips inside each key-match watch card.    |
| Competition-vs-analyst layout mode                         | Added    | Added to Settings and surfaced in header badges.                                 |
| Distinct competition / analyst shell presets               | Expanded | Header emphasis, density, recent context, and operator panels now shift by mode. |
| Freeze-state / discussion mode                             | Added    | `freezeAutoRefresh` pauses the main live auto-refresh loops.                     |
| Fullscreen web Pit Mode                                    | Added    | `PIT`, `?pit=1`, and `/pit` open a pit-only fullscreen surface for HDMI/TV use.  |
| Queue alarm controls                                       | Added    | Settings exposes local Queue 5 / Queue 2 / Queue 1 / On Deck alarm toggles.      |
| Shared notes for event / team / match                      | Added    | Backed by new workspace note persistence.                                        |
| Shared event-day checklist                                 | Added    | Backed by new workspace checklist persistence.                                   |
| Shared lightweight activity feed                           | Added    | Backed by new workspace activity persistence.                                    |

## Strategy Workflow

| Feature                                              | Status   | Notes                                                                         |
| ---------------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| Match strategy saved to match key                    | Exists   | Already present via `tbsb_strategy_records`.                                  |
| AUTO and TELEOP drawing boards                       | Exists   | Already present.                                                              |
| Reopen saved strategy by match                       | Exists   | Already present.                                                              |
| Copy full / auto / teleop / notes from another match | Exists   | Already present before this pass.                                             |
| Export JSON / import JSON / print strategy           | Exists   | Already present before this pass.                                             |
| Status workflow beyond draft/final                   | Expanded | Strategy now supports `draft`, `ready`, `used`, `reviewed`.                   |
| Concise plan summary                                 | Added    | Stored in strategy payload and shown in printable brief.                      |
| Key win conditions list                              | Added    | Stored in strategy payload and shown in printable brief/comparison pane.      |
| Post-match retro notes                               | Added    | Stored in strategy payload and surfaced in the new briefing section.          |
| Saved-strategy side-by-side comparison pane          | Added    | Strategy screen can compare the current match against another saved strategy. |
| Library filtering by saved status                    | Expanded | Status filter now matches the expanded strategy state model.                  |
| Team-context cards inside strategy workflow          | Exists   | Already present and still intact.                                             |

## Pick List / Alliance / Playoff Decision Support

| Feature                                                | Status   | Notes                                                                                      |
| ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------ |
| Saved pick lists                                       | Exists   | Already present.                                                                           |
| Saved alliance scenarios                               | Exists   | Already present.                                                                           |
| Saved playoff results                                  | Exists   | Already present.                                                                           |
| Pick-list detail / comparison support                  | Expanded | New `Pick List Decision Center` adds bucket stats, best-by-role, and scenario comparison.  |
| "If selection started now" view                        | Added    | Added to pick-list analysis API + UI.                                                      |
| Best available by role                                 | Added    | Added to pick-list analysis API + UI.                                                      |
| Likely first-pick watchlist                            | Added    | `Pick List Decision Center` now surfaces likely early-pick pressure rows.                  |
| Captain threat board                                   | Added    | `Pick List Decision Center` now surfaces captain-band threats and denial context.          |
| Explicit first-pick / second-pick / do-not-pick boards | Added    | The active pick list now opens as three detailed bucket boards with fit/readiness context. |
| Decision-log detail surfacing                          | Added    | The active pick list now exposes actual logged notes/tags, not only summary counts.        |
| Captain-risk summaries                                 | Added    | Added to saved pick-list scenario summaries.                                               |
| Decision-log count summaries                           | Added    | Added to saved pick-list scenario summaries.                                               |
| Saved playoff comparison matrix                        | Expanded | New `Playoff Summary Matrix` compares saved playoff scenarios directly.                    |
| All-alliance odds view                                 | Expanded | Playoff summary surfaces current all-alliance odds, not only our alliance.                 |
| Visible manual-vs-simulated playoff summaries          | Expanded | Exposed in saved playoff scenario comparison rows.                                         |

## Team / Analytics / Dossier Support

| Feature                                      | Status | Notes                                                                                       |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| Team profile and current/historical scouting | Exists | Already present.                                                                            |
| Team dossier view                            | Added  | New dossier API + panel adds role summary, volatility, leverage, and best-evidence matches. |
| Current-event vs season context              | Added  | Included in team dossier charts/cards.                                                      |
| Previous-event snapshot                      | Added  | Team dossier now carries the latest prior-event summary and replay context.                 |
| Recent event history list                    | Added  | Team dossier now shows recent events with rank, EPA, win-rate, and quick scouting notes.    |
| Recent event trend chart                     | Added  | Team dossier now charts recent-event EPA / win-rate / rank movement together.               |
| Recent trend flags                           | Added  | Team dossier now surfaces concise current-vs-season and previous-event trend flags.         |
| Rank / RP trajectory                         | Added  | Included in team dossier.                                                                   |
| Best-evidence matches                        | Added  | Included in team dossier.                                                                   |
| Win-condition flags                          | Added  | Included in team dossier leverage output.                                                   |

## Warm / Performance Model

| Feature                                                          | Status            | Notes                                                                              |
| ---------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| Warm bootstrap / snapshot / main heavy bundles                   | Exists            | Already landed before this pass.                                                   |
| Game manual prewarm                                              | Expanded          | Landed before this pass and preserved.                                             |
| District points prewarm                                          | Expanded          | Landed before this pass and preserved.                                             |
| Direct route warm-first behavior for event/profile/data surfaces | Expanded          | Existing direct routes now read warm cache first.                                  |
| Desk ops warm refresh                                            | Added             | New desk-ops surface is part of the active-target refresh fan-out.                 |
| Team dossier warm refresh                                        | Added             | New dossier surface is part of the active-target refresh fan-out.                  |
| Pick-list analysis warm refresh                                  | Added             | New pick-list analysis surface is part of the active-target refresh fan-out.       |
| Playoff summary warm refresh                                     | Added             | New playoff summary surface is part of the active-target refresh fan-out.          |
| Pit-ops warm refresh                                             | Added             | Pit mode uses `/api/pit-ops` and is part of the active-target warm support set.    |
| Event search / webhook routes prewarmed                          | Dynamic by design | These remain dynamic and should not be treated as globally precomputed desk state. |

## Final Zero-Dollar Software-Only Additions

| Feature                                     | Status   | Notes                                                                                          |
| ------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| First-class `/pit` route                    | Added    | Browser fullscreen / HDMI use opens directly to the pit-only surface.                          |
| Local last-known-good desk packs            | Added    | Current warm desk context can be stored locally for fallback/replay workflows.                 |
| Replay sessions                             | Added    | Operators can save and reopen local replay packs without mutating shared state.                |
| Saved rehearsal drill library               | Added    | Rehearsal configs can be saved, loaded, duplicated, and deleted locally.                       |
| Workspace presets / bookmarks               | Added    | Common tab/context layouts can be saved and reopened locally.                                  |
| Recent target memory                        | Added    | Recent event/team targets are stored locally for fast recovery and operator flow.              |
| Likely-next warm assist                     | Added    | Bounded likely-next support warms realistic next surfaces without global arbitrary prewarming. |
| Compare setup suggestions                   | Added    | Compare can be seeded from loaded/recent/contextual teams instead of feeling empty by default. |
| Desk Health operator console                | Expanded | Settings now surfaces health, freshness, cache, route, and data-quality context.               |
| Cache refresh / reseed / clear controls     | Added    | `/api/cache-refresh` supports safe operator-driven cache actions.                              |
| Data quality inspector                      | Added    | Desk Health explains stale/missing/fallback/source disagreement states.                        |
| Broader soft collaboration safety           | Expanded | Presence/conflict hints extend across more major shared editor contexts.                       |
| Standardized packet export / print controls | Expanded | Pit, notebook, dossier, pick-list, playoff, strategy, and ops surfaces expose packet actions.  |
| Browser-only webcast handling improvements  | Expanded | Webcast/PiP remains browser-only with no extra hardware assumptions.                           |

## Explicit Non-Goals For This Pass

| Feature                                     | Status            | Notes                                                                                                |
| ------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| Full auth / per-user permissions            | Dynamic by design | Shared-link collaboration model remains intentional.                                                 |
| Hardware-side pit expansion beyond web mode | Dynamic by design | HDMI/TV browser use is supported; extra printers/devices/SMS/hardware integrations are excluded.     |
| Global prewarm for arbitrary ad hoc queries | Dynamic by design | The desk is warm-first for target-scoped operational surfaces, not every possible query permutation. |

## Release Notes

The new persistence surfaces introduced by this pass require:

- [supabase/002_workspace_expansion.sql](/c:/Users/ethan/Desktop/tbsb-dashboard/supabase/002_workspace_expansion.sql)

The repo-side quality gate for this pass finished clean with:

- `npm run format:check`
- `npm run lint`
- `npm run deps:check`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e`
- `npm audit --audit-level=high`
