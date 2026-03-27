# TBSB Dashboard Coding Standard

This repo uses a permanent quality bar, not a one-time cleanup.

## Non-Negotiables

- No intentional feature loss.
- No functionality-preserving refactor ships without parity verification against [PARITY_CHECKLIST.md](../PARITY_CHECKLIST.md).
- `Prettier`, `ESLint`, `TypeScript`, tests, and build are hard gates, not suggestions.

## Required Local Gate

Run these before shipping meaningful changes:

```bash
npm run format:check
npm run lint
npm run deps:check
npm run typecheck
npm test
npm run build
```

For browser-flow changes, also run:

```bash
npm run test:e2e
```

## Repo Defaults

- TypeScript strict mode with additional strictness flags enabled.
- Typed `typescript-eslint` rules for correctness and hook safety.
- Prettier is the only formatting authority.
- Boundary validation lives in shared server/data helpers, not ad hoc route code.
- Shared event-context loading should be reused instead of duplicated.
- Security-sensitive config is parsed centrally in `lib/env.ts`.
- Route handlers should use the shared request logging/response helpers in `lib/observability.ts`.
- Dependency boundaries are enforced with `dependency-cruiser`.
- Production security headers and telemetry bootstrap belong in config/runtime entrypoints, not scattered across features.

## Refactor Rules

- Protect behavior first with tests or parity coverage.
- Keep render code presentation-focused; move heavy derivation into helpers/selectors/hooks.
- Keep route handlers thin and explicit.
- Prefer stable, explicit dependencies over hook suppression comments.
- Remove dead code while touching an area, but do not sprawl functionality changes into cleanup work.

## Future Work Expectations

- New routes should be typed and validated at the boundary.
- New async flows should avoid floating promises and support cancellation when practical.
- New UI journeys should get either a Vitest regression test or a Playwright smoke test, depending on scope.
- New dependencies need clear justification and should not duplicate existing tooling.
- New refactors must preserve the current parity checklist and keep the hard gates green.
