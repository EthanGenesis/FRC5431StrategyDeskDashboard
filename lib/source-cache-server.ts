import { cachedFetchJson } from './httpCache';
import {
  buildEventLiveSignalsHotCacheKey,
  buildSnapshotHotCacheKey,
  buildUpstreamHotCacheKey,
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
import { getEventWorkspaceKey } from './workspace-key';

type CacheSource = string;
const SUPABASE_OPERATION_TIMEOUT_MS = 900;
const SNAPSHOT_HOT_CACHE_FRESH_SECONDS = 90;
const SNAPSHOT_HOT_CACHE_STALE_SECONDS = 240;
const EVENT_LIVE_SIGNALS_HOT_CACHE_FRESH_SECONDS = 5;
const EVENT_LIVE_SIGNALS_HOT_CACHE_STALE_SECONDS = 30;
const EVENT_LIVE_SIGNALS_LIST_TIMEOUT_MS = 600;
const SOURCE_CACHE_SCOPE = 'source-cache';

type EventLiveSignalInput = {
  eventKey: string;
  source: string;
  signalType: string;
  title: string;
  body: string;
  dedupeKey?: string | null;
  payload?: Record<string, unknown> | null;
};

export type EventLiveSignalPersistenceStatus =
  | 'stored'
  | 'updated'
  | 'disabled'
  | 'invalid'
  | 'error';

export type EventLiveSignalPersistenceResult = {
  persisted: boolean;
  status: EventLiveSignalPersistenceStatus;
  detail: string | null;
  signalId: string | null;
};

function toIsoString(value: number | string | Date | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function logPersistenceEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  payload: Record<string, unknown>,
) {
  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  logger(
    JSON.stringify({
      level,
      event,
      ts: new Date().toISOString(),
      ...payload,
    }),
  );
}

async function withTimeout<T>(
  promise: PromiseLike<T>,
  label: string,
  timeoutMs = SUPABASE_OPERATION_TIMEOUT_MS,
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

function createEventLiveSignalRow(
  input: EventLiveSignalInput & { workspaceKey: string; id?: string | null },
) {
  const timestamp = new Date().toISOString();
  return {
    id: input.id ?? null,
    workspace_key: input.workspaceKey,
    event_key: input.eventKey,
    source: input.source,
    signal_type: input.signalType,
    title: input.title,
    body: input.body,
    dedupe_key: input.dedupeKey?.trim() ?? null,
    payload: input.payload ?? {},
    created_at: timestamp,
    updated_at: timestamp,
  };
}

async function primeEventLiveSignalsHotCache(
  eventKey: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  await saveHotCacheJson(buildEventLiveSignalsHotCacheKey(eventKey), rows, {
    freshForSeconds: EVENT_LIVE_SIGNALS_HOT_CACHE_FRESH_SECONDS,
    staleForSeconds: EVENT_LIVE_SIGNALS_HOT_CACHE_STALE_SECONDS,
  });
}

function readRowId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getAdminClient() {
  if (!isSupabaseServiceConfigured()) {
    return {
      client: null,
      detail:
        'Server-side Supabase persistence is disabled. Confirm NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in the runtime environment.',
    };
  }

  return {
    client: createSupabaseAdminClient(),
    detail: null,
  };
}

export async function loadPersistedUpstreamCache<T>(
  source: CacheSource,
  requestPath: string,
  maxAgeSeconds: number,
): Promise<T | null> {
  const hotCacheKey = buildUpstreamHotCacheKey(source, requestPath);
  const hotCacheValue = await loadHotCacheJson<T>(hotCacheKey);
  if (hotCacheValue.value && !hotCacheValue.isStale) return hotCacheValue.value;

  const { client: admin } = getAdminClient();
  if (!admin) return null;
  if (shouldBypassPersistence(SOURCE_CACHE_SCOPE)) return null;

  const cacheKey = `${source}::${requestPath}`;
  try {
    const response = await withTimeout(
      admin
        .from(PERSISTENCE_TABLES.upstreamCache)
        .select('payload, updated_at')
        .eq('cache_key', cacheKey)
        .maybeSingle(),
      `load persisted upstream cache for ${cacheKey}`,
    );
    if (response.error) {
      markPersistenceFailure(SOURCE_CACHE_SCOPE);
      return null;
    }
    if (!response.data) return null;

    const updatedAtMs = Date.parse(String(response.data.updated_at ?? ''));
    if (!Number.isFinite(updatedAtMs)) return null;
    if (Date.now() - updatedAtMs > maxAgeSeconds * 1000) return null;

    const payload = (response.data.payload ?? null) as T | null;
    if (payload != null) {
      void saveHotCacheJson(hotCacheKey, payload, {
        freshForSeconds: maxAgeSeconds,
        staleForSeconds: Math.max(maxAgeSeconds + 60, maxAgeSeconds * 3),
      });
    }

    markPersistenceSuccess(SOURCE_CACHE_SCOPE);
    return payload;
  } catch (error) {
    markPersistenceFailure(SOURCE_CACHE_SCOPE);
    logPersistenceEvent('warn', 'upstream_cache_read_failed', {
      source,
      requestPath,
      detail: error instanceof Error ? error.message : 'Unknown upstream cache read error',
    });
    return null;
  }
}

export async function savePersistedUpstreamCache(
  source: CacheSource,
  requestPath: string,
  payload: unknown,
  maxAgeSeconds = 15,
): Promise<void> {
  const { client: admin } = getAdminClient();
  const cacheKey = `${source}::${requestPath}`;
  const hotCacheKey = buildUpstreamHotCacheKey(source, requestPath);
  void saveHotCacheJson(hotCacheKey, payload, {
    freshForSeconds: maxAgeSeconds,
    staleForSeconds: Math.max(maxAgeSeconds + 60, maxAgeSeconds * 3),
  });

  if (!admin) return;
  if (shouldBypassPersistence(SOURCE_CACHE_SCOPE)) return;

  try {
    await withTimeout(
      admin.from(PERSISTENCE_TABLES.upstreamCache).upsert(
        {
          cache_key: cacheKey,
          source,
          request_path: requestPath,
          payload: payload ?? {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'cache_key' },
      ),
      `save persisted upstream cache for ${cacheKey}`,
    );
    markPersistenceSuccess(SOURCE_CACHE_SCOPE);
  } catch (error) {
    markPersistenceFailure(SOURCE_CACHE_SCOPE);
    logPersistenceEvent('warn', 'upstream_cache_write_failed', {
      source,
      requestPath,
      detail: error instanceof Error ? error.message : 'Unknown upstream cache write error',
    });
  }
}

export async function cachedSourceJson<T>(
  source: CacheSource,
  requestPath: string,
  url: string,
  init?: RequestInit,
  defaultMaxAgeSeconds = 15,
): Promise<T> {
  const persisted = await loadPersistedUpstreamCache<T>(source, requestPath, defaultMaxAgeSeconds);
  if (persisted != null) return persisted;

  const payload = await cachedFetchJson<T>(url, init, defaultMaxAgeSeconds);
  void savePersistedUpstreamCache(source, requestPath, payload, defaultMaxAgeSeconds);
  return payload;
}

export async function saveSnapshotCacheRecord(input: {
  source: CacheSource;
  eventKey: string | null;
  teamNumber: number | null;
  generatedAt: number | string | Date | null | undefined;
  payload: unknown;
}): Promise<void> {
  const { client: admin } = getAdminClient();
  const hotCacheKey = buildSnapshotHotCacheKey(input.source, input.eventKey, input.teamNumber);
  void saveHotCacheJson(hotCacheKey, input.payload, {
    freshForSeconds: SNAPSHOT_HOT_CACHE_FRESH_SECONDS,
    staleForSeconds: SNAPSHOT_HOT_CACHE_STALE_SECONDS,
  });

  if (!admin) return;
  if (shouldBypassPersistence(SOURCE_CACHE_SCOPE)) return;

  const generatedAtIso = toIsoString(input.generatedAt);
  const cacheKey = [input.source, input.eventKey ?? 'none', input.teamNumber ?? 'none'].join('::');

  try {
    await withTimeout(
      admin.from(PERSISTENCE_TABLES.snapshotCache).upsert(
        {
          cache_key: cacheKey,
          source: input.source,
          event_key: input.eventKey,
          team_number: input.teamNumber,
          generated_at: generatedAtIso,
          payload: input.payload ?? {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'cache_key' },
      ),
      `save snapshot cache for ${cacheKey}`,
    );
    markPersistenceSuccess(SOURCE_CACHE_SCOPE);
  } catch (error) {
    markPersistenceFailure(SOURCE_CACHE_SCOPE);
    logPersistenceEvent('warn', 'snapshot_cache_write_failed', {
      source: input.source,
      eventKey: input.eventKey,
      teamNumber: input.teamNumber,
      detail: error instanceof Error ? error.message : 'Unknown snapshot cache write error',
    });
  }
}

export async function loadSnapshotCacheRecord<T>(
  source: CacheSource,
  eventKey: string | null,
  teamNumber: number | null,
  maxAgeSeconds: number,
): Promise<T | null> {
  const hotCacheKey = buildSnapshotHotCacheKey(source, eventKey, teamNumber);
  const hotCacheValue = await loadHotCacheJson<T>(hotCacheKey);
  if (hotCacheValue.value && !hotCacheValue.isStale) return hotCacheValue.value;

  const { client: admin } = getAdminClient();
  if (!admin) return null;

  const cacheKey = [source, eventKey ?? 'none', teamNumber ?? 'none'].join('::');

  try {
    const response = await withTimeout(
      admin
        .from(PERSISTENCE_TABLES.snapshotCache)
        .select('payload, generated_at, updated_at')
        .eq('cache_key', cacheKey)
        .maybeSingle(),
      `load snapshot cache for ${cacheKey}`,
    );
    if (response.error) {
      markPersistenceFailure(SOURCE_CACHE_SCOPE);
      return null;
    }
    if (!response.data) return null;

    const generatedAtMs = Date.parse(
      String(response.data.generated_at ?? response.data.updated_at ?? ''),
    );
    if (!Number.isFinite(generatedAtMs)) return null;
    if (Date.now() - generatedAtMs > maxAgeSeconds * 1000) return null;

    const payload = (response.data.payload ?? null) as T | null;
    if (payload != null) {
      void saveHotCacheJson(hotCacheKey, payload, {
        freshForSeconds: maxAgeSeconds,
        staleForSeconds: Math.max(maxAgeSeconds + 60, maxAgeSeconds * 3),
      });
    }
    markPersistenceSuccess(SOURCE_CACHE_SCOPE);
    return payload;
  } catch (error) {
    markPersistenceFailure(SOURCE_CACHE_SCOPE);
    logPersistenceEvent('warn', 'snapshot_cache_read_failed', {
      source,
      eventKey,
      teamNumber,
      detail: error instanceof Error ? error.message : 'Unknown snapshot cache read error',
    });
    return null;
  }
}

export async function deleteSnapshotCacheRecord(
  source: CacheSource,
  eventKey: string | null,
  teamNumber: number | null,
): Promise<void> {
  const hotCacheKey = buildSnapshotHotCacheKey(source, eventKey, teamNumber);
  await deleteHotCacheKey(hotCacheKey).catch(() => null);

  const { client: admin } = getAdminClient();
  if (!admin) return;

  const cacheKey = [source, eventKey ?? 'none', teamNumber ?? 'none'].join('::');
  try {
    await withTimeout(
      admin.from(PERSISTENCE_TABLES.snapshotCache).delete().eq('cache_key', cacheKey),
      `delete snapshot cache for ${cacheKey}`,
    );
    markPersistenceSuccess(SOURCE_CACHE_SCOPE);
  } catch (error) {
    markPersistenceFailure(SOURCE_CACHE_SCOPE);
    logPersistenceEvent('warn', 'snapshot_cache_delete_failed', {
      source,
      eventKey,
      teamNumber,
      detail: error instanceof Error ? error.message : 'Unknown snapshot cache delete error',
    });
  }
}

export async function appendEventLiveSignal(
  input: EventLiveSignalInput,
): Promise<EventLiveSignalPersistenceResult> {
  const { client: admin, detail: adminDetail } = getAdminClient();
  if (!admin) {
    logPersistenceEvent('warn', 'event_live_signal_persist_disabled', {
      eventKey: input.eventKey,
      signalType: input.signalType,
      detail: adminDetail,
    });
    return {
      persisted: false,
      status: 'disabled',
      detail: adminDetail,
      signalId: null,
    };
  }

  const workspaceKey = getEventWorkspaceKey(input.eventKey);
  if (!workspaceKey) {
    const detail =
      'Event live signal persistence skipped because the event workspace key is invalid.';
    logPersistenceEvent('warn', 'event_live_signal_invalid_workspace', {
      eventKey: input.eventKey,
      signalType: input.signalType,
      detail,
    });
    return {
      persisted: false,
      status: 'invalid',
      detail,
      signalId: null,
    };
  }

  if (shouldBypassPersistence(SOURCE_CACHE_SCOPE)) {
    return {
      persisted: false,
      status: 'disabled',
      detail: 'Source persistence is temporarily bypassed after repeated failures.',
      signalId: null,
    };
  }

  const dedupeKey = input.dedupeKey?.trim() ?? null;
  if (dedupeKey) {
    try {
      const existing = await withTimeout(
        admin
          .from(PERSISTENCE_TABLES.eventLiveSignals)
          .select('id')
          .eq('workspace_key', workspaceKey)
          .eq('dedupe_key', dedupeKey)
          .maybeSingle(),
        `query event live signal for ${workspaceKey}`,
      );

      if (existing.error) {
        markPersistenceFailure(SOURCE_CACHE_SCOPE);
        const detail = `Failed to query existing event live signal rows: ${existing.error.message}`;
        logPersistenceEvent('error', 'event_live_signal_query_failed', {
          eventKey: input.eventKey,
          signalType: input.signalType,
          detail,
        });
        return {
          persisted: false,
          status: 'error',
          detail,
          signalId: null,
        };
      }

      if (existing.data?.id) {
        const existingSignalId = typeof existing.data.id === 'string' ? existing.data.id : null;
        try {
          const updateResponse = await withTimeout(
            admin
              .from(PERSISTENCE_TABLES.eventLiveSignals)
              .update({
                updated_at: new Date().toISOString(),
                title: input.title,
                body: input.body,
                payload: input.payload ?? {},
              })
              .eq('id', existing.data.id),
            `update event live signal ${existingSignalId ?? 'unknown'}`,
          );

          if (updateResponse.error) {
            markPersistenceFailure(SOURCE_CACHE_SCOPE);
            const detail = `Failed to update existing event live signal row: ${updateResponse.error.message}`;
            logPersistenceEvent('error', 'event_live_signal_update_failed', {
              eventKey: input.eventKey,
              signalType: input.signalType,
              signalId: existingSignalId,
              detail,
            });
            return {
              persisted: false,
              status: 'error',
              detail,
              signalId: existingSignalId,
            };
          }

          const cachedSignals = await loadHotCacheJson<Record<string, unknown>[]>(
            buildEventLiveSignalsHotCacheKey(input.eventKey),
          );
          if (Array.isArray(cachedSignals.value)) {
            const nextSignals = cachedSignals.value.map((row) =>
              readRowId(row.id) === existingSignalId
                ? {
                    ...row,
                    title: input.title,
                    body: input.body,
                    payload: input.payload ?? {},
                    dedupe_key: dedupeKey,
                    updated_at: new Date().toISOString(),
                  }
                : row,
            );
            void primeEventLiveSignalsHotCache(input.eventKey, nextSignals);
          }

          markPersistenceSuccess(SOURCE_CACHE_SCOPE);
          return {
            persisted: true,
            status: 'updated',
            detail: null,
            signalId: existingSignalId,
          };
        } catch (error) {
          markPersistenceFailure(SOURCE_CACHE_SCOPE);
          const detail =
            error instanceof Error ? error.message : 'Unknown event live signal update error';
          logPersistenceEvent('error', 'event_live_signal_update_failed', {
            eventKey: input.eventKey,
            signalType: input.signalType,
            signalId: existingSignalId,
            detail,
          });
          return {
            persisted: false,
            status: 'error',
            detail,
            signalId: existingSignalId,
          };
        }
      }
    } catch (error) {
      markPersistenceFailure(SOURCE_CACHE_SCOPE);
      const detail =
        error instanceof Error ? error.message : 'Unknown event live signal query error';
      logPersistenceEvent('error', 'event_live_signal_query_failed', {
        eventKey: input.eventKey,
        signalType: input.signalType,
        detail,
      });
      return {
        persisted: false,
        status: 'error',
        detail,
        signalId: null,
      };
    }
  }

  try {
    const insertResponse = await withTimeout(
      admin
        .from(PERSISTENCE_TABLES.eventLiveSignals)
        .insert({
          workspace_key: workspaceKey,
          event_key: input.eventKey,
          source: input.source,
          signal_type: input.signalType,
          title: input.title,
          body: input.body,
          dedupe_key: dedupeKey,
          payload: input.payload ?? {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single(),
      `insert event live signal for ${workspaceKey}`,
    );

    if (insertResponse.error) {
      markPersistenceFailure(SOURCE_CACHE_SCOPE);
      const detail = `Failed to insert event live signal row: ${insertResponse.error.message}`;
      logPersistenceEvent('error', 'event_live_signal_insert_failed', {
        eventKey: input.eventKey,
        signalType: input.signalType,
        detail,
      });
      return {
        persisted: false,
        status: 'error',
        detail,
        signalId: null,
      };
    }

    const insertedSignalId =
      insertResponse.data && typeof insertResponse.data.id === 'string'
        ? insertResponse.data.id
        : null;

    const cachedSignals = await loadHotCacheJson<Record<string, unknown>[]>(
      buildEventLiveSignalsHotCacheKey(input.eventKey),
    );
    const nextSignalRow = createEventLiveSignalRow({
      ...input,
      workspaceKey,
      id: insertedSignalId,
    });
    const nextSignals = Array.isArray(cachedSignals.value)
      ? [
          nextSignalRow,
          ...cachedSignals.value.filter((row) => readRowId(row.id) !== insertedSignalId),
        ].slice(0, 12)
      : [nextSignalRow];
    void primeEventLiveSignalsHotCache(input.eventKey, nextSignals);

    markPersistenceSuccess(SOURCE_CACHE_SCOPE);
    return {
      persisted: true,
      status: 'stored',
      detail: null,
      signalId: insertedSignalId,
    };
  } catch (error) {
    markPersistenceFailure(SOURCE_CACHE_SCOPE);
    const detail =
      error instanceof Error ? error.message : 'Unknown event live signal insert error';
    logPersistenceEvent('error', 'event_live_signal_insert_failed', {
      eventKey: input.eventKey,
      signalType: input.signalType,
      detail,
    });
    return {
      persisted: false,
      status: 'error',
      detail,
      signalId: null,
    };
  }
}

export async function listEventLiveSignals(eventKey: string, limit = 12) {
  const hotCacheKey = buildEventLiveSignalsHotCacheKey(eventKey);
  const hotCacheValue = await loadHotCacheJson<Record<string, unknown>[]>(hotCacheKey);
  if (Array.isArray(hotCacheValue.value) && !hotCacheValue.isStale) {
    return hotCacheValue.value.slice(0, limit);
  }

  const { client: admin, detail: adminDetail } = getAdminClient();
  if (!admin) {
    logPersistenceEvent('warn', 'event_live_signal_list_disabled', {
      eventKey,
      detail: adminDetail,
    });
    return [];
  }

  const workspaceKey = getEventWorkspaceKey(eventKey);
  if (!workspaceKey) {
    logPersistenceEvent('warn', 'event_live_signal_list_invalid_workspace', {
      eventKey,
    });
    return [];
  }

  if (shouldBypassPersistence(SOURCE_CACHE_SCOPE)) {
    return Array.isArray(hotCacheValue.value) ? hotCacheValue.value.slice(0, limit) : [];
  }

  try {
    const response = await withTimeout(
      admin
        .from(PERSISTENCE_TABLES.eventLiveSignals)
        .select('*')
        .eq('workspace_key', workspaceKey)
        .order('created_at', { ascending: false })
        .limit(limit),
      `list event live signals for ${workspaceKey}`,
      EVENT_LIVE_SIGNALS_LIST_TIMEOUT_MS,
    );

    if (response.error) {
      markPersistenceFailure(SOURCE_CACHE_SCOPE);
      logPersistenceEvent('error', 'event_live_signal_list_failed', {
        eventKey,
        detail: response.error.message,
      });
      const fallbackRows = Array.isArray(hotCacheValue.value)
        ? hotCacheValue.value.slice(0, limit)
        : [];
      void primeEventLiveSignalsHotCache(eventKey, fallbackRows);
      return fallbackRows;
    }
    markPersistenceSuccess(SOURCE_CACHE_SCOPE);
    const rows = (response.data ?? []) as Record<string, unknown>[];
    void primeEventLiveSignalsHotCache(eventKey, rows);
    return rows;
  } catch (error) {
    markPersistenceFailure(SOURCE_CACHE_SCOPE);
    logPersistenceEvent('warn', 'event_live_signal_list_failed', {
      eventKey,
      detail: error instanceof Error ? error.message : 'Unknown event live signal list error',
    });
    const fallbackRows = Array.isArray(hotCacheValue.value)
      ? hotCacheValue.value.slice(0, limit)
      : [];
    void primeEventLiveSignalsHotCache(eventKey, fallbackRows);
    return fallbackRows;
  }
}

export async function saveValidationSnapshot(
  eventKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { client: admin } = getAdminClient();
  if (!admin) return;

  const workspaceKey = getEventWorkspaceKey(eventKey);
  if (!workspaceKey) return;
  if (shouldBypassPersistence(SOURCE_CACHE_SCOPE)) return;

  try {
    await withTimeout(
      admin.from(PERSISTENCE_TABLES.sourceValidation).upsert(
        {
          workspace_key: workspaceKey,
          event_key: eventKey,
          payload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_key' },
      ),
      `save validation snapshot for ${workspaceKey}`,
    );
    markPersistenceSuccess(SOURCE_CACHE_SCOPE);
  } catch (error) {
    markPersistenceFailure(SOURCE_CACHE_SCOPE);
    logPersistenceEvent('warn', 'validation_snapshot_write_failed', {
      eventKey,
      detail: error instanceof Error ? error.message : 'Unknown validation snapshot write error',
    });
  }
}
