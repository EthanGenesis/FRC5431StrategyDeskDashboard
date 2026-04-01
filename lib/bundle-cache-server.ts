import {
  buildWarmBundleManifestHotCacheKey,
  buildWarmBundlePayloadHotCacheKey,
  buildWarmBundleStatusHotCacheKey,
} from './hot-cache-keys';
import { loadHotCacheJson, saveHotCacheJson } from './hot-cache-server';
import { PERSISTENCE_TABLES, SHARED_WORKSPACE_KEY } from './persistence-surfaces';
import { isSupabaseServiceConfigured } from './supabase';
import { createSupabaseAdminClient } from './supabase-server';

const SUPABASE_OPERATION_TIMEOUT_MS = 2500;

export type WarmBundleState = 'idle' | 'loading' | 'ready' | 'error';

export type WarmBundleStatusRecord = {
  bundleKey: string;
  workspaceKey: string;
  source: string;
  eventKey: string | null;
  teamNumber: number | null;
  scenarioId: string | null;
  state: WarmBundleState;
  generatedAt: string | null;
  error: string | null;
  meta: Record<string, unknown>;
  updatedAt: string | null;
};

export type WarmBundleKeyInput = {
  source: string;
  workspaceKey?: string | null | undefined;
  eventKey?: string | null | undefined;
  teamNumber?: number | null | undefined;
  scenarioId?: string | null | undefined;
  variant?: string | null | undefined;
};

export type WarmBundlePayloadRecord<T> = {
  payload: T | null;
  cacheLayer: 'memory' | 'redis' | 'supabase' | 'none';
  isStale: boolean;
  generatedAt: string | null;
  etag: string | null;
};

function getAdminClient() {
  if (!isSupabaseServiceConfigured()) return null;
  return createSupabaseAdminClient();
}

async function withTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${SUPABASE_OPERATION_TIMEOUT_MS}ms`));
    }, SUPABASE_OPERATION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

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

function readBundleState(value: unknown): WarmBundleState {
  return value === 'loading' || value === 'ready' || value === 'error' ? value : 'idle';
}

function toIsoString(value: number | string | Date | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function normalizeMeta(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function isMissingBundleStatusStorageError(message: string | null | undefined): boolean {
  const normalized = readString(message).toLowerCase();
  return (
    normalized.includes("could not find the table 'public.tbsb_bundle_status'") ||
    (normalized.includes('tbsb_bundle_status') &&
      (normalized.includes('schema cache') || normalized.includes('does not exist')))
  );
}

function buildSnapshotCacheKey(bundleKey: string): string {
  return `bundle::${bundleKey}`;
}

export function buildWarmBundleKey(input: WarmBundleKeyInput): string {
  const parts = [
    readString(input.workspaceKey) || SHARED_WORKSPACE_KEY,
    readString(input.source) || 'bundle',
    readNullableString(input.eventKey) ?? 'none',
    readPositiveInteger(input.teamNumber) ?? 'none',
    readNullableString(input.scenarioId) ?? 'baseline',
    readNullableString(input.variant) ?? 'default',
  ];
  return parts.join('::');
}

export function normalizeWarmBundleStatusRecord(value: unknown): WarmBundleStatusRecord {
  const row = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    bundleKey: readString(row.bundleKey ?? row.bundle_key),
    workspaceKey: readString(row.workspaceKey ?? row.workspace_key) || SHARED_WORKSPACE_KEY,
    source: readString(row.source),
    eventKey: readNullableString(row.eventKey ?? row.event_key),
    teamNumber: readPositiveInteger(row.teamNumber ?? row.team_number),
    scenarioId: readNullableString(row.scenarioId ?? row.scenario_id),
    state: readBundleState(row.state),
    generatedAt: readNullableString(row.generatedAt ?? row.generated_at),
    error: readNullableString(row.error),
    meta: normalizeMeta(row.meta),
    updatedAt: readNullableString(row.updatedAt ?? row.updated_at),
  };
}

export async function loadWarmBundlePayload<T>(
  input: WarmBundleKeyInput,
  maxAgeSeconds: number,
): Promise<T | null> {
  const payloadRecord = await loadWarmBundlePayloadRecord<T>(input, maxAgeSeconds);
  return payloadRecord.payload;
}

export async function loadWarmBundlePayloadRecord<T>(
  input: WarmBundleKeyInput,
  maxAgeSeconds: number,
): Promise<WarmBundlePayloadRecord<T>> {
  const bundleKey = buildWarmBundleKey(input);
  const hotCacheKey = buildWarmBundlePayloadHotCacheKey(bundleKey);
  const hotCacheValue = await loadHotCacheJson<{
    payload: T;
    generatedAt: string | null;
  }>(hotCacheKey);

  if (hotCacheValue.value) {
    const generatedAtMs = Date.parse(String(hotCacheValue.value.generatedAt ?? ''));
    if (
      Number.isFinite(generatedAtMs) &&
      Date.now() - generatedAtMs <= maxAgeSeconds * 1000 &&
      !hotCacheValue.isStale
    ) {
      return {
        payload: hotCacheValue.value.payload ?? null,
        cacheLayer: hotCacheValue.layer ?? 'memory',
        isStale: false,
        generatedAt: hotCacheValue.value.generatedAt ?? null,
        etag: hotCacheValue.etag,
      };
    }
  }

  const admin = getAdminClient();
  if (!admin) {
    return {
      payload: null,
      cacheLayer: 'none',
      isStale: false,
      generatedAt: null,
      etag: null,
    };
  }

  const cacheKey = buildSnapshotCacheKey(bundleKey);

  const response = await withTimeout(
    admin
      .from(PERSISTENCE_TABLES.snapshotCache)
      .select('payload, generated_at, updated_at')
      .eq('cache_key', cacheKey)
      .maybeSingle(),
    `load warm bundle payload for ${bundleKey}`,
  );

  if (response.error || !response.data) {
    return {
      payload: null,
      cacheLayer: 'none',
      isStale: false,
      generatedAt: null,
      etag: null,
    };
  }

  const generatedAtMs = Date.parse(
    String(response.data.generated_at ?? response.data.updated_at ?? ''),
  );
  if (!Number.isFinite(generatedAtMs) || Date.now() - generatedAtMs > maxAgeSeconds * 1000) {
    return {
      payload: null,
      cacheLayer: 'none',
      isStale: false,
      generatedAt: null,
      etag: null,
    };
  }

  const responseData = response.data as Record<string, unknown>;
  const payload = (responseData.payload ?? null) as T | null;
  const generatedAtSource = responseData.generated_at ?? responseData.updated_at ?? null;
  const generatedAt = toIsoString(
    typeof generatedAtSource === 'string' ||
      typeof generatedAtSource === 'number' ||
      generatedAtSource instanceof Date
      ? generatedAtSource
      : null,
  );
  if (payload != null) {
    void saveHotCacheJson(
      hotCacheKey,
      {
        payload,
        generatedAt,
      },
      {
        freshForSeconds: maxAgeSeconds,
        staleForSeconds: Math.max(maxAgeSeconds + 60, maxAgeSeconds * 3),
      },
    );
  }

  return {
    payload,
    cacheLayer: 'supabase',
    isStale: false,
    generatedAt,
    etag: null,
  };
}

export async function saveWarmBundlePayload(input: {
  bundleKey?: string | undefined;
  workspaceKey?: string | null | undefined;
  source: string;
  eventKey?: string | null | undefined;
  teamNumber?: number | null | undefined;
  scenarioId?: string | null | undefined;
  variant?: string | null | undefined;
  generatedAt: number | string | Date | null | undefined;
  payload: unknown;
  state?: WarmBundleState;
  error?: string | null;
  meta?: Record<string, unknown>;
}): Promise<{ bundleKey: string; generatedAt: string | null }> {
  const admin = getAdminClient();
  const bundleKey =
    input.bundleKey ??
    buildWarmBundleKey({
      source: input.source,
      workspaceKey: input.workspaceKey,
      eventKey: input.eventKey,
      teamNumber: input.teamNumber,
      scenarioId: input.scenarioId,
      variant: input.variant,
    });
  const generatedAt = toIsoString(input.generatedAt);
  const hotCachePayload = {
    payload: input.payload ?? {},
    generatedAt,
  };

  const cacheKey = buildSnapshotCacheKey(bundleKey);
  const workspaceKey = readString(input.workspaceKey) || SHARED_WORKSPACE_KEY;
  const normalizedMeta = input.meta ?? {};
  const updatedAt = new Date().toISOString();
  const hotCacheKey = buildWarmBundlePayloadHotCacheKey(bundleKey);
  void saveHotCacheJson(hotCacheKey, hotCachePayload, {
    freshForSeconds: 90,
    staleForSeconds: 300,
  });

  if (!admin) {
    return { bundleKey, generatedAt };
  }

  const snapshotResponse = await withTimeout(
    admin.from(PERSISTENCE_TABLES.snapshotCache).upsert(
      {
        cache_key: cacheKey,
        source: input.source,
        event_key: readNullableString(input.eventKey),
        team_number: readPositiveInteger(input.teamNumber),
        generated_at: generatedAt,
        payload: input.payload ?? {},
        updated_at: updatedAt,
      },
      { onConflict: 'cache_key' },
    ),
    `save warm bundle payload for ${bundleKey}`,
  );

  if (snapshotResponse.error) {
    throw new Error(snapshotResponse.error.message);
  }

  const statusResponse = await withTimeout(
    admin.from(PERSISTENCE_TABLES.bundleStatus).upsert(
      {
        bundle_key: bundleKey,
        workspace_key: workspaceKey,
        source: input.source,
        event_key: readNullableString(input.eventKey),
        team_number: readPositiveInteger(input.teamNumber),
        scenario_id: readNullableString(input.scenarioId),
        state: input.state ?? 'ready',
        generated_at: generatedAt,
        error: readNullableString(input.error),
        meta: normalizedMeta,
        updated_at: updatedAt,
      },
      { onConflict: 'bundle_key' },
    ),
    `save warm bundle status for ${bundleKey}`,
  );

  if (statusResponse.error && !isMissingBundleStatusStorageError(statusResponse.error.message)) {
    throw new Error(statusResponse.error.message);
  }

  void saveHotCacheJson(buildWarmBundleStatusHotCacheKey(bundleKey), {
    bundleKey,
    workspaceKey,
    source: input.source,
    eventKey: readNullableString(input.eventKey),
    teamNumber: readPositiveInteger(input.teamNumber),
    scenarioId: readNullableString(input.scenarioId),
    state: input.state ?? 'ready',
    generatedAt,
    error: readNullableString(input.error),
    meta: normalizedMeta,
    updatedAt,
  });
  void saveHotCacheJson(buildWarmBundleManifestHotCacheKey(workspaceKey), null, {
    freshForSeconds: 1,
    staleForSeconds: 1,
  });

  return { bundleKey, generatedAt };
}

export async function saveWarmBundleStatus(input: {
  bundleKey?: string | undefined;
  workspaceKey?: string | null | undefined;
  source: string;
  eventKey?: string | null | undefined;
  teamNumber?: number | null | undefined;
  scenarioId?: string | null | undefined;
  variant?: string | null | undefined;
  state: WarmBundleState;
  generatedAt?: number | string | Date | null | undefined;
  error?: string | null;
  meta?: Record<string, unknown>;
}): Promise<string> {
  const admin = getAdminClient();
  const bundleKey =
    input.bundleKey ??
    buildWarmBundleKey({
      source: input.source,
      workspaceKey: input.workspaceKey,
      eventKey: input.eventKey,
      teamNumber: input.teamNumber,
      scenarioId: input.scenarioId,
      variant: input.variant,
    });

  const nextStatusRecord = {
    bundleKey,
    workspaceKey: readString(input.workspaceKey) || SHARED_WORKSPACE_KEY,
    source: input.source,
    eventKey: readNullableString(input.eventKey),
    teamNumber: readPositiveInteger(input.teamNumber),
    scenarioId: readNullableString(input.scenarioId),
    state: input.state,
    generatedAt: toIsoString(input.generatedAt),
    error: readNullableString(input.error),
    meta: input.meta ?? {},
    updatedAt: new Date().toISOString(),
  };

  void saveHotCacheJson(buildWarmBundleStatusHotCacheKey(bundleKey), nextStatusRecord, {
    freshForSeconds: 30,
    staleForSeconds: 120,
  });
  void saveHotCacheJson(buildWarmBundleManifestHotCacheKey(nextStatusRecord.workspaceKey), null, {
    freshForSeconds: 1,
    staleForSeconds: 1,
  });

  if (!admin) return bundleKey;

  const response = await withTimeout(
    admin.from(PERSISTENCE_TABLES.bundleStatus).upsert(
      {
        bundle_key: bundleKey,
        workspace_key: nextStatusRecord.workspaceKey,
        source: nextStatusRecord.source,
        event_key: nextStatusRecord.eventKey,
        team_number: nextStatusRecord.teamNumber,
        scenario_id: nextStatusRecord.scenarioId,
        state: nextStatusRecord.state,
        generated_at: nextStatusRecord.generatedAt,
        error: nextStatusRecord.error,
        meta: nextStatusRecord.meta,
        updated_at: nextStatusRecord.updatedAt,
      },
      { onConflict: 'bundle_key' },
    ),
    `save warm bundle status for ${bundleKey}`,
  );

  if (response.error && !isMissingBundleStatusStorageError(response.error.message)) {
    throw new Error(response.error.message);
  }

  return bundleKey;
}

export async function listWarmBundleStatuses(
  workspaceKey: string | null | undefined,
): Promise<WarmBundleStatusRecord[]> {
  const scopedWorkspaceKey = readString(workspaceKey);
  if (!scopedWorkspaceKey) return [];

  const manifestHotCacheKey = buildWarmBundleManifestHotCacheKey(scopedWorkspaceKey);
  const hotCacheValue = await loadHotCacheJson<WarmBundleStatusRecord[]>(manifestHotCacheKey);
  if (Array.isArray(hotCacheValue.value) && !hotCacheValue.isStale) {
    return hotCacheValue.value.map((row) => normalizeWarmBundleStatusRecord(row));
  }

  const admin = getAdminClient();
  if (!admin) return [];

  const response = await withTimeout(
    admin
      .from(PERSISTENCE_TABLES.bundleStatus)
      .select('*')
      .eq('workspace_key', scopedWorkspaceKey)
      .order('updated_at', { ascending: false }),
    `list warm bundle statuses for ${scopedWorkspaceKey}`,
  );

  if (response.error) {
    if (isMissingBundleStatusStorageError(response.error.message)) {
      return [];
    }
    throw new Error(response.error.message);
  }

  const rows = Array.isArray(response.data)
    ? response.data.map((row) => normalizeWarmBundleStatusRecord(row))
    : [];
  void saveHotCacheJson(manifestHotCacheKey, rows, {
    freshForSeconds: 10,
    staleForSeconds: 45,
  });
  return rows;
}

export async function loadWarmBundleStatus(
  bundleKey: string | null | undefined,
): Promise<WarmBundleStatusRecord | null> {
  const normalizedBundleKey = readString(bundleKey);
  if (!normalizedBundleKey) return null;

  const hotCacheValue = await loadHotCacheJson<WarmBundleStatusRecord>(
    buildWarmBundleStatusHotCacheKey(normalizedBundleKey),
  );
  if (hotCacheValue.value && !hotCacheValue.isStale) {
    return normalizeWarmBundleStatusRecord(hotCacheValue.value);
  }

  const admin = getAdminClient();
  if (!admin) return null;

  const response = await withTimeout(
    admin
      .from(PERSISTENCE_TABLES.bundleStatus)
      .select('*')
      .eq('bundle_key', normalizedBundleKey)
      .maybeSingle(),
    `load warm bundle status for ${normalizedBundleKey}`,
  );

  if (response.error) {
    if (isMissingBundleStatusStorageError(response.error.message)) {
      return null;
    }
    return null;
  }
  if (!response.data) return null;
  const normalized = normalizeWarmBundleStatusRecord(response.data);
  void saveHotCacheJson(buildWarmBundleStatusHotCacheKey(normalizedBundleKey), normalized, {
    freshForSeconds: 30,
    staleForSeconds: 120,
  });
  return normalized;
}
