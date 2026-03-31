import crypto from 'node:crypto';
import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAppEnv } from '../../../../lib/env';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../../lib/observability';
import { appendEventLiveSignal } from '../../../../lib/source-cache-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const tbaWebhookSchema = z.object({
  message_type: z.string().min(1),
  message_data: z.record(z.string(), z.unknown()).default({}),
  webhook_id: z.union([z.string(), z.number()]).optional(),
});

function readString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function readNullableString(value: unknown): string | null {
  const normalized = readString(value).trim();
  return normalized.length ? normalized : null;
}

function humanizeSignalType(messageType: string): string {
  return `TBA ${String(messageType).replace(/_/g, ' ')}`;
}

function buildSignalBody(
  messageType: string,
  data: Record<string, unknown>,
  eventRecord: Record<string, unknown> | null,
  matchRecord: Record<string, unknown> | null,
  teamRecord: Record<string, unknown> | null,
): string {
  const eventName =
    readNullableString(eventRecord?.name) ??
    readNullableString(data.event_name) ??
    readNullableString(data.eventKey) ??
    readNullableString(data.event_key);
  const matchKey =
    readNullableString(data.match_key) ??
    readNullableString(matchRecord?.key) ??
    readNullableString(matchRecord?.label) ??
    readNullableString(data.match);
  const teamKey =
    readNullableString(data.team_key) ??
    readNullableString(teamRecord?.key) ??
    readNullableString(data.team);
  const levelName =
    readNullableString(data.level_name) ??
    readNullableString(data.level) ??
    readNullableString(data.description);
  const broadcastText =
    readNullableString(data.message) ??
    readNullableString(data.text) ??
    readNullableString(data.content) ??
    readNullableString(data.body);

  if (messageType === 'alliance_selection') {
    return eventName
      ? `${eventName} alliance selection is active. Send your rep.`
      : 'Alliance selection is active. Send your rep.';
  }

  if (messageType === 'level_starting') {
    return (
      [levelName, matchKey, eventName].filter(Boolean).join(' • ') || 'A playoff level is starting.'
    );
  }

  if (messageType === 'broadcast') {
    return broadcastText ?? eventName ?? 'Event broadcast received.';
  }

  if (messageType === 'verification') {
    return 'Webhook verification received.';
  }

  if (messageType === 'ping') {
    return 'Webhook ping received.';
  }

  const parts = [matchKey, teamKey, eventName].filter(Boolean);
  return parts.length ? parts.join(' • ') : `TBA webhook: ${messageType}`;
}

function isValidTbaSignature(rawBody: string, headerValue: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const normalizedReceived = headerValue.trim().toLowerCase();
  const normalizedExpected = expected.trim().toLowerCase();

  if (normalizedReceived.length !== normalizedExpected.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(normalizedReceived, 'utf8'),
    Buffer.from(normalizedExpected, 'utf8'),
  );
}

function normalizeTbaWebhookSignal(payload: z.infer<typeof tbaWebhookSchema>) {
  const messageType = String(payload.message_type ?? 'unknown');
  const data = payload.message_data ?? {};
  const eventRecord =
    data.event && typeof data.event === 'object' ? (data.event as Record<string, unknown>) : null;
  const matchRecord =
    data.match && typeof data.match === 'object' ? (data.match as Record<string, unknown>) : null;
  const teamRecord =
    data.team && typeof data.team === 'object' ? (data.team as Record<string, unknown>) : null;
  const eventKey =
    (typeof data.event_key === 'string' && data.event_key) ||
    (typeof data.eventKey === 'string' && data.eventKey) ||
    (typeof eventRecord?.key === 'string' && eventRecord.key) ||
    null;

  if (!eventKey && ['verification', 'ping'].includes(messageType)) {
    return null;
  }

  if (!eventKey) {
    throw new Error('TBA webhook payload is missing event_key.');
  }

  const titleMap: Record<string, string> = {
    upcoming_match: 'Upcoming match',
    match_score: 'Match score posted',
    match_video: 'Match video posted',
    level_starting: 'Playoff level starting',
    alliance_selection: 'Alliance selection updated',
    awards_posted: 'Awards posted',
    schedule_updated: 'Schedule updated',
    broadcast: 'Event broadcast',
    ping: 'Webhook ping',
    verification: 'Webhook verification',
  };

  const matchKey =
    (typeof data.match_key === 'string' && data.match_key) ||
    (typeof matchRecord?.key === 'string' && matchRecord.key) ||
    null;
  const teamKey =
    (typeof data.team_key === 'string' && data.team_key) ||
    (typeof teamRecord?.key === 'string' && teamRecord.key) ||
    null;

  return {
    eventKey,
    source: 'tba_webhook',
    signalType: messageType,
    title: titleMap[messageType] ?? humanizeSignalType(messageType),
    body: buildSignalBody(messageType, data, eventRecord, matchRecord, teamRecord),
    dedupeKey:
      `${eventKey}::${messageType}::${matchKey ?? ''}::${teamKey ?? ''}::${String(payload.webhook_id ?? '')}`.trim(),
    payload: {
      messageType,
      messageData: data,
      webhookId: payload.webhook_id ?? null,
    },
  };
}

type TbaWebhookOkResponse = {
  ok: true;
  persistence: {
    status: string;
    persisted: boolean;
    detail: string | null;
    signalId: string | null;
  } | null;
};

export async function POST(
  req: Request,
): Promise<NextResponse<TbaWebhookOkResponse | { error: string }>> {
  const routeContext = beginRouteRequest('/api/webhook/tba', req);

  try {
    const rawBody = await req.text();
    const raw = JSON.parse(rawBody) as unknown;
    const parsed = tbaWebhookSchema.parse(raw);
    const env = getAppEnv();

    if (env.TBA_WEBHOOK_SECRET) {
      const receivedSignature = req.headers.get('x-tba-hmac')?.trim() ?? '';
      if (!receivedSignature) {
        return routeErrorJson(routeContext, 'Missing X-TBA-HMAC header', 401);
      }
      if (!isValidTbaSignature(rawBody, receivedSignature, env.TBA_WEBHOOK_SECRET)) {
        return routeErrorJson(routeContext, 'Invalid TBA webhook signature', 401);
      }
    }

    const normalized = normalizeTbaWebhookSignal(parsed);
    if (normalized) {
      const persistence = await appendEventLiveSignal(normalized);
      return routeJson(
        routeContext,
        {
          ok: true,
          persistence,
        },
        {
          headers: {
            'x-tbsb-persistence-status': persistence.status,
          },
        },
        {
          eventKey: normalized.eventKey,
          signalType: normalized.signalType,
          persisted: persistence.persisted,
          persistenceStatus: persistence.status,
          persistenceDetail: persistence.detail,
          signalId: persistence.signalId,
        },
      );
    }

    return routeJson(
      routeContext,
      {
        ok: true,
        persistence: null,
      },
      {
        headers: {
          'x-tbsb-persistence-status': 'skipped',
        },
      },
      {
        persistenceStatus: 'skipped',
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown TBA webhook error';
    return routeErrorJson(routeContext, message, 400);
  }
}
