import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cachedFetchJson, fetchJsonOrThrow } from './httpCache';

describe('httpCache timeouts', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('times out hanging requests instead of waiting forever', async () => {
    const hangingFetch: typeof fetch = (input, init) => {
      void input;
      const signal = init?.signal;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            const reason: unknown = signal.reason;
            reject(reason instanceof Error ? reason : new Error('aborted'));
          },
          { once: true },
        );
      });
    };
    global.fetch = vi.fn(hangingFetch);

    const request = fetchJsonOrThrow('https://example.com/hang');
    const rejection = expect(request).rejects.toThrow(
      'Request timed out after 8000ms for https://example.com/hang',
    );
    await vi.advanceTimersByTimeAsync(8000);
    await rejection;
  });

  it('returns stale cached data when a refresh attempt times out', async () => {
    const url = 'https://example.com/stale-cache';
    const hangingFetch: typeof fetch = (input, init) => {
      void input;
      const signal = init?.signal;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            const reason: unknown = signal.reason;
            reject(reason instanceof Error ? reason : new Error('aborted'));
          },
          { once: true },
        );
      });
    };
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ source: 'fresh-cache' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'max-age=1',
          },
        }),
      )
      .mockImplementationOnce(hangingFetch);

    await expect(cachedFetchJson<{ source: string }>(url, undefined, 1)).resolves.toEqual({
      source: 'fresh-cache',
    });

    await vi.advanceTimersByTimeAsync(1500);

    const request = cachedFetchJson<{ source: string }>(url, undefined, 1);
    await vi.advanceTimersByTimeAsync(8000);

    await expect(request).resolves.toEqual({ source: 'fresh-cache' });
  });
});
