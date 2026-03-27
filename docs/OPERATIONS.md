# Operations And Troubleshooting

## Quality Gates

Run all of these before shipping:

- `npm run format:check`
- `npm run lint`
- `npm run deps:check`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e`
- `npm audit --audit-level=high`

## Common Local Issues

### Dev server stuck compiling

Likely causes:

- stale `next dev` processes still running
- stale `.next` state
- route handlers returning plain-text errors to a client fetch path expecting JSON

Recommended recovery:

1. stop old dev servers
2. clear `.next`
3. restart one clean server
4. refresh the browser once

### `npm run test:e2e` conflicts with a local dev server

Playwright now starts the app through [scripts/start-e2e-server.ps1](/c:/Users/ethan/Desktop/tbsb-dashboard/scripts/start-e2e-server.ps1), which prefers a production `next start` server on `127.0.0.1:3001` and reuses an existing E2E server when one is already healthy.

If E2E still hangs locally:

1. stop stale `node`, `next`, or `playwright` processes for this repo
2. confirm `http://127.0.0.1:3001` is either healthy or fully free
3. rerun `npm run build`
4. rerun `npm run test:e2e`

### `Unexpected token ... is not valid JSON`

This usually means a client fetch path received a plain-text framework/server error instead of JSON.

Relevant code:

- [lib/httpCache.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/httpCache.ts)

The app now uses safe response parsing so these failures become readable app errors instead of raw `res.json()` crashes.

## Security And Config

### Config

- Central env parsing lives in [lib/env.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/env.ts).
- Secrets must stay server-side.
- Client code must never read non-public env directly.
- Production env scaffolding now includes optional Supabase keys in [.env.example](/c:/Users/ethan/Desktop/tbsb-dashboard/.env.example).
- The GitHub + Supabase + Vercel setup sequence lives in [DEPLOYMENT_RUNBOOK.md](/c:/Users/ethan/Desktop/tbsb-dashboard/docs/DEPLOYMENT_RUNBOOK.md).

### Security headers

- Security headers are configured in [next.config.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/next.config.ts).
- CSP is intentionally compatible with current charting, local API calls, and data URL images used by the app.

## Observability

- OpenTelemetry bootstrap lives in [instrumentation.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/instrumentation.ts) and [lib/otel-node.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/otel-node.ts).
- Route logging helpers live in [lib/observability.ts](/c:/Users/ethan/Desktop/tbsb-dashboard/lib/observability.ts).
- If exporter env is absent, telemetry safely becomes a no-op.

## Slow Path Focus

The heaviest routes and views to watch first are:

- `team-profile`
- `team-compare`
- `data-super`
- `pre-event-scout`
- the main dashboard shell

When optimizing:

- preserve output shape first
- reuse shared upstream fetches
- compute shared derived structures once
- avoid recomputing heavy chart/table data for inactive tabs

## Raw Debugging

Raw payload troubleshooting intentionally lives at the bottom of `Settings`.

Primary surface:

- [components/RawPayloadExplorer.tsx](/c:/Users/ethan/Desktop/tbsb-dashboard/components/RawPayloadExplorer.tsx)

This is the preferred place to verify source payloads without disturbing the analytics-focused `DATA` tabs.
