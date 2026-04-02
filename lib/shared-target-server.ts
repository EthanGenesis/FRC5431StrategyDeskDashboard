import {
  buildActiveTargetHotCacheKey,
  buildBootstrapHotCacheKey,
  buildRefreshStatusHotCacheKey,
  buildTeamEventCatalogHotCacheKey,
} from './hot-cache-keys';
import { deleteHotCacheKey, loadHotCacheJson, saveHotCacheJson } from './hot-cache-server';
import {
  markPersistenceFailure,
  markPersistenceSuccess,
  shouldBypassPersistence,
} from './persistence-circuit-breaker';
import { PERSISTENCE_TABLES } from './persistence-surfaces';
import { isSupabaseServiceConfigured } from './supabase';
import { createSupabaseAdminClient } from './supabase-server';
import {
  ACTIVE_TARGET_SEASON_YEAR,
  ACTIVE_TARGET_WORKSPACE_KEY,
  EMPTY_SHARED_ACTIVE_TARGET,
  EMPTY_SHARED_REFRESH_STATUS,
  TEAM_EVENT_CATALOG_MAX_AGE_MS,
  normalizeSharedActiveTarget,
  normalizeSharedRefreshStatus,
  normalizeTeamEventCatalog,
  type SharedActiveTarget,
  type SharedRefreshStatus,
  type TeamEventCatalogEntry,
} from './shared-target';
import { fetchTeamEventCatalog } from './team-event-catalog';

const SUPABASE_READ_TIMEOUT_MS = 5000;
const SUPABASE_WRITE_TIMEOUT_MS = 5000;
const DURABLE_SHARED_TARGET_WRITE_TIMEOUT_MS = 12000;
const ACTIVE_TARGET_HOT_CACHE_FRESH_SECONDS = 5;
const ACTIVE_TARGET_HOT_CACHE_STALE_SECONDS = 30;
const SHARED_TARGET_READ_SCOPE = 'shared-target-read';
const SHARED_TARGET_WRITE_SCOPE = 'shared-target-write';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type TeamEventCatalogResult = {
  generatedAt: string;
  cached: boolean;
  events: TeamEventCatalogEntry[];
};

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNullableString(value: unknown): string | null {
  const normalized = readString(value);
  return normalized || null;
}

function readPositiveInteger(value: unknown): number | null {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

async function withTimeout<T>(
  promise: PromiseLike<T>,
  label: string,
  timeoutMs = SUPABASE_READ_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function getAdminClient(): AdminClient | null {
  if (!isSupabaseServiceConfigured()) return null;
  return createSupabaseAdminClient();
}

function logSharedTargetPersistenceWarning(event: string, detail: string): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      event,
      ts: new Date().toISOString(),
      detail,
    }),
  );
}

async function withWriteTimeout<T>(
  operation: () => PromiseLike<T> | T,
  label: string,
  timeoutMs = SUPABASE_WRITE_TIMEOUT_MS,
): Promise<T> {
  return withTimeout(Promise.resolve(operation()), label, timeoutMs);
}

async function saveSharedActiveTargetHotCache(target: SharedActiveTarget): Promise<void> {
  await saveHotCacheJson(buildActiveTargetHotCacheKey(ACTIVE_TARGET_WORKSPACE_KEY), target, {
    freshForSeconds: ACTIVE_TARGET_HOT_CACHE_FRESH_SECONDS,
    staleForSeconds: ACTIVE_TARGET_HOT_CACHE_STALE_SECONDS,
  });
}

async function invalidateBootstrapHotCache(): Promise<void> {
  await deleteHotCacheKey(buildBootstrapHotCacheKey(ACTIVE_TARGET_WORKSPACE_KEY));
}

function activeTargetRowFromTarget(
  target: SharedActiveTarget,
): Record<string, string | number | null> {
  return {
    workspace_key: target.workspaceKey,
    season_year: target.seasonYear,
    team_number: target.teamNumber,
    event_key: target.eventKey || null,
    event_name: target.eventName || '',
    event_short_name: target.eventShortName || '',
    event_location: target.eventLocation || '',
    start_date: target.startDate,
    end_date: target.endDate,
    last_snapshot_generated_at: target.lastSnapshotGeneratedAt,
    last_event_context_generated_at: target.lastEventContextGeneratedAt,
    last_team_catalog_generated_at: target.lastTeamCatalogGeneratedAt,
    last_refreshed_at: target.lastRefreshedAt,
    refresh_state: target.refreshState,
    refresh_error: target.refreshError,
    updated_at: new Date().toISOString(),
  };
}

function refreshStatusRowFromStatus(
  status: SharedRefreshStatus,
): Record<string, string | Record<string, unknown> | null> {
  return {
    workspace_key: status.workspaceKey,
    state: status.state,
    last_run_at: status.lastRunAt,
    last_success_at: status.lastSuccessAt,
    last_error_at: status.lastErrorAt,
    last_error: status.lastError,
    detail: status.detail ?? {},
    updated_at: new Date().toISOString(),
  };
}

export async function loadSharedActiveTarget(): Promise<SharedActiveTarget> {
  const hotCacheKey = buildActiveTargetHotCacheKey(ACTIVE_TARGET_WORKSPACE_KEY);
  const hotCacheValue = await loadHotCacheJson<SharedActiveTarget>(hotCacheKey);
  if (hotCacheValue.value && !hotCacheValue.isStale) {
    return normalizeSharedActiveTarget(hotCacheValue.value);
  }

  const admin = getAdminClient();
  if (!admin) {
    return hotCacheValue.value
      ? normalizeSharedActiveTarget(hotCacheValue.value)
      : EMPTY_SHARED_ACTIVE_TARGET;
  }
  if (shouldBypassPersistence(SHARED_TARGET_READ_SCOPE)) {
    return hotCacheValue.value
      ? normalizeSharedActiveTarget(hotCacheValue.value)
      : EMPTY_SHARED_ACTIVE_TARGET;
  }

  try {
    const response = await withTimeout(
      admin
        .from(PERSISTENCE_TABLES.activeTarget)
        .select('*')
        .eq('workspace_key', ACTIVE_TARGET_WORKSPACE_KEY)
        .maybeSingle(),
      'load shared active target',
    );

    if (response.error) {
      markPersistenceFailure(SHARED_TARGET_READ_SCOPE);
      return hotCacheValue.value
        ? normalizeSharedActiveTarget(hotCacheValue.value)
        : EMPTY_SHARED_ACTIVE_TARGET;
    }
    if (!response.data) {
      return hotCacheValue.value
        ? normalizeSharedActiveTarget(hotCacheValue.value)
        : EMPTY_SHARED_ACTIVE_TARGET;
    }

    const normalized = normalizeSharedActiveTarget(response.data);
    void saveHotCacheJson(hotCacheKey, normalized, {
      freshForSeconds: ACTIVE_TARGET_HOT_CACHE_FRESH_SECONDS,
      staleForSeconds: ACTIVE_TARGET_HOT_CACHE_STALE_SECONDS,
    });
    markPersistenceSuccess(SHARED_TARGET_READ_SCOPE);
    return normalized;
  } catch {
    markPersistenceFailure(SHARED_TARGET_READ_SCOPE);
    return hotCacheValue.value
      ? normalizeSharedActiveTarget(hotCacheValue.value)
      : EMPTY_SHARED_ACTIVE_TARGET;
  }
}

export type SaveSharedActiveTargetOptions = {
  baseTarget?: SharedActiveTarget;
  requirePersistence?: boolean;
};

export async function saveSharedActiveTarget(
  partial: Partial<SharedActiveTarget>,
  options: SaveSharedActiveTargetOptions = {},
): Promise<SharedActiveTarget> {
  const current = options.baseTarget
    ? normalizeSharedActiveTarget(options.baseTarget)
    : await loadSharedActiveTarget();
  const next = normalizeSharedActiveTarget({
    ...current,
    ...partial,
    workspaceKey: ACTIVE_TARGET_WORKSPACE_KEY,
    seasonYear: ACTIVE_TARGET_SEASON_YEAR,
  });
  const admin = getAdminClient();
  if (!admin) {
    await saveSharedActiveTargetHotCache(next);
    await invalidateBootstrapHotCache();
    return next;
  }

  try {
    const response = await withWriteTimeout(
      () =>
        admin
          .from(PERSISTENCE_TABLES.activeTarget)
          .upsert(activeTargetRowFromTarget(next), { onConflict: 'workspace_key' }),
      'save shared active target',
      options.requirePersistence
        ? DURABLE_SHARED_TARGET_WRITE_TIMEOUT_MS
        : SUPABASE_WRITE_TIMEOUT_MS,
    );

    if (response.error) {
      markPersistenceFailure(SHARED_TARGET_WRITE_SCOPE);
      logSharedTargetPersistenceWarning(
        'shared_active_target_write_failed',
        response.error.message,
      );
      if (options.requirePersistence) {
        throw new Error(response.error.message);
      }
      await saveSharedActiveTargetHotCache(next);
      await invalidateBootstrapHotCache();
      return next;
    }

    markPersistenceSuccess(SHARED_TARGET_WRITE_SCOPE);
    await saveSharedActiveTargetHotCache(next);
    await invalidateBootstrapHotCache();
    return next;
  } catch (error) {
    markPersistenceFailure(SHARED_TARGET_WRITE_SCOPE);
    logSharedTargetPersistenceWarning(
      'shared_active_target_write_failed',
      error instanceof Error ? error.message : 'Unknown shared active target write error',
    );
    if (options.requirePersistence) {
      throw error;
    }
    await saveSharedActiveTargetHotCache(next);
    await invalidateBootstrapHotCache();
    return next;
  }
}

export async function loadSharedRefreshStatus(): Promise<SharedRefreshStatus> {
  const hotCacheKey = buildRefreshStatusHotCacheKey(ACTIVE_TARGET_WORKSPACE_KEY);
  const hotCacheValue = await loadHotCacheJson<SharedRefreshStatus>(hotCacheKey);
  if (hotCacheValue.value && !hotCacheValue.isStale) {
    return normalizeSharedRefreshStatus(hotCacheValue.value);
  }

  const admin = getAdminClient();
  if (!admin) {
    return hotCacheValue.value
      ? normalizeSharedRefreshStatus(hotCacheValue.value)
      : EMPTY_SHARED_REFRESH_STATUS;
  }
  if (shouldBypassPersistence(SHARED_TARGET_READ_SCOPE)) {
    return hotCacheValue.value
      ? normalizeSharedRefreshStatus(hotCacheValue.value)
      : EMPTY_SHARED_REFRESH_STATUS;
  }

  try {
    const response = await withTimeout(
      admin
        .from(PERSISTENCE_TABLES.refreshStatus)
        .select('*')
        .eq('workspace_key', ACTIVE_TARGET_WORKSPACE_KEY)
        .maybeSingle(),
      'load shared refresh status',
    );

    if (response.error) {
      markPersistenceFailure(SHARED_TARGET_READ_SCOPE);
      return hotCacheValue.value
        ? normalizeSharedRefreshStatus(hotCacheValue.value)
        : EMPTY_SHARED_REFRESH_STATUS;
    }
    if (!response.data) {
      return hotCacheValue.value
        ? normalizeSharedRefreshStatus(hotCacheValue.value)
        : EMPTY_SHARED_REFRESH_STATUS;
    }

    const normalized = normalizeSharedRefreshStatus(response.data);
    void saveHotCacheJson(hotCacheKey, normalized, {
      freshForSeconds: ACTIVE_TARGET_HOT_CACHE_FRESH_SECONDS,
      staleForSeconds: ACTIVE_TARGET_HOT_CACHE_STALE_SECONDS,
    });
    markPersistenceSuccess(SHARED_TARGET_READ_SCOPE);
    return normalized;
  } catch {
    markPersistenceFailure(SHARED_TARGET_READ_SCOPE);
    return hotCacheValue.value
      ? normalizeSharedRefreshStatus(hotCacheValue.value)
      : EMPTY_SHARED_REFRESH_STATUS;
  }
}

export async function saveSharedRefreshStatus(
  partial: Partial<SharedRefreshStatus>,
): Promise<SharedRefreshStatus> {
  const current = await loadSharedRefreshStatus();
  const next = normalizeSharedRefreshStatus({
    ...current,
    ...partial,
    workspaceKey: ACTIVE_TARGET_WORKSPACE_KEY,
  });
  await saveHotCacheJson(buildRefreshStatusHotCacheKey(ACTIVE_TARGET_WORKSPACE_KEY), next, {
    freshForSeconds: ACTIVE_TARGET_HOT_CACHE_FRESH_SECONDS,
    staleForSeconds: ACTIVE_TARGET_HOT_CACHE_STALE_SECONDS,
  });
  await invalidateBootstrapHotCache();
  const admin = getAdminClient();
  if (!admin) return next;

  try {
    const response = await withWriteTimeout(
      () =>
        admin
          .from(PERSISTENCE_TABLES.refreshStatus)
          .upsert(refreshStatusRowFromStatus(next), { onConflict: 'workspace_key' }),
      'save shared refresh status',
    );

    if (response.error) {
      markPersistenceFailure(SHARED_TARGET_WRITE_SCOPE);
      logSharedTargetPersistenceWarning(
        'shared_refresh_status_write_failed',
        response.error.message,
      );
      return next;
    }

    markPersistenceSuccess(SHARED_TARGET_WRITE_SCOPE);
    return next;
  } catch (error) {
    markPersistenceFailure(SHARED_TARGET_WRITE_SCOPE);
    logSharedTargetPersistenceWarning(
      'shared_refresh_status_write_failed',
      error instanceof Error ? error.message : 'Unknown shared refresh status write error',
    );
    return next;
  }
}

export async function loadTeamEventCatalog(
  teamNumber: number,
  options: {
    year?: number;
    forceRefresh?: boolean;
  } = {},
): Promise<TeamEventCatalogResult> {
  const year = readPositiveInteger(options.year) ?? ACTIVE_TARGET_SEASON_YEAR;
  const normalizedTeam = readPositiveInteger(teamNumber);
  if (!normalizedTeam) {
    return {
      generatedAt: new Date(0).toISOString(),
      cached: false,
      events: [],
    };
  }

  const hotCacheKey = buildTeamEventCatalogHotCacheKey(
    ACTIVE_TARGET_WORKSPACE_KEY,
    normalizedTeam,
    year,
  );
  if (!options.forceRefresh) {
    const hotCacheValue = await loadHotCacheJson<TeamEventCatalogResult>(hotCacheKey);
    if (hotCacheValue.value && !hotCacheValue.isStale) {
      return hotCacheValue.value;
    }
    if (hotCacheValue.value && !getAdminClient()) {
      return hotCacheValue.value;
    }
  }

  const admin = getAdminClient();
  if (admin && !options.forceRefresh && !shouldBypassPersistence(SHARED_TARGET_READ_SCOPE)) {
    try {
      const response = await withTimeout(
        admin
          .from(PERSISTENCE_TABLES.teamEventCatalog)
          .select('payload, generated_at, updated_at')
          .eq('workspace_key', ACTIVE_TARGET_WORKSPACE_KEY)
          .eq('team_number', normalizedTeam)
          .eq('season_year', year)
          .maybeSingle(),
        `load team event catalog for ${normalizedTeam}`,
      );

      if (response.error) {
        markPersistenceFailure(SHARED_TARGET_READ_SCOPE);
      } else if (response.data) {
        const generatedAt =
          readNullableString(response.data.generated_at) ??
          readNullableString(response.data.updated_at) ??
          new Date(0).toISOString();
        const generatedAtMs = Date.parse(generatedAt);
        if (
          Number.isFinite(generatedAtMs) &&
          Date.now() - generatedAtMs <= TEAM_EVENT_CATALOG_MAX_AGE_MS
        ) {
          const cachedResult = {
            generatedAt,
            cached: true,
            events: normalizeTeamEventCatalog(response.data.payload),
          };
          void saveHotCacheJson(hotCacheKey, cachedResult, {
            freshForSeconds: Math.max(15, Math.floor(TEAM_EVENT_CATALOG_MAX_AGE_MS / 1000)),
            staleForSeconds: Math.max(60, Math.floor(TEAM_EVENT_CATALOG_MAX_AGE_MS / 1000) + 300),
          });
          markPersistenceSuccess(SHARED_TARGET_READ_SCOPE);
          return cachedResult;
        }
      }
    } catch {
      markPersistenceFailure(SHARED_TARGET_READ_SCOPE);
    }
  }

  const events = await fetchTeamEventCatalog(normalizedTeam, year);
  const generatedAt = new Date().toISOString();

  if (admin) {
    try {
      const response = await withWriteTimeout(
        () =>
          admin.from(PERSISTENCE_TABLES.teamEventCatalog).upsert(
            {
              workspace_key: ACTIVE_TARGET_WORKSPACE_KEY,
              team_number: normalizedTeam,
              season_year: year,
              payload: events,
              generated_at: generatedAt,
              updated_at: generatedAt,
            },
            { onConflict: 'workspace_key,team_number,season_year' },
          ),
        `save team event catalog for ${normalizedTeam}`,
      );
      if (response.error) {
        markPersistenceFailure(SHARED_TARGET_WRITE_SCOPE);
      } else {
        markPersistenceSuccess(SHARED_TARGET_WRITE_SCOPE);
      }
    } catch {
      markPersistenceFailure(SHARED_TARGET_WRITE_SCOPE);
    }
  }

  const nextResult = {
    generatedAt,
    cached: false,
    events,
  };
  await saveHotCacheJson(hotCacheKey, nextResult, {
    freshForSeconds: Math.max(15, Math.floor(TEAM_EVENT_CATALOG_MAX_AGE_MS / 1000)),
    staleForSeconds: Math.max(60, Math.floor(TEAM_EVENT_CATALOG_MAX_AGE_MS / 1000) + 300),
  });
  void deleteHotCacheKey(buildBootstrapHotCacheKey(ACTIVE_TARGET_WORKSPACE_KEY));
  return nextResult;
}
