# Split Navigation Parity Checklist

Date: 2026-03-26

Scope of this checklist:

- Code-level parity audit between the previous broad flat-layout version and the current 4-layer navigation split.
- Verifies that each prior tab/workflow still exists somewhere in the app.
- Focuses on preserved workflows, controls, and data surfaces that are discoverable in code.

Status legend:

- `PASS`: workflow/tab is present in the split layout with equivalent or expanded purpose.
- `FIXED`: a regression was found during audit and patched in the current version.

## Top-Level Mapping

| Previous Tab    | New Location                                           | Status | Notes                                                                            |
| --------------- | ------------------------------------------------------ | ------ | -------------------------------------------------------------------------------- |
| `NOW`           | `Current > NOW`                                        | PASS   | Next match, rival band, key matches, team intel, contextual charts.              |
| `SCHEDULE`      | `Current > SCHEDULE`                                   | PASS   | Match table, open match, open strategy, contextual charts.                       |
| `MATCH`         | `Current > MATCH`                                      | PASS   | Match intel, score breakdown, open strategy, contextual analytics.               |
| `STRATEGY`      | `Current > STRATEGY` / `Historical > STRATEGY`         | FIXED  | Historical targeted strategy flow was restored during audit.                     |
| `COMPARE`       | `Current > COMPARE` / `Historical > COMPARE`           | FIXED  | Smoothing + baseline emphasis were restored and scoped drafts were separated.    |
| `TEAM_PROFILE`  | `Current > TEAM_PROFILE` / `Historical > TEAM_PROFILE` | PASS   | Current-only and historical-only versions preserved.                             |
| `RANKINGS`      | `Current > RANKINGS` / `Historical > RANKINGS`         | PASS   | Current rankings board and historical scouting rankings mode both exist.         |
| `PLAYOFFS`      | `Current > PLAYOFFS` / `Historical > PLAYOFFS`         | PASS   | Current bracket board plus historical scouting playoff context.                  |
| `EVENT`         | `Current > EVENT` / `Historical > EVENT`               | PASS   | Current event board plus historical scouting event mode.                         |
| `PRE_EVENT`     | `Historical > PRE_EVENT`                               | PASS   | Historical-only by design.                                                       |
| `PREDICT`       | `Predict > PREDICT`                                    | PASS   | Manual, deterministic, Monte Carlo prediction workflows preserved.               |
| `ALLIANCE`      | `Predict > ALLIANCE`                                   | PASS   | Live/saved scenario source switching and pick simulator preserved.               |
| `PLAYOFF_LAB`   | `Predict > PLAYOFF_LAB`                                | PASS   | Manual bracket winners, simulations, scenario saves preserved.                   |
| `IMPACT`        | `Predict > IMPACT`                                     | PASS   | Deterministic 0-6 RP impact workflow preserved.                                  |
| `PICK_LIST`     | `Predict > PICK_LIST`                                  | PASS   | Pick list editing, saved playoff scenario cross-checking preserved.              |
| `LIVE_ALLIANCE` | `Predict > LIVE_ALLIANCE`                              | PASS   | Pull rankings, live accept/decline flow, active pick list integration preserved. |
| `SETTINGS`      | `Settings`                                             | PASS   | Controls preserved and raw payload explorer merged into the bottom.              |
| `DATA`          | `Current > DATA` / `Historical > DATA`                 | PASS   | Analytics-only DATA views preserved; raw/debug JSON moved to `Settings`.         |

## Workflow Checks

| Workflow                                                | Status | Notes                                                         |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------- |
| Open match from `NOW` / `SCHEDULE` into `MATCH`         | PASS   | Preserved via `setSelectedMatchKey` + routed split tabs.      |
| Open strategy from schedule/match/team-history          | PASS   | Preserved; historical targeted strategy was explicitly fixed. |
| Open team profile from compare/context/event/pre-event  | PASS   | Preserved via shared `openTeamProfile`.                       |
| Add teams to compare from event/team/pre-event/strategy | PASS   | Preserved via shared `addTeamToCompare`.                      |
| Saved compare sets                                      | PASS   | Shared across scopes.                                         |
| Working compare draft memory                            | PASS   | Now scope-specific for current vs historical.                 |
| Saved predict scenarios                                 | PASS   | Preserved.                                                    |
| Saved alliance scenarios                                | PASS   | Preserved.                                                    |
| Saved playoff results                                   | PASS   | Preserved.                                                    |
| Pick lists                                              | PASS   | Preserved.                                                    |
| Raw payload troubleshooting                             | PASS   | Moved to `Settings` bottom via `RawPayloadExplorer`.          |

## Regressions Found And Patched

1. Historical targeted strategy workspace was missing after the split.
   Status: `FIXED`
   Fix: `Historical > STRATEGY` now renders a real `StrategyWorkspace` when a historical match is opened from `TEAM_PROFILE`.

2. `COMPARE` controls had been weakened during the split.
   Status: `FIXED`
   Fix: smoothing window and baseline emphasis were restored; drafts are now scoped by current vs historical.

## Final Audit Note

This checklist is a code-level parity artifact, not a claim that every possible user click-path and edge-case interaction was exhaustively QA-tested by hand. It does document the intended one-to-one tab/workflow preservation and the concrete regressions that were found and fixed during the audit pass.
