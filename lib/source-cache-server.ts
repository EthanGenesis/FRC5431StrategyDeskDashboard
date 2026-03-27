import { cachedFetchJson } from './httpCache';
import { PERSISTENCE_TABLES } from './persistence-surfaces';
import { isSupabaseServiceConfigured } from './supabase';
import { createSupabaseAdminClient } from './supabase-server';
import { getEventWorkspaceKey } from './workspace-key';

type CacheSource = 'tba' | 'statbotics' | 'first' | 'nexus' | 'snapshot' | 'event_context';

type EventLiveSignalInput = {
  eventKey: string;
  source: string;
  signalType: string;
  title: string;
  body: string;
  dedupeKey?: string | null;
  payload?: Record<string, unknown> | null;
};

function toIsoString(value: number | string | Date | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function getAdminClient() {
  if (!isSupabaseServiceConfigured()) return null;
  return createSupabaseAdminClient();
}

export async function loadPersistedUpstreamCache<T>(
  source: CacheSource,
  requestPath: string,
  maxAgeSeconds: number,
): Promise<T | null> {
  const admin = getAdminClient();
  if (!admin) return null;

  const cacheKey = `${source}::${requestPath}`;
  const response = await admin
    .from(PERSISTENCE_TABLES.upstreamCache)
    .select('payload, updated_at')
    .eq('cache_key', cacheKey)
    .maybeSingle();

  if (response.error || !response.data) return null;

  const updatedAtMs = Date.parse(String(response.data.updated_at ?? ''));
  if (!Number.isFinite(updatedAtMs)) return null;
  if (Date.now() - updatedAtMs > maxAgeSeconds * 1000) return null;

  return (response.data.payload ?? null) as T | null;
}

export async function savePersistedUpstreamCache(
  source: CacheSource,
  requestPath: string,
  payload: unknown,
): Promise<void> {
  const admin = getAdminClient();
  if (!admin) return;

  const cacheKey = `${source}::${requestPath}`;
  await admin.from(PERSISTENCE_TABLES.upstreamCache).upsert(
    {
      cache_key: cacheKey,
      source,
      request_path: requestPath,
      payload: payload ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'cache_key' },
  );
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
  await savePersistedUpstreamCache(source, requestPath, payload);
  return payload;
}

export async function saveSnapshotCacheRecord(input: {
  source: CacheSource;
  eventKey: string | null;
  teamNumber: number | null;
  generatedAt: number | string | Date | null | undefined;
  payload: unknown;
}): Promise<void> {
  const admin = getAdminClient();
  if (!admin) return;

  const generatedAtIso = toIsoString(input.generatedAt);
  const cacheKey = [input.source, input.eventKey ?? 'none', input.teamNumber ?? 'none'].join('::');

  await admin.from(PERSISTENCE_TABLES.snapshotCache).upsert(
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
  );
}

export async function appendEventLiveSignal(input: EventLiveSignalInput): Promise<void> {
  const admin = getAdminClient();
  if (!admin) return;

  const workspaceKey = getEventWorkspaceKey(input.eventKey);
  if (!workspaceKey) return;

  const dedupeKey = input.dedupeKey?.trim() ?? null;
  if (dedupeKey) {
    const existing = await admin
      .from(PERSISTENCE_TABLES.eventLiveSignals)
      .select('id')
      .eq('workspace_key', workspaceKey)
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();

    if (existing.data?.id) {
      await admin
        .from(PERSISTENCE_TABLES.eventLiveSignals)
        .update({
          updated_at: new Date().toISOString(),
          title: input.title,
          body: input.body,
          payload: input.payload ?? {},
        })
        .eq('id', existing.data.id);
      return;
    }
  }

  await admin.from(PERSISTENCE_TABLES.eventLiveSignals).insert({
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
  });
}

export async function listEventLiveSignals(eventKey: string, limit = 12) {
  const admin = getAdminClient();
  if (!admin) return [];

  const workspaceKey = getEventWorkspaceKey(eventKey);
  if (!workspaceKey) return [];

  const response = await admin
    .from(PERSISTENCE_TABLES.eventLiveSignals)
    .select('*')
    .eq('workspace_key', workspaceKey)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (response.error) return [];
  return (response.data ?? []) as Record<string, unknown>[];
}

export async function saveValidationSnapshot(
  eventKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const admin = getAdminClient();
  if (!admin) return;

  const workspaceKey = getEventWorkspaceKey(eventKey);
  if (!workspaceKey) return;

  await admin.from(PERSISTENCE_TABLES.sourceValidation).upsert(
    {
      workspace_key: workspaceKey,
      event_key: eventKey,
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_key' },
  );
}
