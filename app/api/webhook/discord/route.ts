import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { beginRouteRequest, routeErrorJson, routeJson } from '../../../../lib/observability';
import type { DiscordWebhookPayload } from '../../../../lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const discordWebhookSchema = z.object({
  webhookUrl: z
    .string()
    .url()
    .refine(
      (value) =>
        /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/[^/]+\/[^/]+/i.test(value),
      'Discord webhook URL is invalid',
    ),
  displayName: z.string().trim().max(80).optional(),
  eventKey: z.enum([
    'queue_5',
    'queue_2',
    'queue_1',
    'playing_now',
    'mode_changed',
    'snapshot_failed',
    'snapshot_recovered',
    'manual_load_failed',
    'warning',
    'test',
  ]),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  fields: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        value: z.string().trim().min(1).max(500),
      }),
    )
    .max(10)
    .optional(),
});

function colorForEvent(eventKey: DiscordWebhookPayload['eventKey']): number {
  switch (eventKey) {
    case 'playing_now':
    case 'queue_1':
      return 0xef8f87;
    case 'snapshot_failed':
    case 'manual_load_failed':
      return 0xdc2626;
    case 'warning':
      return 0xe9c36d;
    case 'snapshot_recovered':
      return 0x5fd2a2;
    default:
      return 0x67d2ee;
  }
}

export async function POST(req: Request): Promise<NextResponse<{ ok: true } | { error: string }>> {
  const routeContext = beginRouteRequest('/api/webhook/discord', req);

  try {
    const parsed = discordWebhookSchema.safeParse(await req.json());
    if (!parsed.success) {
      return routeErrorJson(
        routeContext,
        parsed.error.issues[0]?.message ?? 'Invalid payload',
        400,
      );
    }

    const payload = {
      username: parsed.data.displayName?.trim() ?? 'Strategy Desk',
      embeds: [
        {
          title: parsed.data.title,
          description: parsed.data.body,
          color: colorForEvent(parsed.data.eventKey),
          fields: (parsed.data.fields ?? []).map((field) => ({
            name: field.name,
            value: field.value,
            inline: true,
          })),
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const response = await fetch(parsed.data.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      return routeErrorJson(
        routeContext,
        `Discord webhook rejected the request (${response.status}): ${text.slice(0, 200)}`,
        502,
      );
    }

    return routeJson(routeContext, { ok: true }, undefined, {
      eventKey: parsed.data.eventKey,
      fieldCount: parsed.data.fields?.length ?? 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Discord webhook error';
    return routeErrorJson(routeContext, message, 500);
  }
}
