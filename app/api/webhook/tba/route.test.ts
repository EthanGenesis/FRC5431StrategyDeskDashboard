/* @vitest-environment node */
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMocks = vi.hoisted(() => ({
  getAppEnv: vi.fn(() => ({
    TBA_AUTH_KEY: 'test-key',
    TBA_WEBHOOK_SECRET: undefined,
    APP_LOG_LEVEL: 'info',
    NODE_ENV: 'test',
    OTEL_ENABLED: false,
    OTEL_DIAG_LOGGING: false,
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    OTEL_SERVICE_NAME: 'tbsb-dashboard',
  })) as any,
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
  beforeEach(() => {
    vi.clearAllMocks();
    envMocks.getAppEnv.mockReturnValue({
      TBA_AUTH_KEY: 'test-key',
      TBA_WEBHOOK_SECRET: undefined,
      APP_LOG_LEVEL: 'info',
      NODE_ENV: 'test',
      OTEL_ENABLED: false,
      OTEL_DIAG_LOGGING: false,
      OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
      OTEL_SERVICE_NAME: 'tbsb-dashboard',
    });
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
    envMocks.getAppEnv.mockReturnValue({
      TBA_AUTH_KEY: 'test-key',
      TBA_WEBHOOK_SECRET: 'super-secret',
      APP_LOG_LEVEL: 'info',
      NODE_ENV: 'test',
      OTEL_ENABLED: false,
      OTEL_DIAG_LOGGING: false,
      OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
      OTEL_SERVICE_NAME: 'tbsb-dashboard',
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
    envMocks.getAppEnv.mockReturnValue({
      TBA_AUTH_KEY: 'test-key',
      TBA_WEBHOOK_SECRET: 'super-secret',
      APP_LOG_LEVEL: 'info',
      NODE_ENV: 'test',
      OTEL_ENABLED: false,
      OTEL_DIAG_LOGGING: false,
      OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
      OTEL_SERVICE_NAME: 'tbsb-dashboard',
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
});
