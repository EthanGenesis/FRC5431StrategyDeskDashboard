import { createSupabaseAdminClient } from './supabase-server';
import { isSupabaseServiceConfigured } from './supabase';
import { PERSISTENCE_TABLES, SHARED_WORKSPACE_KEY } from './persistence-surfaces';
import { listWarmBundleStatuses } from './bundle-cache-server';
import {
  buildActiveTargetHotCacheKey,
  buildBootstrapHotCacheKey,
  buildRefreshStatusHotCacheKey,
  buildSnapshotHotCacheKey,
} from './hot-cache-keys';
import { loadHotCacheJson } from './hot-cache-server';
import { loadSnapshotCacheRecord } from './source-cache-server';
import type {
  AppSnapshot,
  CacheInspectorResponse,
  CacheInspectorSurface,
  DeskHealthRecentFailure,
  DeskHealthResponse,
  DeskHealthRouteSummary,
} from './types';
import { summarizeSourceTrust } from './workspace-collab';

const DESK_HEALTH_QUERY_LIMIT = 300;

type PerfSampleRow = {
  route_key: string;
  status_code: number;
  duration_ms: number;
  cache_state: string | null;
  meta: Record<string, unknown> | null;
  created_at: string | null;
};

type ParityAuditRow = {
  status: 'match' | 'diff' | 'error' | 'skipped';
  created_at: string | null;
};

type SnapshotCacheRow = {
  source: string;
  generated_at: string | null;
  updated_at: string | null;
};

function getAdminClient() {
  if (!isSupabaseServiceConfigured()) return null;
  return createSupabaseAdminClient();
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readTimestampMs(value: unknown): number | null {
  const parsed =
    typeof value === 'string' || value instanceof Date ? Date.parse(String(value)) : Number(value);
  return Number.isFinite(parsed) ? Number(parsed) : null;
}

function percentile(sortedValues: number[], percentileValue: number): number | null {
  if (!sortedValues.length) return null;
  const clamped = Math.min(1, Math.max(0, percentileValue));
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * clamped) - 1),
  );
  return sortedValues[index] ?? null;
}

function summarizeRouteSamples(rows: PerfSampleRow[]): DeskHealthRouteSummary[] {
  const grouped = new Map<string, PerfSampleRow[]>();
  for (const row of rows) {
    const routeKey = readString(row.route_key);
    if (!routeKey) continue;
    const current = grouped.get(routeKey) ?? [];
    current.push(row);
    grouped.set(routeKey, current);
  }

  return [...grouped.entries()]
    .map(([routeKey, sampleRows]) => {
      const durations = sampleRows
        .map((row) => Math.max(0, Math.floor(Number(row.duration_ms) || 0)))
        .sort((left, right) => left - right);
      const latest =
        [...sampleRows].sort(
          (left, right) =>
            Number(readTimestampMs(right.created_at) ?? 0) -
            Number(readTimestampMs(left.created_at) ?? 0),
        )[0] ?? null;
      return {
        routeKey,
        sampleCount: sampleRows.length,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        errorCount: sampleRows.filter((row) => Number(row.status_code) >= 400).length,
        latestStatusCode: latest ? Math.max(0, Math.floor(Number(latest.status_code) || 0)) : null,
        latestCacheState: latest ? readString(latest.cache_state) || null : null,
        latestAtMs: latest ? readTimestampMs(latest.created_at) : null,
      };
    })
    .sort((left, right) => {
      const leftErrorWeight = left.errorCount > 0 ? 1 : 0;
      const rightErrorWeight = right.errorCount > 0 ? 1 : 0;
      if (leftErrorWeight !== rightErrorWeight) return rightErrorWeight - leftErrorWeight;
      return Number(right.p95Ms ?? -1) - Number(left.p95Ms ?? -1);
    });
}

async function loadPerfSamples(
  workspaceKey: string,
  eventKey: string | null,
  teamNumber: number | null,
): Promise<PerfSampleRow[]> {
  const admin = getAdminClient();
  if (!admin) return [];

  let query = admin
    .from(PERSISTENCE_TABLES.perfSamples)
    .select('route_key,status_code,duration_ms,cache_state,meta,created_at')
    .eq('workspace_key', workspaceKey)
    .order('created_at', { ascending: false })
    .limit(DESK_HEALTH_QUERY_LIMIT);

  if (eventKey) query = query.eq('event_key', eventKey);
  if (teamNumber != null) query = query.eq('team_number', teamNumber);

  const response = await query;
  if (response.error || !Array.isArray(response.data)) return [];
  return response.data as PerfSampleRow[];
}

async function loadParityAudits(
  workspaceKey: string,
  eventKey: string | null,
  teamNumber: number | null,
): Promise<ParityAuditRow[]> {
  const admin = getAdminClient();
  if (!admin) return [];

  let query = admin
    .from(PERSISTENCE_TABLES.parityAuditLog)
    .select('status,created_at')
    .eq('workspace_key', workspaceKey)
    .order('created_at', { ascending: false })
    .limit(DESK_HEALTH_QUERY_LIMIT);

  if (eventKey) query = query.eq('event_key', eventKey);
  if (teamNumber != null) query = query.eq('team_number', teamNumber);

  const response = await query;
  if (response.error || !Array.isArray(response.data)) return [];
  return response.data as ParityAuditRow[];
}

async function loadSnapshotRows(
  eventKey: string | null,
  teamNumber: number | null,
): Promise<SnapshotCacheRow[]> {
  const admin = getAdminClient();
  if (!admin || !eventKey || teamNumber == null) return [];

  const response = await admin
    .from(PERSISTENCE_TABLES.snapshotCache)
    .select('source,generated_at,updated_at')
    .eq('event_key', eventKey)
    .eq('team_number', teamNumber)
    .order('updated_at', { ascending: false });

  if (response.error || !Array.isArray(response.data)) return [];
  return response.data as SnapshotCacheRow[];
}

function buildHotSurface(
  id: string,
  label: string,
  source: string,
  lookup: Awaited<ReturnType<typeof loadHotCacheJson>>,
): CacheInspectorSurface {
  return {
    id,
    label,
    source,
    kind: 'hot',
    state: lookup.value ? (lookup.isStale ? 'stale' : 'ready') : 'missing',
    cacheLayer: lookup.layer ?? null,
    cacheState: lookup.value ? (lookup.isStale ? 'stale' : 'hot') : 'missing',
    bundleKey: null,
    etag: lookup.etag ?? null,
    generatedAt: lookup.savedAt ?? null,
    updatedAt: lookup.savedAt ?? null,
    freshUntil: lookup.freshUntil ?? null,
    staleUntil: lookup.staleUntil ?? null,
    error: null,
  };
}

export async function loadCacheInspectorSummary(input: {
  workspaceKey: string;
  eventKey: string | null;
  teamNumber: number | null;
}): Promise<CacheInspectorResponse> {
  const { workspaceKey, eventKey, teamNumber } = input;
  const [bootstrapLookup, activeTargetLookup, refreshStatusLookup, bundleStatuses, snapshotRows] =
    await Promise.all([
      loadHotCacheJson(buildBootstrapHotCacheKey(workspaceKey)),
      loadHotCacheJson(buildActiveTargetHotCacheKey(workspaceKey)),
      loadHotCacheJson(buildRefreshStatusHotCacheKey(workspaceKey)),
      listWarmBundleStatuses(workspaceKey).catch(() => []),
      loadSnapshotRows(eventKey, teamNumber),
    ]);

  const surfaces: CacheInspectorSurface[] = [
    buildHotSurface('bootstrap', 'Bootstrap', 'bootstrap', bootstrapLookup),
    buildHotSurface('active_target', 'Active Target', 'active_target', activeTargetLookup),
    buildHotSurface('refresh_status', 'Refresh Status', 'refresh_status', refreshStatusLookup),
  ];

  const snapshotSources = [
    ['snapshot', 'Snapshot'],
    ['desk_ops', 'Desk Ops'],
    ['team_dossier', 'Team Dossier'],
    ['pit_ops', 'Pit Mode'],
  ] as const;

  for (const [source, label] of snapshotSources) {
    const lookup = await loadHotCacheJson(buildSnapshotHotCacheKey(source, eventKey, teamNumber));
    const persisted = snapshotRows.find((row) => readString(row.source) === source) ?? null;
    surfaces.push({
      id: source,
      label,
      source,
      kind: 'snapshot',
      state: lookup.value
        ? lookup.isStale
          ? 'stale'
          : 'ready'
        : persisted
          ? 'persisted'
          : 'missing',
      cacheLayer: lookup.layer ?? null,
      cacheState: lookup.value
        ? lookup.isStale
          ? 'stale'
          : 'hot'
        : persisted
          ? 'persisted'
          : 'missing',
      bundleKey: null,
      etag: lookup.etag ?? null,
      generatedAt: persisted?.generated_at ?? lookup.savedAt ?? null,
      updatedAt: persisted?.updated_at ?? lookup.savedAt ?? null,
      freshUntil: lookup.freshUntil ?? null,
      staleUntil: lookup.staleUntil ?? null,
      error: null,
    });
  }

  for (const status of bundleStatuses) {
    surfaces.push({
      id: status.bundleKey,
      label: status.source,
      source: status.source,
      kind: 'bundle',
      state: status.state,
      cacheLayer: readString(status.meta?.cacheLayer) || null,
      cacheState: readString(status.meta?.cacheLayer) || status.state,
      bundleKey: status.bundleKey,
      etag: readString(status.meta?.etag) || null,
      generatedAt: status.generatedAt,
      updatedAt: status.updatedAt,
      freshUntil: readString(status.meta?.freshUntil) || null,
      staleUntil: readString(status.meta?.staleAt) || null,
      error: status.error,
    });
  }

  return {
    generatedAtMs: Date.now(),
    workspaceKey,
    eventKey,
    teamNumber,
    surfaces,
  };
}

export async function loadDeskHealthSummary(input: {
  workspaceKey: string;
  eventKey: string | null;
  teamNumber: number | null;
  refreshState: string | null;
  lastSuccessAt: string | null;
}): Promise<DeskHealthResponse> {
  const { workspaceKey, eventKey, teamNumber, refreshState, lastSuccessAt } = input;
  const [perfSamples, parityAudits, bundleStatuses, snapshot] = await Promise.all([
    loadPerfSamples(workspaceKey, eventKey, teamNumber),
    loadParityAudits(workspaceKey, eventKey, teamNumber),
    listWarmBundleStatuses(workspaceKey).catch(() => []),
    eventKey && teamNumber != null
      ? loadSnapshotCacheRecord<AppSnapshot>('snapshot', eventKey, teamNumber, 180).catch(
          () => null,
        )
      : Promise.resolve(null),
  ]);

  const routeSummaries = summarizeRouteSamples(perfSamples);
  const recentFailures: DeskHealthRecentFailure[] = perfSamples
    .filter((row) => Number(row.status_code) >= 400)
    .slice(0, 12)
    .map((row) => ({
      routeKey: readString(row.route_key),
      statusCode: Math.max(0, Math.floor(Number(row.status_code) || 0)),
      durationMs: Math.max(0, Math.floor(Number(row.duration_ms) || 0)),
      cacheState: readString(row.cache_state) || null,
      createdAtMs: readTimestampMs(row.created_at),
      detail: readString(row.meta?.error) || readString(row.meta?.detail) || null,
    }));

  const bundleStateCounts = bundleStatuses.reduce<Record<string, number>>((accumulator, row) => {
    const key = readString(row.state) || 'unknown';
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});

  const cacheStateCounts = perfSamples.reduce<Record<string, number>>((accumulator, row) => {
    const key = readString(row.cache_state) || 'none';
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});

  const paritySummary = parityAudits.reduce<Record<'match' | 'diff' | 'error' | 'skipped', number>>(
    (accumulator, row) => {
      const key = row.status;
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    },
    {
      match: 0,
      diff: 0,
      error: 0,
      skipped: 0,
    },
  );

  const staleOrErrorSurfaces = bundleStatuses
    .filter((row) => row.state !== 'ready' || Boolean(row.error))
    .map((row) => ({
      source: row.source,
      state: row.state,
      generatedAt: row.generatedAt,
      updatedAt: row.updatedAt,
      error: row.error,
    }))
    .slice(0, 16);

  return {
    generatedAtMs: Date.now(),
    workspaceKey: workspaceKey || SHARED_WORKSPACE_KEY,
    eventKey,
    teamNumber,
    refreshState,
    lastSuccessAt,
    sourceTrust: summarizeSourceTrust(snapshot?.validation ?? null),
    bundleStateCounts,
    cacheStateCounts,
    paritySummary,
    recentFailures,
    routeSummaries,
    staleOrErrorSurfaces,
  };
}
