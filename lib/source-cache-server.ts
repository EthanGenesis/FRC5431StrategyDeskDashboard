import { cachedFetchJson } from './httpCache';
import { PERSISTENCE_TABLES } from './persistence-surfaces';
import { isSupabaseServiceConfigured } from './supabase';
import { createSupabaseAdminClient } from './supabase-server';
import { getEventWorkspaceKey } from './workspace-key';

type CacheSource = 'tba' | 'statbotics' | 'first' | 'nexus' | 'snapshot' | 'event_context';
const SUPABASE_OPERATION_TIMEOUT_MS = 2500;

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
  const { client: admin } = getAdminClient();
  if (!admin) return null;

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
    if (response.error || !response.data) return null;

    const updatedAtMs = Date.parse(String(response.data.updated_at ?? ''));
    if (!Number.isFinite(updatedAtMs)) return null;
    if (Date.now() - updatedAtMs > maxAgeSeconds * 1000) return null;

    return (response.data.payload ?? null) as T | null;
  } catch (error) {
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
): Promise<void> {
  const { client: admin } = getAdminClient();
  if (!admin) return;

  const cacheKey = `${source}::${requestPath}`;
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
  } catch (error) {
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
  void savePersistedUpstreamCache(source, requestPath, payload);
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
  if (!admin) return;

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
  } catch (error) {
    logPersistenceEvent('warn', 'snapshot_cache_write_failed', {
      source: input.source,
      eventKey: input.eventKey,
      teamNumber: input.teamNumber,
      detail: error instanceof Error ? error.message : 'Unknown snapshot cache write error',
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

          return {
            persisted: true,
            status: 'updated',
            detail: null,
            signalId: existingSignalId,
          };
        } catch (error) {
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

    return {
      persisted: true,
      status: 'stored',
      detail: null,
      signalId: insertedSignalId,
    };
  } catch (error) {
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

  try {
    const response = await withTimeout(
      admin
        .from(PERSISTENCE_TABLES.eventLiveSignals)
        .select('*')
        .eq('workspace_key', workspaceKey)
        .order('created_at', { ascending: false })
        .limit(limit),
      `list event live signals for ${workspaceKey}`,
    );

    if (response.error) {
      logPersistenceEvent('error', 'event_live_signal_list_failed', {
        eventKey,
        detail: response.error.message,
      });
      return [];
    }
    return (response.data ?? []) as Record<string, unknown>[];
  } catch (error) {
    logPersistenceEvent('warn', 'event_live_signal_list_failed', {
      eventKey,
      detail: error instanceof Error ? error.message : 'Unknown event live signal list error',
    });
    return [];
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
  } catch (error) {
    logPersistenceEvent('warn', 'validation_snapshot_write_failed', {
      eventKey,
      detail: error instanceof Error ? error.message : 'Unknown validation snapshot write error',
    });
  }
}
