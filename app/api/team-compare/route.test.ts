/* @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { POST } from './route';

describe('/api/team-compare', () => {
  it('returns 400 when no compare teams are provided', async () => {
    const response = await POST(
      new Request('http://localhost/api/team-compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teams: [] }),
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Missing teams' });
  });
});
