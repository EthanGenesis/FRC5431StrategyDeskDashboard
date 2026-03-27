# TBSB Dashboard

Live FRC strategy desk dashboard built with Next.js, React, and Recharts.

## Quality Workflow

Use these scripts during development:

```bash
npm run dev
npm run build
npm run lint
npm run deps:check
npm run typecheck
npm run test
npm run test:e2e
npm run format
npm run format:check
```

## Quality Gate

The intended hard local gate is:

```bash
npm run format:check
npm run lint
npm run deps:check
npm run typecheck
npm test
npm run build
```

For navigation/user-journey changes, also run:

```bash
npm run test:e2e
```

## Current Structure

- `app/page.tsx` is now a thin route shell.
- The main client dashboard implementation lives in `components/dashboard/DashboardPage.jsx`.
- Shared analytics, storage, and snapshot helpers live under `lib/`.
- Shared route logging and telemetry bootstrap live under `lib/observability.ts`, `lib/otel-node.ts`, and `instrumentation.ts`.
- Raw troubleshooting payloads remain available in the bottom of the Settings view.
- CI, CodeQL, and Dependabot automation live under `.github/`.

## Hardening Goals

- Preserve all existing workflows and analytics surfaces.
- Keep current/historical/predict/settings scope separation intact.
- Use lint, tests, and the parity checklist as the baseline before major refactors.
- Keep future changes inside the same enforced quality system.

## Notes

- `PARITY_CHECKLIST.md` documents the current feature/workflow preservation audit.
- `docs/CODING_STANDARD.md` documents the repo-wide coding standard and no-regression expectations.
- `docs/ARCHITECTURE.md` explains navigation, state ownership, and data flow.
- `docs/UI_SYSTEM.md` documents the mission-control UI system, token scale, spacing rules, and dense analytics design rules.
- `docs/API_CONTRACTS.md` documents the major route payload expectations.
- `docs/OPERATIONS.md` documents quality gates, security/config expectations, and troubleshooting.
- `docs/DEPLOYMENT_RUNBOOK.md` documents the GitHub + Supabase + Vercel production setup path.
- CI now enforces format, lint, dependency boundaries, typecheck, tests, build, Playwright smoke, and a production dependency audit threshold.
- The app still contains some JS/JSX implementation surfaces, but the repo now enforces stricter typing, linting, tests, security headers, and route-level boundary protection around them while the remaining migration continues.
