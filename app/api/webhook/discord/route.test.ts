/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

describe('/api/webhook/discord', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 400 for an invalid Discord webhook payload', async () => {
    const response = await POST(
      new Request('http://localhost/api/webhook/discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl: 'https://example.com/not-discord',
          eventKey: 'test',
          title: 'Hello',
          body: 'World',
        }),
      }),
    );

    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('Discord webhook URL is invalid');
  });

  it('proxies a valid Discord webhook payload and returns success', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );

    const response = await POST(
      new Request('http://localhost/api/webhook/discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl: 'https://discord.com/api/webhooks/123/abc',
          eventKey: 'test',
          title: 'Strategy Desk Test',
          body: 'Webhook route test',
          displayName: 'Strategy Desk',
          fields: [{ name: 'Event', value: '2026test' }],
        }),
      }),
    );

    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/123/abc',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
