import type { NextResponse } from 'next/server';

import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { buildPitOpsResponse } from '../../../lib/pit-ops';
import { loadSnapshotCacheRecord, saveSnapshotCacheRecord } from '../../../lib/source-cache-server';
import { loadSharedActiveTarget } from '../../../lib/shared-target-server';
import type { AppSnapshot, PitOpsResponse } from '../../../lib/types';
import { getEventWorkspaceKey } from '../../../lib/workspace-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WARM_PIT_OPS_MAX_AGE_SECONDS = 90;

function parseOptionalTeamNumber(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function emptyPitOpsResponse(workspaceKey: string): PitOpsResponse {
  return {
    generatedAtMs: Date.now(),
    workspaceKey,
    eventKey: null,
    eventName: null,
    teamNumber: null,
    currentMatchLabel: null,
    nextMatchLabel: null,
    countdownMs: null,
    bumperColor: null,
    allianceColor: null,
    queueState: null,
    queueMatchesAway: null,
    queueLadder: [],
    pitAddress: null,
    inspectionStatus: null,
    estimatedQueueTimeMs: null,
    estimatedOnDeckTimeMs: null,
    estimatedOnFieldTimeMs: null,
    estimatedStartTimeMs: null,
    timeline: [],
  };
}

export async function GET(req: Request): Promise<NextResponse<PitOpsResponse | { error: string }>> {
  const routeContext = beginRouteRequest('/api/pit-ops', req);
  try {
    const { searchParams } = new URL(req.url);
    const sharedTarget = await loadSharedActiveTarget();
    const eventKey = String(searchParams.get('eventKey') ?? sharedTarget.eventKey ?? '').trim();
    const teamNumber =
      parseOptionalTeamNumber(searchParams.get('team')) ?? sharedTarget.teamNumber ?? null;
    const workspaceKey = eventKey
      ? (getEventWorkspaceKey(eventKey) ?? sharedTarget.workspaceKey)
      : sharedTarget.workspaceKey;

    if (!eventKey || !teamNumber) {
      return routeJson(routeContext, emptyPitOpsResponse(workspaceKey), undefined, {
        workspaceKey,
      });
    }

    const cachedPayload = await loadSnapshotCacheRecord<PitOpsResponse>(
      'pit_ops',
      eventKey,
      teamNumber,
      WARM_PIT_OPS_MAX_AGE_SECONDS,
    );
    if (cachedPayload) {
      return routeJson(routeContext, cachedPayload, undefined, {
        workspaceKey,
        eventKey,
        teamNumber,
        cacheState: 'warm',
        source: 'warm_cache',
      });
    }

    const snapshot = await loadSnapshotCacheRecord<AppSnapshot>(
      'snapshot',
      eventKey,
      teamNumber,
      WARM_PIT_OPS_MAX_AGE_SECONDS,
    ).catch(() => null);

    const response = buildPitOpsResponse({
      workspaceKey,
      eventKey,
      teamNumber,
      snapshot,
    });
    void saveSnapshotCacheRecord({
      source: 'pit_ops',
      eventKey,
      teamNumber,
      generatedAt: response.generatedAtMs,
      payload: response,
    });

    return routeJson(routeContext, response, undefined, {
      workspaceKey,
      eventKey,
      teamNumber,
      cacheState: snapshot ? 'cold' : 'empty',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown pit-ops error';
    return routeErrorJson(routeContext, message, 500);
  }
}
