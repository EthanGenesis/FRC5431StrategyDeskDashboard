/* @vitest-environment node */
import { beforeEach, describe, expect, it } from 'vitest';

import { POST } from './route';

describe('/api/data-super', () => {
  const originalAuthKey = process.env.TBA_AUTH_KEY;

  beforeEach(() => {
    process.env.TBA_AUTH_KEY = 'test-key';
  });

  it('returns an empty but valid payload when no event/team/compare context is requested', async () => {
    const response = await POST(
      new Request('http://localhost/api/data-super', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = (await response.json()) as {
      loadedEventKey: string | null;
      loadedTeam: number | null;
      currentEvent: unknown;
      compare: unknown;
      rawPayloads: {
        tba: unknown;
        sb: unknown;
        historicalTeam: unknown;
      };
    };

    expect(response.status).toBe(200);
    expect(body.loadedEventKey).toBeNull();
    expect(body.loadedTeam).toBeNull();
    expect(body.currentEvent).toBeNull();
    expect(body.compare).toBeNull();
    expect(body.rawPayloads).toEqual({
      tba: null,
      sb: null,
      historicalTeam: null,
    });
  });

  afterAll(() => {
    process.env.TBA_AUTH_KEY = originalAuthKey;
  });
});
