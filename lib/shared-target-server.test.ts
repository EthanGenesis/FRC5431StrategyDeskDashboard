/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharedTargetServerMocks = vi.hoisted(() => ({
  loadHotCacheJson: vi.fn(),
  saveHotCacheJson: vi.fn(),
  deleteHotCacheKey: vi.fn(),
  getPostgresServerClient: vi.fn(),
  isSupabaseConfigured: vi.fn(),
  isSupabaseServiceConfigured: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  createSupabasePublicClient: vi.fn(),
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

vi.mock('./postgres-server', () => ({
  getPostgresServerClient: sharedTargetServerMocks.getPostgresServerClient,
}));

vi.mock('./supabase', () => ({
  isSupabaseConfigured: sharedTargetServerMocks.isSupabaseConfigured,
  isSupabaseServiceConfigured: sharedTargetServerMocks.isSupabaseServiceConfigured,
}));

vi.mock('./supabase-server', () => ({
  createSupabaseAdminClient: sharedTargetServerMocks.createSupabaseAdminClient,
  createSupabasePublicClient: sharedTargetServerMocks.createSupabasePublicClient,
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
import {
  loadSharedActiveTarget,
  loadSharedRefreshStatus,
  saveSharedActiveTarget,
} from './shared-target-server';

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
    sharedTargetServerMocks.getPostgresServerClient.mockReturnValue(null);
    sharedTargetServerMocks.isSupabaseConfigured.mockReturnValue(true);
    sharedTargetServerMocks.isSupabaseServiceConfigured.mockReturnValue(true);
    sharedTargetServerMocks.shouldBypassPersistence.mockReturnValue(false);
    sharedTargetServerMocks.upsert.mockResolvedValue({ error: null });
    sharedTargetServerMocks.from.mockReturnValue({
      upsert: sharedTargetServerMocks.upsert,
    });
    sharedTargetServerMocks.createSupabaseAdminClient.mockReturnValue({
      from: sharedTargetServerMocks.from,
    });
    sharedTargetServerMocks.createSupabasePublicClient.mockReturnValue({
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

  it('uses direct Postgres persistence when configured', async () => {
    const unsafe = vi.fn().mockResolvedValue([
      {
        workspace_key: 'shared',
        season_year: 2026,
        team_number: 5431,
        event_key: '2026txcle',
        event_name: 'FIT District Space City @ League City Event #1',
        event_short_name: 'Space City #1',
        event_location: 'League City, TX, USA',
        start_date: '2026-03-07',
        end_date: '2026-03-09',
        last_snapshot_generated_at: null,
        last_event_context_generated_at: null,
        last_team_catalog_generated_at: null,
        last_refreshed_at: null,
        refresh_state: 'idle',
        refresh_error: null,
        updated_at: '2026-04-02T00:00:00.000Z',
      },
    ]);
    sharedTargetServerMocks.getPostgresServerClient.mockReturnValue({
      unsafe,
    });
    sharedTargetServerMocks.isSupabaseServiceConfigured.mockReturnValue(false);

    const result = await saveSharedActiveTarget(
      {
        teamNumber: 5431,
        eventKey: '2026txcle',
        eventName: 'FIT District Space City @ League City Event #1',
        eventShortName: 'Space City #1',
        eventLocation: 'League City, TX, USA',
        startDate: '2026-03-07',
        endDate: '2026-03-09',
      },
      {
        baseTarget: EMPTY_SHARED_ACTIVE_TARGET,
        requirePersistence: true,
      },
    );

    expect(unsafe).toHaveBeenCalledTimes(1);
    expect(sharedTargetServerMocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(result.teamNumber).toBe(5431);
    expect(result.eventKey).toBe('2026txcle');
    expect(sharedTargetServerMocks.saveHotCacheJson).toHaveBeenCalled();
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

  it('falls back to the public Supabase client when the service role client is unavailable', async () => {
    sharedTargetServerMocks.isSupabaseServiceConfigured.mockReturnValue(false);

    const result = await saveSharedActiveTarget(
      {
        teamNumber: 5431,
        eventKey: '2026txcle',
        eventName: 'FIT District Space City @ League City Event #1',
      },
      {
        baseTarget: EMPTY_SHARED_ACTIVE_TARGET,
        requirePersistence: true,
      },
    );

    expect(sharedTargetServerMocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(sharedTargetServerMocks.createSupabasePublicClient).toHaveBeenCalled();
    expect(sharedTargetServerMocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        team_number: 5431,
        event_key: '2026txcle',
      }),
      { onConflict: 'workspace_key' },
    );
    expect(result.teamNumber).toBe(5431);
    expect(result.eventKey).toBe('2026txcle');
  });

  it('throws when durable persistence is required and no persistent client is configured', async () => {
    sharedTargetServerMocks.isSupabaseConfigured.mockReturnValue(false);
    sharedTargetServerMocks.isSupabaseServiceConfigured.mockReturnValue(false);

    await expect(
      saveSharedActiveTarget(
        {
          teamNumber: 5431,
          eventKey: '2026txcle',
        },
        {
          baseTarget: EMPTY_SHARED_ACTIVE_TARGET,
          requirePersistence: true,
        },
      ),
    ).rejects.toThrow('Shared active target persistence is unavailable.');
  });
});

describe('shared target read fallbacks', () => {
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
    sharedTargetServerMocks.shouldBypassPersistence.mockReturnValue(false);
    sharedTargetServerMocks.isSupabaseConfigured.mockReturnValue(true);
    sharedTargetServerMocks.isSupabaseServiceConfigured.mockReturnValue(false);
  });

  it('falls through to Supabase when Postgres shared-target reads fail', async () => {
    sharedTargetServerMocks.getPostgresServerClient.mockReturnValue({
      unsafe: vi.fn().mockRejectedValue(new Error('password authentication failed')),
    });

    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        error: null,
        data: {
          workspace_key: 'shared',
          season_year: 2026,
          team_number: 5431,
          event_key: '2026txcle',
          event_name: 'Space City @ League City #1',
          event_short_name: 'Space City #1',
          event_location: 'League City, TX, USA',
          start_date: '2026-03-07',
          end_date: '2026-03-09',
          last_snapshot_generated_at: null,
          last_event_context_generated_at: null,
          last_team_catalog_generated_at: null,
          last_refreshed_at: null,
          refresh_state: 'ready',
          refresh_error: null,
          updated_at: '2026-04-05T00:00:00.000Z',
        },
      }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);

    sharedTargetServerMocks.createSupabasePublicClient.mockReturnValue({
      from: vi.fn().mockReturnValue(query),
    });

    const result = await loadSharedActiveTarget();

    expect(result.teamNumber).toBe(5431);
    expect(result.eventKey).toBe('2026txcle');
    expect(sharedTargetServerMocks.markPersistenceSuccess).toHaveBeenCalled();
    expect(sharedTargetServerMocks.markPersistenceFailure).not.toHaveBeenCalled();
  });

  it('falls through to Supabase when Postgres refresh-status reads fail', async () => {
    sharedTargetServerMocks.getPostgresServerClient.mockReturnValue({
      unsafe: vi.fn().mockRejectedValue(new Error('password authentication failed')),
    });

    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        error: null,
        data: {
          workspace_key: 'shared',
          state: 'ready',
          last_run_at: '2026-04-05T00:00:00.000Z',
          last_success_at: '2026-04-05T00:00:00.000Z',
          last_error_at: null,
          last_error: null,
          detail: { source: 'test' },
          updated_at: '2026-04-05T00:00:00.000Z',
        },
      }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);

    sharedTargetServerMocks.createSupabasePublicClient.mockReturnValue({
      from: vi.fn().mockReturnValue(query),
    });

    const result = await loadSharedRefreshStatus();

    expect(result.state).toBe('ready');
    expect(result.detail).toEqual({ source: 'test' });
    expect(sharedTargetServerMocks.markPersistenceSuccess).toHaveBeenCalled();
    expect(sharedTargetServerMocks.markPersistenceFailure).not.toHaveBeenCalled();
  });
});
