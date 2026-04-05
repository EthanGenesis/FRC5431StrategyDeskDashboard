import type { NextResponse } from 'next/server';

import { buildPickListAnalysis } from '../../../lib/decision-support';
import { readJsonResponse } from '../../../lib/httpCache';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { PERSISTENCE_TABLES } from '../../../lib/persistence-surfaces';
import { loadSharedActiveTarget } from '../../../lib/shared-target-server';
import { loadNamedArtifactsSharedServer } from '../../../lib/shared-workspace-server';
import type { PickListBundlePayload } from '../../../lib/tab-bundle-builders';
import type { PickListAnalysisResponse } from '../../../lib/types';
import { getEventWorkspaceKey } from '../../../lib/workspace-key';
import { POST as postPickListBundleRoute } from '../pick-list-bundle/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PickListArtifactRecord = {
  id: string;
  name?: string;
  createdAt?: number | string | null;
  first?: {
    teamKey: string;
    comment?: string | null;
    tag?: string | null;
    teamNumber?: number | null;
    nickname?: string | null;
  }[];
  second?: {
    teamKey: string;
    comment?: string | null;
    tag?: string | null;
    teamNumber?: number | null;
    nickname?: string | null;
  }[];
  avoid?: {
    teamKey: string;
    comment?: string | null;
    tag?: string | null;
    teamNumber?: number | null;
    nickname?: string | null;
  }[];
};

function parseOptionalTeamNumber(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export async function GET(
  req: Request,
): Promise<NextResponse<PickListAnalysisResponse | { error: string }>> {
  const routeContext = beginRouteRequest('/api/pick-list-analysis', req);
  try {
    const { searchParams } = new URL(req.url);
    const sharedTarget = await loadSharedActiveTarget();
    const eventKey = String(searchParams.get('eventKey') ?? sharedTarget.eventKey ?? '').trim();
    const teamNumber =
      parseOptionalTeamNumber(searchParams.get('team')) ?? sharedTarget.teamNumber ?? null;
    const activePickListId = String(searchParams.get('activePickListId') ?? '').trim() || null;

    if (!eventKey || !teamNumber) {
      return routeErrorJson(routeContext, 'A loaded event and team are required.', 400);
    }

    const bundleResponse = await postPickListBundleRoute(
      new Request('http://localhost/api/pick-list-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventKey, teamNumber }),
      }),
    );
    const bundlePayload = await readJsonResponse<{
      payload?: PickListBundlePayload;
      error?: string;
    }>(bundleResponse);
    if (
      !bundleResponse.ok ||
      !bundlePayload ||
      'error' in bundlePayload ||
      !bundlePayload.payload
    ) {
      return routeErrorJson(
        routeContext,
        bundlePayload && 'error' in bundlePayload
          ? bundlePayload.error
          : 'Failed to load pick-list bundle.',
        bundleResponse.status || 500,
      );
    }

    const workspaceKey = getEventWorkspaceKey(eventKey) ?? sharedTarget.workspaceKey;
    const pickLists = await loadNamedArtifactsSharedServer<PickListArtifactRecord>(
      PERSISTENCE_TABLES.pickLists,
      workspaceKey,
    );

    const response = buildPickListAnalysis({
      workspaceKey,
      eventKey,
      teamNumber,
      activePickListId,
      bundle: bundlePayload.payload,
      pickLists,
    });

    return routeJson(routeContext, response, undefined, {
      workspaceKey,
      eventKey,
      teamNumber,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown pick-list analysis error';
    return routeErrorJson(routeContext, message, 500);
  }
}
