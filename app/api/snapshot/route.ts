import type { NextResponse } from 'next/server';
import type { AppSnapshot } from '../../../lib/types';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import {
  parsePositiveTeamNumber,
  parseRequiredEventKey,
  loadEventContext,
} from '../../../lib/server-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse<AppSnapshot | { error: string }>> {
  const routeContext = beginRouteRequest('/api/snapshot', req);
  const { searchParams } = new URL(req.url);

  try {
    const eventKey = parseRequiredEventKey(searchParams.get('eventKey') ?? '');
    const team = parsePositiveTeamNumber(searchParams.get('team') ?? '');
    const teamKey = `frc${team}`;
    const eventContext = await loadEventContext(eventKey);

    return routeJson(
      routeContext,
      {
        generatedAtMs: Date.now(),
        inputs: {
          eventKey,
          team,
          teamKey,
        },
        tba: eventContext.tba,
        sb: eventContext.sb,
      },
      undefined,
      {
        eventKey,
        team,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Missing or invalid eventKey/team';
    const status =
      message === 'Missing TBA_AUTH_KEY in .env.local'
        ? 500
        : message.includes('invalid') || message.includes('Expected')
          ? 400
          : 500;

    return routeErrorJson(routeContext, message, status);
  }
}
