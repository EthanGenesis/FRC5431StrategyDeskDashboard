'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  CACHE_REFRESH_SURFACE_LABELS,
  CACHE_REFRESH_SURFACES,
  type CacheRefreshSurfaceId,
} from '../lib/cache-surfaces';
import { fetchJsonOrThrow } from '../lib/httpCache';
import type {
  CacheInspectorResponse,
  CacheRefreshResponse,
  DeskHealthResponse,
} from '../lib/types';
import DisclosureSection from './ui/DisclosureSection';

type DeskHealthPanelProps = {
  eventKey?: string;
  teamNumber?: number | null;
  externalUpdateKey?: number;
};

function fmtMs(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return '-';
  return `${Math.round(Number(value))}ms`;
}

function fmtTimestamp(value: number | string | null | undefined): string {
  if (!value) return '-';
  const parsed = typeof value === 'string' ? Date.parse(value) : Number(value);
  if (!Number.isFinite(parsed)) return '-';
  return new Date(parsed).toLocaleString();
}

export default function DeskHealthPanel({
  eventKey = '',
  teamNumber = null,
  externalUpdateKey = 0,
}: DeskHealthPanelProps) {
  const [health, setHealth] = useState<DeskHealthResponse | null>(null);
  const [inspector, setInspector] = useState<CacheInspectorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [refreshingSurfaces, setRefreshingSurfaces] = useState<string[]>([]);
  const [refreshResultText, setRefreshResultText] = useState('');

  const loadAll = useCallback(async () => {
    if (!eventKey || !teamNumber) {
      setHealth(null);
      setInspector(null);
      return;
    }
    setLoading(true);
    setErrorText('');
    try {
      const params = new URLSearchParams({ eventKey, team: String(teamNumber) });
      const [nextHealth, nextInspector] = await Promise.all([
        fetchJsonOrThrow<DeskHealthResponse>(
          `/api/desk-health?${params.toString()}`,
          { cache: 'default' },
          'Desk health failed',
        ),
        fetchJsonOrThrow<CacheInspectorResponse>(
          `/api/cache-inspector?${params.toString()}`,
          { cache: 'default' },
          'Cache inspector failed',
        ),
      ]);
      setHealth(nextHealth);
      setInspector(nextInspector);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unknown desk health error');
      setHealth(null);
      setInspector(null);
    } finally {
      setLoading(false);
    }
  }, [eventKey, teamNumber]);

  useEffect(() => {
    void loadAll();
  }, [externalUpdateKey, loadAll]);

  const refreshSurfaces = useCallback(
    async (surfaces: CacheRefreshSurfaceId[]) => {
      if (!eventKey || !teamNumber || !surfaces.length) return;
      setRefreshingSurfaces(surfaces);
      setRefreshResultText('');
      try {
        const response = await fetchJsonOrThrow<CacheRefreshResponse>(
          '/api/cache-refresh',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventKey,
              team: teamNumber,
              surfaces,
            }),
          },
          'Cache refresh failed',
        );
        const failures = response.results.filter((result) => !result.ok);
        setRefreshResultText(
          failures.length
            ? `${failures.length} surface refreshes failed.`
            : `Refreshed ${response.results.length} surface${response.results.length === 1 ? '' : 's'}.`,
        );
        await loadAll();
      } catch (error) {
        setRefreshResultText(error instanceof Error ? error.message : 'Cache refresh failed');
      } finally {
        setRefreshingSurfaces([]);
      }
    },
    [eventKey, loadAll, teamNumber],
  );

  const surfaceStateMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const surface of inspector?.surfaces ?? []) {
      if (!map.has(surface.source)) {
        map.set(surface.source, surface.state ?? surface.cacheState ?? '-');
      }
    }
    return map;
  }, [inspector?.surfaces]);

  return (
    <DisclosureSection
      storageKey="ui.settings.desk_health"
      title="Desk Health"
      description="Route latency, parity, warm-surface state, and one-click refresh controls."
      defaultOpen
    >
      <div className="stack-12">
        <div className="grid-4">
          <div className="panel" style={{ padding: 16 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Refresh State
            </div>
            <div style={{ fontWeight: 900, marginTop: 6 }}>
              {health?.refreshState?.toUpperCase() ?? '-'}
            </div>
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              Last success {fmtTimestamp(health?.lastSuccessAt)}
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Source Trust
            </div>
            <div style={{ fontWeight: 900, marginTop: 6 }}>
              FIRST {health?.sourceTrust?.firstStatus ?? '-'}
            </div>
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              {health?.sourceTrust?.summary ?? 'No validation summary yet.'}
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Recent Route Failures
            </div>
            <div style={{ fontWeight: 900, marginTop: 6 }}>
              {health?.recentFailures?.length ?? 0}
            </div>
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              Parity diffs {health?.paritySummary?.diff ?? 0} | Errors{' '}
              {health?.paritySummary?.error ?? 0}
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Warm Surface Issues
            </div>
            <div style={{ fontWeight: 900, marginTop: 6 }}>
              {health?.staleOrErrorSurfaces?.length ?? 0}
            </div>
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              Ready bundles {health?.bundleStateCounts?.ready ?? 0} | Loading{' '}
              {health?.bundleStateCounts?.loading ?? 0}
            </div>
          </div>
        </div>

        <div className="panel" style={{ padding: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
              marginBottom: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 900 }}>Warm Controls</div>
              <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                Refresh the warm surfaces without changing any route contracts.
              </div>
            </div>
            <button
              className="button button-primary"
              type="button"
              onClick={() => void refreshSurfaces([...CACHE_REFRESH_SURFACES])}
              disabled={Boolean(refreshingSurfaces.length)}
            >
              {refreshingSurfaces.length ? 'Refreshing...' : 'Refresh Everything'}
            </button>
          </div>
          <div className="grid-3">
            {CACHE_REFRESH_SURFACES.map((surface) => {
              const refreshing = refreshingSurfaces.includes(surface);
              return (
                <div key={surface} className="panel-2" style={{ padding: 12 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {CACHE_REFRESH_SURFACE_LABELS[surface]}
                  </div>
                  <div style={{ fontWeight: 900, marginTop: 6 }}>
                    {surfaceStateMap.get(surface.replace(/-/g, '_')) ??
                      surfaceStateMap.get(surface) ??
                      '-'}
                  </div>
                  <button
                    className="button"
                    type="button"
                    style={{ marginTop: 10 }}
                    onClick={() => void refreshSurfaces([surface])}
                    disabled={refreshing}
                  >
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
              );
            })}
          </div>
          {refreshResultText ? (
            <div className="muted" style={{ marginTop: 12 }}>
              {refreshResultText}
            </div>
          ) : null}
        </div>

        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Route Performance</div>
            <div style={{ overflow: 'auto', maxHeight: 360 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Route</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>p50</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>p95</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Errors</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Latest</th>
                  </tr>
                </thead>
                <tbody>
                  {(health?.routeSummaries ?? []).slice(0, 18).map((row) => (
                    <tr key={row.routeKey}>
                      <td
                        style={{ padding: 8, borderBottom: '1px solid #1a2333', fontWeight: 700 }}
                      >
                        {row.routeKey}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {fmtMs(row.p50Ms)}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {fmtMs(row.p95Ms)}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.errorCount}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.latestStatusCode ?? '-'}{' '}
                        {row.latestCacheState ? `| ${row.latestCacheState}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Recent Failures</div>
            <div className="stack-8" style={{ maxHeight: 360, overflow: 'auto' }}>
              {(health?.recentFailures ?? []).map((row) => (
                <div
                  key={`${row.routeKey}_${row.createdAtMs}`}
                  className="panel-2"
                  style={{ padding: 10 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 800 }}>{row.routeKey}</div>
                    <div className="muted mono" style={{ fontSize: 11 }}>
                      {row.statusCode} | {fmtMs(row.durationMs)}
                    </div>
                  </div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    {row.cacheState ? `${row.cacheState} | ` : ''}
                    {fmtTimestamp(row.createdAtMs)}
                  </div>
                  {row.detail ? (
                    <div className="muted" style={{ marginTop: 6 }}>
                      {row.detail}
                    </div>
                  ) : null}
                </div>
              ))}
              {!health?.recentFailures?.length ? (
                <div className="muted">No recent route failures.</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Cache Inspector</div>
          <div style={{ overflow: 'auto', maxHeight: 420 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Surface</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Kind</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>State</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Layer</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Generated</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Fresh Until</th>
                </tr>
              </thead>
              <tbody>
                {(inspector?.surfaces ?? []).map((surface) => (
                  <tr key={`${surface.kind}_${surface.id}`}>
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333', fontWeight: 700 }}>
                      {surface.label}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                      {surface.kind}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                      {surface.state ?? surface.cacheState ?? '-'}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                      {surface.cacheLayer ?? '-'}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                      {fmtTimestamp(surface.generatedAt)}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                      {fmtTimestamp(surface.freshUntil)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {loading ? <div className="muted">Loading desk health...</div> : null}
        {errorText ? <div className="badge badge-red">{errorText}</div> : null}
      </div>
    </DisclosureSection>
  );
}
