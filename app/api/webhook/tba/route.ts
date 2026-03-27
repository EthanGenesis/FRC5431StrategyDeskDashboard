import crypto from 'node:crypto';
import { z } from 'zod';
import type { NextResponse } from 'next/server';

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

  if (!eventKey) {
    throw new Error('TBA webhook payload is missing event_key.');
  }

  const titleMap: Record<string, string> = {
    upcoming_match: 'Upcoming match',
    match_score: 'Match score posted',
    alliance_selection: 'Alliance selection updated',
    awards_posted: 'Awards posted',
    schedule_updated: 'Schedule updated',
    match_video: 'Match video posted',
  };

  const matchKey =
    (typeof data.match_key === 'string' && data.match_key) ||
    (typeof matchRecord?.key === 'string' && matchRecord.key) ||
    null;
  const teamKey =
    (typeof data.team_key === 'string' && data.team_key) ||
    (typeof teamRecord?.key === 'string' && teamRecord.key) ||
    null;

  const bodyParts = [matchKey, teamKey].filter(Boolean);

  return {
    eventKey,
    source: 'tba_webhook',
    signalType: messageType,
    title: titleMap[messageType] ?? `TBA ${messageType.replace(/_/g, ' ')}`,
    body: bodyParts.length ? bodyParts.join(' • ') : `TBA webhook: ${messageType}`,
    dedupeKey:
      `${eventKey}::${messageType}::${matchKey ?? ''}::${teamKey ?? ''}::${String(payload.webhook_id ?? '')}`.trim(),
    payload: {
      messageType,
      messageData: data,
      webhookId: payload.webhook_id ?? null,
    },
  };
}

export async function POST(req: Request): Promise<NextResponse<{ ok: true } | { error: string }>> {
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
    await appendEventLiveSignal(normalized);

    return routeJson(routeContext, { ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown TBA webhook error';
    return routeErrorJson(routeContext, message, 400);
  }
}
