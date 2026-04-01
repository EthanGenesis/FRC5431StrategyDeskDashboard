import type { NextResponse } from 'next/server';
import type { AppSnapshot } from '../../../lib/types';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { loadSnapshotCacheRecord, saveSnapshotCacheRecord } from '../../../lib/source-cache-server';
import {
  parsePositiveTeamNumber,
  parseRequiredEventKey,
  loadEventContext,
} from '../../../lib/server-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const WARM_SNAPSHOT_MAX_AGE_SECONDS = 90;

export async function GET(req: Request): Promise<NextResponse<AppSnapshot | { error: string }>> {
  const routeContext = beginRouteRequest('/api/snapshot', req);
  const { searchParams } = new URL(req.url);

  try {
    const eventKey = parseRequiredEventKey(searchParams.get('eventKey') ?? '');
    const team = parsePositiveTeamNumber(searchParams.get('team') ?? '');
    const preferWarm = searchParams.get('warm') === '1' || searchParams.get('warm') === 'true';
    const teamKey = `frc${team}`;

    if (preferWarm) {
      const cachedPayload = await loadSnapshotCacheRecord<AppSnapshot>(
        'snapshot',
        eventKey,
        team,
        WARM_SNAPSHOT_MAX_AGE_SECONDS,
      );
      if (cachedPayload) {
        return routeJson(routeContext, cachedPayload, undefined, {
          eventKey,
          team,
          source: 'warm_cache',
        });
      }
    }

    const eventContext = await loadEventContext(eventKey, team);

    const payload: AppSnapshot = {
      generatedAtMs: Date.now(),
      inputs: {
        eventKey,
        team,
        teamKey,
      },
      tba: eventContext.tba,
      sb: eventContext.sb,
      official: eventContext.official ?? null,
      nexus: eventContext.nexus ?? null,
      media: eventContext.media ?? null,
      validation: eventContext.validation ?? null,
      liveSignals: eventContext.liveSignals ?? [],
    };

    void saveSnapshotCacheRecord({
      source: 'snapshot',
      eventKey,
      teamNumber: team,
      generatedAt: payload.generatedAtMs,
      payload,
    });

    return routeJson(routeContext, payload, undefined, {
      eventKey,
      team,
    });
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
