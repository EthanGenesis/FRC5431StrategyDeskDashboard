/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharedTargetServerMocks = vi.hoisted(() => ({
  loadHotCacheJson: vi.fn(),
  saveHotCacheJson: vi.fn(),
  deleteHotCacheKey: vi.fn(),
  isSupabaseServiceConfigured: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  markPersistenceFailure: vi.fn(),
  markPersistenceSuccess: vi.fn(),
  shouldBypassPersistence: vi.fn(),
  fetchTeamEventCatalog: vi.fn(),
  upsert: vi.fn(),
  from: vi.fn(),
}));

vi.mock('./hot-cache-server', () => ({
  loadHotCacheJson: sharedTargetServerMocks.loadHotCacheJson,
  saveHotCacheJson: sharedTargetServerMocks.saveHotCacheJson,
  deleteHotCacheKey: sharedTargetServerMocks.deleteHotCacheKey,
}));

vi.mock('./supabase', () => ({
  isSupabaseServiceConfigured: sharedTargetServerMocks.isSupabaseServiceConfigured,
}));

vi.mock('./supabase-server', () => ({
  createSupabaseAdminClient: sharedTargetServerMocks.createSupabaseAdminClient,
}));

vi.mock('./persistence-circuit-breaker', () => ({
  markPersistenceFailure: sharedTargetServerMocks.markPersistenceFailure,
  markPersistenceSuccess: sharedTargetServerMocks.markPersistenceSuccess,
  shouldBypassPersistence: sharedTargetServerMocks.shouldBypassPersistence,
}));

vi.mock('./team-event-catalog', () => ({
  fetchTeamEventCatalog: sharedTargetServerMocks.fetchTeamEventCatalog,
}));

import { PERSISTENCE_TABLES } from './persistence-surfaces';
import { EMPTY_SHARED_ACTIVE_TARGET } from './shared-target';
import { saveSharedActiveTarget } from './shared-target-server';

describe('saveSharedActiveTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedTargetServerMocks.loadHotCacheJson.mockResolvedValue({
      value: null,
      layer: null,
      isStale: false,
      etag: null,
      savedAt: null,
      freshUntil: null,
      staleUntil: null,
      meta: {},
    });
    sharedTargetServerMocks.saveHotCacheJson.mockResolvedValue({
      value: null,
      layer: 'memory',
      isStale: false,
      etag: 'etag',
      savedAt: null,
      freshUntil: null,
      staleUntil: null,
      meta: {},
    });
    sharedTargetServerMocks.deleteHotCacheKey.mockResolvedValue(undefined);
    sharedTargetServerMocks.isSupabaseServiceConfigured.mockReturnValue(true);
    sharedTargetServerMocks.shouldBypassPersistence.mockReturnValue(false);
    sharedTargetServerMocks.upsert.mockResolvedValue({ error: null });
    sharedTargetServerMocks.from.mockReturnValue({
      upsert: sharedTargetServerMocks.upsert,
    });
    sharedTargetServerMocks.createSupabaseAdminClient.mockReturnValue({
      from: sharedTargetServerMocks.from,
    });
  });

  it('keeps the selected target when saving refresh-only updates with a provided base target', async () => {
    const baseTarget = {
      ...EMPTY_SHARED_ACTIVE_TARGET,
      teamNumber: 5431,
      eventKey: '2026txcle',
      eventName: 'FIT District Space City @ League City Event #1',
      eventShortName: 'Space City #1',
      eventLocation: 'League City, TX, USA',
      startDate: '2026-03-07',
      endDate: '2026-03-09',
      refreshState: 'idle' as const,
    };

    const result = await saveSharedActiveTarget(
      {
        refreshState: 'loading',
        refreshError: null,
      },
      {
        baseTarget,
      },
    );

    expect(sharedTargetServerMocks.from).toHaveBeenCalledWith(PERSISTENCE_TABLES.activeTarget);
    expect(sharedTargetServerMocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        team_number: 5431,
        event_key: '2026txcle',
        event_name: 'FIT District Space City @ League City Event #1',
        refresh_state: 'loading',
      }),
      { onConflict: 'workspace_key' },
    );
    expect(result.teamNumber).toBe(5431);
    expect(result.eventKey).toBe('2026txcle');
    expect(result.refreshState).toBe('loading');
  });

  it('throws instead of faking success when durable persistence is required and the write fails', async () => {
    sharedTargetServerMocks.upsert.mockResolvedValue({
      error: {
        message: 'write failed',
      },
    });

    await expect(
      saveSharedActiveTarget(
        {
          teamNumber: 5431,
          eventKey: '2026txcle',
          eventName: 'FIT District Space City @ League City Event #1',
        },
        {
          baseTarget: EMPTY_SHARED_ACTIVE_TARGET,
          requirePersistence: true,
        },
      ),
    ).rejects.toThrow('write failed');

    expect(sharedTargetServerMocks.saveHotCacheJson).not.toHaveBeenCalled();
  });
});
