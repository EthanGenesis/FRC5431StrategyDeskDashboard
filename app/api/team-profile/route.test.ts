/* @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('/api/team-profile', () => {
  it('returns 400 for invalid team numbers', async () => {
    const response = await GET(new Request('http://localhost/api/team-profile?team=0'));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Missing or invalid team' });
  });
});
