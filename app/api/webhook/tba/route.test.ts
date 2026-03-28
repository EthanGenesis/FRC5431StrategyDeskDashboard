/* @vitest-environment node */
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../../../lib/env';

const envMocks = vi.hoisted(() => ({
  getAppEnv: vi.fn<() => AppEnv>(() => ({
    TBA_AUTH_KEY: 'test-key',
    TBA_WEBHOOK_SECRET: undefined,
    APP_LOG_LEVEL: 'info',
    NODE_ENV: 'test',
    OTEL_ENABLED: false,
    OTEL_DIAG_LOGGING: false,
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    OTEL_SERVICE_NAME: 'tbsb-dashboard',
  })),
}));

const sourceCacheMocks = vi.hoisted(() => ({
  appendEventLiveSignal: vi.fn(),
}));

vi.mock('../../../../lib/env', () => ({
  getAppEnv: envMocks.getAppEnv,
}));

vi.mock('../../../../lib/source-cache-server', () => ({
  appendEventLiveSignal: sourceCacheMocks.appendEventLiveSignal,
}));

import { POST } from './route';

describe('/api/webhook/tba', () => {
  const defaultEnv: AppEnv = {
    TBA_AUTH_KEY: 'test-key',
    TBA_WEBHOOK_SECRET: undefined,
    APP_LOG_LEVEL: 'info',
    NODE_ENV: 'test',
    OTEL_ENABLED: false,
    OTEL_DIAG_LOGGING: false,
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    OTEL_SERVICE_NAME: 'tbsb-dashboard',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(envMocks.getAppEnv).mockReturnValue(defaultEnv);
  });

  it('normalizes and stores valid webhook events', async () => {
    const response = await POST(
      new Request('http://localhost/api/webhook/tba', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message_type: 'upcoming_match',
          webhook_id: 'abc123',
          message_data: {
            event_key: '2026test',
            match_key: '2026test_qm1',
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(sourceCacheMocks.appendEventLiveSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: '2026test',
        signalType: 'upcoming_match',
      }),
    );
  });

  it('rejects payloads without an event key', async () => {
    const response = await POST(
      new Request('http://localhost/api/webhook/tba', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message_type: 'upcoming_match',
          message_data: {},
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'TBA webhook payload is missing event_key.',
    });
  });

  it('validates X-TBA-HMAC when a webhook secret is configured', async () => {
    vi.mocked(envMocks.getAppEnv).mockReturnValue({
      ...defaultEnv,
      TBA_WEBHOOK_SECRET: 'super-secret',
    });

    const body = JSON.stringify({
      message_type: 'upcoming_match',
      webhook_id: 'abc123',
      message_data: {
        event_key: '2026test',
        match_key: '2026test_qm1',
      },
    });
    const signature = crypto.createHmac('sha256', 'super-secret').update(body).digest('hex');

    const response = await POST(
      new Request('http://localhost/api/webhook/tba', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tba-hmac': signature,
        },
        body,
      }),
    );

    expect(response.status).toBe(200);
  });

  it('rejects invalid X-TBA-HMAC when a webhook secret is configured', async () => {
    vi.mocked(envMocks.getAppEnv).mockReturnValue({
      ...defaultEnv,
      TBA_WEBHOOK_SECRET: 'super-secret',
    });

    const response = await POST(
      new Request('http://localhost/api/webhook/tba', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tba-hmac': 'not-valid',
        },
        body: JSON.stringify({
          message_type: 'upcoming_match',
          message_data: {
            event_key: '2026test',
          },
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Invalid TBA webhook signature',
    });
  });

  it('accepts verification payloads without an event key when the signature is valid', async () => {
    vi.mocked(envMocks.getAppEnv).mockReturnValue({
      ...defaultEnv,
      TBA_WEBHOOK_SECRET: 'super-secret',
    });

    const body = JSON.stringify({
      message_type: 'verification',
      webhook_id: 'verify-1',
      message_data: {
        verification_key: 'abc123',
      },
    });
    const signature = crypto.createHmac('sha256', 'super-secret').update(body).digest('hex');

    const response = await POST(
      new Request('http://localhost/api/webhook/tba', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tba-hmac': signature,
        },
        body,
      }),
    );

    expect(response.status).toBe(200);
    expect(sourceCacheMocks.appendEventLiveSignal).not.toHaveBeenCalled();
  });

  it('normalizes alliance selection into a desk-readable signal', async () => {
    const response = await POST(
      new Request('http://localhost/api/webhook/tba', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message_type: 'alliance_selection',
          webhook_id: 'alliance-1',
          message_data: {
            event_key: '2026test',
            event_name: 'Test Regional',
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(sourceCacheMocks.appendEventLiveSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        signalType: 'alliance_selection',
        title: 'Alliance selection updated',
        body: 'Test Regional alliance selection is active. Send your rep.',
      }),
    );
  });

  it('normalizes broadcast messages when an event key is present', async () => {
    const response = await POST(
      new Request('http://localhost/api/webhook/tba', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message_type: 'broadcast',
          webhook_id: 'broadcast-1',
          message_data: {
            event_key: '2026test',
            message: 'Send your rep to the scoring table.',
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(sourceCacheMocks.appendEventLiveSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        signalType: 'broadcast',
        title: 'Event broadcast',
        body: 'Send your rep to the scoring table.',
      }),
    );
  });
});
