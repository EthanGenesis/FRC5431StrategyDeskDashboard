import type { NextResponse } from 'next/server';
import type { EventContextSnapshot } from '../../../lib/strategy-types';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { saveSnapshotCacheRecord } from '../../../lib/source-cache-server';
import { loadEventContext, parseRequiredEventKey } from '../../../lib/server-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
): Promise<NextResponse<EventContextSnapshot | { error: string }>> {
  const routeContext = beginRouteRequest('/api/event-context', req);
  const { searchParams } = new URL(req.url);

  try {
    const eventKey = parseRequiredEventKey(searchParams.get('eventKey') ?? '');
    const eventContext = await loadEventContext(eventKey, null);

    const payload: EventContextSnapshot = {
      generatedAtMs: Date.now(),
      inputs: {
        eventKey,
      },
      tba: {
        event: eventContext.tba.event,
        matches: eventContext.tba.matches,
        rankings: eventContext.tba.rankings,
        oprs: eventContext.tba.oprs,
        alliances: eventContext.tba.alliances,
        status: eventContext.tba.status,
        insights: eventContext.tba.insights,
        awards: eventContext.tba.awards,
        teams: eventContext.tba.teams,
      },
      sb: eventContext.sb,
      official: eventContext.official ?? null,
      nexus: eventContext.nexus ?? null,
      media: eventContext.media ?? null,
      validation: eventContext.validation ?? null,
      liveSignals: eventContext.liveSignals ?? [],
    };

    void saveSnapshotCacheRecord({
      source: 'event_context',
      eventKey,
      teamNumber: null,
      generatedAt: payload.generatedAtMs,
      payload,
    });

    return routeJson(routeContext, payload, undefined, { eventKey });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown event-context error';
    const status = message === 'Missing TBA_AUTH_KEY in .env.local' ? 500 : 400;
    return routeErrorJson(routeContext, message, status);
  }
}
