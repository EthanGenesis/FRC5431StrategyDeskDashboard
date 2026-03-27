type CachedEntry = {
  data: unknown;
  etag?: string;
  expiresAtMs: number;
};

const cache = new Map<string, CachedEntry>();

function trimErrorText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 220);
}

type ErrorPayload = {
  error: string;
};

function isErrorPayload(value: unknown): value is ErrorPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'string'
  );
}

export async function readJsonResponse<T>(res: Response): Promise<T | ErrorPayload | null> {
  const text = await res.text();
  if (!text) {
    return null;
  }

  const contentType = res.headers.get('content-type') ?? '';
  const trimmed = text.trim();
  const looksJson =
    contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[');

  if (!looksJson) {
    return { error: trimErrorText(text) };
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return { error: trimErrorText(text) };
  }
}

export async function fetchJsonOrThrow<T>(
  url: string,
  init?: RequestInit,
  fallbackMessage = 'Request failed',
): Promise<T> {
  const res = await fetch(url, init);
  const json = await readJsonResponse<T>(res);

  if (!res.ok) {
    const message = isErrorPayload(json) ? json.error : `${fallbackMessage} (${res.status})`;
    throw new Error(message);
  }

  return json as T;
}

function parseMaxAgeSeconds(cacheControl: string | null): number | null {
  if (!cacheControl) {
    return null;
  }

  const match = /max-age=(\d+)/i.exec(cacheControl);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export async function cachedFetchJson<T>(
  url: string,
  init?: RequestInit,
  defaultMaxAgeSeconds = 10,
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(url);

  if (existing?.data !== undefined && now < existing.expiresAtMs) {
    return existing.data as T;
  }

  const headers = new Headers(init?.headers ?? {});
  if (existing?.etag) {
    headers.set('If-None-Match', existing.etag);
  }

  const res = await fetch(url, { ...init, headers });

  if (res.status === 304 && existing?.data !== undefined) {
    const maxAge = parseMaxAgeSeconds(res.headers.get('Cache-Control')) ?? defaultMaxAgeSeconds;
    existing.expiresAtMs = now + maxAge * 1000;
    cache.set(url, existing);
    return existing.data as T;
  }

  if (!res.ok) {
    if (existing?.data !== undefined) {
      return existing.data as T;
    }

    throw new Error(`Fetch failed ${res.status} for ${url}`);
  }

  const data = await readJsonResponse<T>(res);
  const etag = res.headers.get('ETag') ?? undefined;
  const maxAge = parseMaxAgeSeconds(res.headers.get('Cache-Control')) ?? defaultMaxAgeSeconds;

  const nextEntry: CachedEntry = {
    data,
    expiresAtMs: now + maxAge * 1000,
  };

  if (etag) {
    nextEntry.etag = etag;
  }

  cache.set(url, nextEntry);

  return data as T;
}
