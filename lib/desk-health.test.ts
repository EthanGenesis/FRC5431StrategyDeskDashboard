/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deskHealthMocks = vi.hoisted(() => ({
  isSupabaseServiceConfigured: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  listWarmBundleStatuses: vi.fn(),
  loadHotCacheJson: vi.fn(),
  loadSnapshotCacheRecord: vi.fn(),
}));

vi.mock('./supabase', () => ({
  isSupabaseServiceConfigured: deskHealthMocks.isSupabaseServiceConfigured,
}));

vi.mock('./supabase-server', () => ({
  createSupabaseAdminClient: deskHealthMocks.createSupabaseAdminClient,
}));

vi.mock('./bundle-cache-server', () => ({
  listWarmBundleStatuses: deskHealthMocks.listWarmBundleStatuses,
}));

vi.mock('./hot-cache-server', () => ({
  loadHotCacheJson: deskHealthMocks.loadHotCacheJson,
}));

vi.mock('./source-cache-server', () => ({
  loadSnapshotCacheRecord: deskHealthMocks.loadSnapshotCacheRecord,
}));

import { PERSISTENCE_TABLES } from './persistence-surfaces';
import { loadCacheInspectorSummary, loadDeskHealthSummary } from './desk-health';

function createThenableQuery(rows: unknown[]) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    then: (onfulfilled: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onfulfilled),
  };
  return query;
}

function mockAdminTables(rowsByTable: Partial<Record<string, unknown[]>>) {
  deskHealthMocks.createSupabaseAdminClient.mockReturnValue({
    from: (table: string) => createThenableQuery(rowsByTable[table] ?? []),
  });
}

describe('desk-health summaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deskHealthMocks.isSupabaseServiceConfigured.mockReturnValue(true);
    deskHealthMocks.listWarmBundleStatuses.mockResolvedValue([]);
    deskHealthMocks.loadHotCacheJson.mockResolvedValue({
      value: null,
      layer: null,
      isStale: false,
      etag: null,
      savedAt: null,
      freshUntil: null,
      staleUntil: null,
      meta: {},
    });
    deskHealthMocks.loadSnapshotCacheRecord.mockResolvedValue(null);
    mockAdminTables({});
  });

  it('summarizes warm surfaces across hot cache, persisted snapshots, and bundles', async () => {
    mockAdminTables({
      [PERSISTENCE_TABLES.snapshotCache]: [
        {
          source: 'snapshot',
          generated_at: '2026-04-05T00:00:00.000Z',
          updated_at: '2026-04-05T00:00:05.000Z',
        },
        {
          source: 'pit_ops',
          generated_at: '2026-04-05T00:01:00.000Z',
          updated_at: '2026-04-05T00:01:05.000Z',
        },
      ],
    });
    deskHealthMocks.loadHotCacheJson
      .mockResolvedValueOnce({
        value: { ok: true },
        layer: 'memory',
        isStale: false,
        etag: 'boot',
        savedAt: '2026-04-05T00:00:00.000Z',
        freshUntil: '2026-04-05T00:00:10.000Z',
        staleUntil: '2026-04-05T00:01:00.000Z',
        meta: {},
      })
      .mockResolvedValueOnce({
        value: { ok: true },
        layer: 'memory',
        isStale: false,
        etag: 'target',
        savedAt: '2026-04-05T00:00:00.000Z',
        freshUntil: '2026-04-05T00:00:10.000Z',
        staleUntil: '2026-04-05T00:01:00.000Z',
        meta: {},
      })
      .mockResolvedValueOnce({
        value: null,
        layer: null,
        isStale: false,
        etag: null,
        savedAt: null,
        freshUntil: null,
        staleUntil: null,
        meta: {},
      })
      .mockResolvedValueOnce({
        value: { generatedAtMs: 1 },
        layer: 'memory',
        isStale: false,
        etag: 'snapshot',
        savedAt: '2026-04-05T00:00:00.000Z',
        freshUntil: '2026-04-05T00:00:10.000Z',
        staleUntil: '2026-04-05T00:01:00.000Z',
        meta: {},
      });
    deskHealthMocks.listWarmBundleStatuses.mockResolvedValue([
      {
        bundleKey: 'pick_list_bundle:2026txcle:5431',
        source: 'pick_list_bundle',
        state: 'ready',
        generatedAt: '2026-04-05T00:00:00.000Z',
        updatedAt: '2026-04-05T00:00:05.000Z',
        error: null,
        meta: {
          cacheLayer: 'memory',
          etag: 'pick-list-etag',
          freshUntil: '2026-04-05T00:00:10.000Z',
          staleAt: '2026-04-05T00:01:00.000Z',
        },
      },
    ]);

    const response = await loadCacheInspectorSummary({
      workspaceKey: 'event:2026txcle',
      eventKey: '2026txcle',
      teamNumber: 5431,
    });

    expect(response.surfaces.find((surface) => surface.id === 'bootstrap')?.state).toBe('ready');
    expect(response.surfaces.find((surface) => surface.id === 'pit_ops')?.state).toBe('persisted');
    expect(
      response.surfaces.find((surface) => surface.bundleKey === 'pick_list_bundle:2026txcle:5431')
        ?.kind,
    ).toBe('bundle');
  });

  it('aggregates route performance, parity, and warm-surface problems', async () => {
    mockAdminTables({
      [PERSISTENCE_TABLES.perfSamples]: [
        {
          route_key: '/api/snapshot',
          status_code: 200,
          duration_ms: 120,
          cache_state: 'warm',
          meta: {},
          created_at: '2026-04-05T00:00:00.000Z',
        },
        {
          route_key: '/api/snapshot',
          status_code: 500,
          duration_ms: 510,
          cache_state: 'cold',
          meta: { error: 'timeout' },
          created_at: '2026-04-05T00:00:02.000Z',
        },
        {
          route_key: '/api/team-profile',
          status_code: 200,
          duration_ms: 80,
          cache_state: 'warm',
          meta: {},
          created_at: '2026-04-05T00:00:03.000Z',
        },
      ],
      [PERSISTENCE_TABLES.parityAuditLog]: [
        { status: 'match', created_at: '2026-04-05T00:00:00.000Z' },
        { status: 'diff', created_at: '2026-04-05T00:00:01.000Z' },
      ],
    });
    deskHealthMocks.listWarmBundleStatuses.mockResolvedValue([
      {
        bundleKey: 'snapshot_bundle',
        source: 'snapshot',
        state: 'ready',
        generatedAt: '2026-04-05T00:00:00.000Z',
        updatedAt: '2026-04-05T00:00:01.000Z',
        error: null,
        meta: {},
      },
      {
        bundleKey: 'pit_ops_bundle',
        source: 'pit_ops',
        state: 'error',
        generatedAt: '2026-04-05T00:00:00.000Z',
        updatedAt: '2026-04-05T00:00:01.000Z',
        error: 'stale',
        meta: {},
      },
    ]);
    deskHealthMocks.loadSnapshotCacheRecord.mockResolvedValue({
      validation: {
        firstStatus: 'available',
        officialAvailability: 'full',
        discrepancies: [{ status: 'mismatch' }],
        staleSeconds: 9,
        summary: 'Mostly aligned',
      },
    });

    const response = await loadDeskHealthSummary({
      workspaceKey: 'event:2026txcle',
      eventKey: '2026txcle',
      teamNumber: 5431,
      refreshState: 'ready',
      lastSuccessAt: '2026-04-05T00:00:05.000Z',
    });

    expect(response.refreshState).toBe('ready');
    expect(
      response.routeSummaries.find((row) => row.routeKey === '/api/snapshot')?.errorCount,
    ).toBe(1);
    expect(response.recentFailures[0]?.detail).toBe('timeout');
    expect(response.paritySummary.diff).toBe(1);
    expect(response.sourceTrust?.summary).toBe('Mostly aligned');
    expect(response.staleOrErrorSurfaces[0]?.source).toBe('pit_ops');
  });
});
