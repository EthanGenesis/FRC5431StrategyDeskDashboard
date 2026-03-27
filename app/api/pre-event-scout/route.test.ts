/* @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('/api/pre-event-scout', () => {
  it('returns 400 for a missing event key', async () => {
    const response = await GET(new Request('http://localhost/api/pre-event-scout'));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('Too small');
  });
});
