import type { NextResponse } from 'next/server';

import { buildPlayoffSummary } from '../../../lib/decision-support';
import { readJsonResponse } from '../../../lib/httpCache';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { PERSISTENCE_TABLES } from '../../../lib/persistence-surfaces';
import { loadSharedActiveTarget } from '../../../lib/shared-target-server';
import { loadNamedArtifactsSharedServer } from '../../../lib/shared-workspace-server';
import type { PlayoffBundlePayload } from '../../../lib/tab-bundle-builders';
import type { PlayoffSummaryResponse } from '../../../lib/types';
import { getEventWorkspaceKey } from '../../../lib/workspace-key';
import { POST as postPlayoffBundleRoute } from '../playoff-bundle/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PlayoffArtifactRecord = {
  id: string;
  name?: string;
  createdAt?: number | string | null;
  ourSummary?: {
    seed?: number | null;
    bestRound?: string | null;
    champ?: number | null;
    finals?: number | null;
    upperFinal?: number | null;
  } | null;
  manualSummary?: {
    bestRound?: string | null;
  } | null;
};

function parseOptionalTeamNumber(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export async function GET(
  req: Request,
): Promise<NextResponse<PlayoffSummaryResponse | { error: string }>> {
  const routeContext = beginRouteRequest('/api/playoff-summary', req);
  try {
    const { searchParams } = new URL(req.url);
    const sharedTarget = await loadSharedActiveTarget();
    const eventKey = String(searchParams.get('eventKey') ?? sharedTarget.eventKey ?? '').trim();
    const teamNumber =
      parseOptionalTeamNumber(searchParams.get('team')) ?? sharedTarget.teamNumber ?? null;
    const activeScenarioId = String(searchParams.get('activeScenarioId') ?? '').trim() || null;
    const model = String(searchParams.get('model') ?? 'composite').trim() || 'composite';
    const simRunsRaw = Number(searchParams.get('simRuns') ?? 1000);
    const simRuns = Number.isFinite(simRunsRaw) && simRunsRaw > 0 ? Math.floor(simRunsRaw) : 1000;

    if (!eventKey || !teamNumber) {
      return routeErrorJson(routeContext, 'A loaded event and team are required.', 400);
    }

    const bundleResponse = await postPlayoffBundleRoute(
      new Request('http://localhost/api/playoff-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventKey, teamNumber, model, simRuns }),
      }),
    );
    const bundlePayload = await readJsonResponse<{
      payload?: PlayoffBundlePayload;
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
          : 'Failed to load playoff bundle.',
        bundleResponse.status || 500,
      );
    }

    const workspaceKey = getEventWorkspaceKey(eventKey) ?? sharedTarget.workspaceKey;
    const savedResults = await loadNamedArtifactsSharedServer<PlayoffArtifactRecord>(
      PERSISTENCE_TABLES.playoffResults,
      workspaceKey,
    );

    const response = buildPlayoffSummary({
      workspaceKey,
      eventKey,
      teamNumber,
      activeScenarioId,
      bundle: bundlePayload.payload,
      savedResults,
    });

    return routeJson(routeContext, response, undefined, {
      workspaceKey,
      eventKey,
      teamNumber,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown playoff summary error';
    return routeErrorJson(routeContext, message, 500);
  }
}
