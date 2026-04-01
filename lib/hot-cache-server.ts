import { getHotCacheEnv, hasHotCacheEnv } from './env';
import { hashJsonValue } from './json-stable';

export type HotCacheLayer = 'memory' | 'redis';

type HotCacheEnvelope<T> = {
  value: T;
  savedAtMs: number;
  freshUntilMs: number;
  staleUntilMs: number;
  etag: string;
  meta: Record<string, unknown>;
};

export type HotCacheLookup<T> = {
  value: T | null;
  layer: HotCacheLayer | null;
  isStale: boolean;
  etag: string | null;
  savedAt: string | null;
  freshUntil: string | null;
  staleUntil: string | null;
  meta: Record<string, unknown>;
};

export type HotCacheWriteOptions = {
  freshForSeconds?: number;
  staleForSeconds?: number;
  meta?: Record<string, unknown>;
};

const memoryCache = new Map<string, HotCacheEnvelope<unknown>>();

function toIsoString(value: number | null | undefined): string | null {
  if (!Number.isFinite(value)) return null;
  return new Date(Number(value)).toISOString();
}

function normalizeLookup<T>(
  envelope: HotCacheEnvelope<T> | null | undefined,
  layer: HotCacheLayer | null,
): HotCacheLookup<T> {
  if (!envelope) {
    return {
      value: null,
      layer: null,
      isStale: false,
      etag: null,
      savedAt: null,
      freshUntil: null,
      staleUntil: null,
      meta: {},
    };
  }

  const now = Date.now();
  return {
    value: envelope.value,
    layer,
    isStale: now > envelope.freshUntilMs,
    etag: envelope.etag,
    savedAt: toIsoString(envelope.savedAtMs),
    freshUntil: toIsoString(envelope.freshUntilMs),
    staleUntil: toIsoString(envelope.staleUntilMs),
    meta: envelope.meta ?? {},
  };
}

function normalizeEnvelope<T>(value: unknown): HotCacheEnvelope<T> | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const savedAtMs = Number(row.savedAtMs);
  const freshUntilMs = Number(row.freshUntilMs);
  const staleUntilMs = Number(row.staleUntilMs);
  const etag = typeof row.etag === 'string' ? row.etag : '';
  if (
    !Number.isFinite(savedAtMs) ||
    !Number.isFinite(freshUntilMs) ||
    !Number.isFinite(staleUntilMs) ||
    staleUntilMs <= 0
  ) {
    return null;
  }

  return {
    value: (row.value ?? null) as T,
    savedAtMs,
    freshUntilMs,
    staleUntilMs,
    etag: etag || hashJsonValue(row.value ?? null),
    meta:
      typeof row.meta === 'object' && row.meta !== null
        ? (row.meta as Record<string, unknown>)
        : {},
  };
}

function readFromMemory<T>(key: string): HotCacheEnvelope<T> | null {
  const cached = memoryCache.get(key);
  if (!cached) return null;

  if (Date.now() > cached.staleUntilMs) {
    memoryCache.delete(key);
    return null;
  }

  return cached as HotCacheEnvelope<T>;
}

async function executeRedisCommand<T>(args: (string | number)[]): Promise<T | null> {
  if (!hasHotCacheEnv()) return null;

  const env = getHotCacheEnv();
  const response = await fetch(env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    cache: 'no-store',
  }).catch(() => null);

  if (!response?.ok) return null;

  const payload = (await response.json().catch(() => null)) as {
    result?: T;
    error?: string;
  } | null;

  if (!payload || payload.error) return null;
  return (payload.result ?? null) as T | null;
}

function defaultFreshForSeconds(): number {
  return hasHotCacheEnv() ? getHotCacheEnv().HOT_CACHE_FRESH_SECONDS : 15;
}

function defaultStaleForSeconds(): number {
  return hasHotCacheEnv() ? getHotCacheEnv().HOT_CACHE_STALE_SECONDS : 60;
}

export function isHotCacheConfigured(): boolean {
  return hasHotCacheEnv();
}

export async function loadHotCacheJson<T>(key: string): Promise<HotCacheLookup<T>> {
  const memoryValue = readFromMemory<T>(key);
  if (memoryValue) {
    return normalizeLookup(memoryValue, 'memory');
  }

  const storedValue = await executeRedisCommand<string>(['GET', key]);
  if (typeof storedValue !== 'string' || !storedValue.trim()) {
    return normalizeLookup<T>(null, null);
  }

  let parsed: HotCacheEnvelope<T> | null = null;
  try {
    parsed = normalizeEnvelope<T>(JSON.parse(storedValue));
  } catch {
    parsed = null;
  }
  if (!parsed || Date.now() > parsed.staleUntilMs) {
    void deleteHotCacheKey(key);
    return normalizeLookup<T>(null, null);
  }

  memoryCache.set(key, parsed);
  return normalizeLookup(parsed, 'redis');
}

export function saveHotCacheJson<T>(
  key: string,
  value: T,
  options: HotCacheWriteOptions = {},
): Promise<HotCacheLookup<T>> {
  const freshForSeconds = Math.max(
    1,
    Math.floor(options.freshForSeconds ?? defaultFreshForSeconds()),
  );
  const staleForSeconds = Math.max(
    freshForSeconds,
    Math.floor(options.staleForSeconds ?? defaultStaleForSeconds()),
  );
  const savedAtMs = Date.now();
  const envelope: HotCacheEnvelope<T> = {
    value,
    savedAtMs,
    freshUntilMs: savedAtMs + freshForSeconds * 1000,
    staleUntilMs: savedAtMs + staleForSeconds * 1000,
    etag: hashJsonValue(value),
    meta: options.meta ?? {},
  };

  memoryCache.set(key, envelope);

  if (hasHotCacheEnv()) {
    void executeRedisCommand(['SET', key, JSON.stringify(envelope), 'EX', staleForSeconds]).catch(
      () => null,
    );
  }

  return Promise.resolve(normalizeLookup(envelope, hasHotCacheEnv() ? 'redis' : 'memory'));
}

export async function deleteHotCacheKey(key: string): Promise<void> {
  memoryCache.delete(key);
  if (!hasHotCacheEnv()) return;
  await executeRedisCommand(['DEL', key]).catch(() => null);
}
