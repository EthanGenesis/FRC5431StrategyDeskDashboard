import type { NextResponse } from 'next/server';

import {
  maybeProxyToHotDataPlane,
  queueHotDataPlaneParityCheck,
} from '../../../lib/hot-plane-server';
import { readJsonResponse } from '../../../lib/httpCache';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import {
  loadCompareDraftSharedServer,
  loadCompareSetsSharedServer,
} from '../../../lib/shared-workspace-server';
import {
  resolveBundleTarget,
  resolveWarmBundle,
  type WarmBundleRouteResponse,
} from '../../../lib/tab-bundle-server';
import type { TeamCompareSnapshot } from '../../../lib/types';
import { POST as teamComparePost } from '../team-compare/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CompareBundleBody = {
  eventKey?: unknown;
  teamNumber?: unknown;
  forceRefresh?: unknown;
  teamNumbers?: unknown;
  scenarioId?: unknown;
  scope?: unknown;
};

type CompareBundlePayload = {
  generatedAtMs: number;
  compareScope: 'current' | 'historical';
  teamNumbers: number[];
  compareSetId: string | null;
  snapshot: TeamCompareSnapshot;
};

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTeamNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => Math.floor(Number(item)))
        .filter((item) => Number.isFinite(item) && item > 0),
    ),
  );
}

export async function POST(
  req: Request,
): Promise<NextResponse<WarmBundleRouteResponse<CompareBundlePayload> | { error: string }>> {
  const proxied = await maybeProxyToHotDataPlane(req, 'compare-bundle', '/bundle/compare');
  if (proxied)
    return proxied as NextResponse<
      WarmBundleRouteResponse<CompareBundlePayload> | { error: string }
    >;

  const routeContext = beginRouteRequest('/api/compare-bundle:POST', req);

  try {
    const body = (await req.json().catch(() => ({}))) as CompareBundleBody;
    const target = await resolveBundleTarget({
      eventKey: body.eventKey,
      teamNumber: body.teamNumber,
    });
    const scope: 'current' | 'historical' =
      readString(body.scope) === 'historical' ? 'historical' : 'current';
    const scenarioId = readString(body.scenarioId) || null;

    let teamNumbers = normalizeTeamNumbers(body.teamNumbers);
    if (!teamNumbers.length && scenarioId) {
      const compareSets = await loadCompareSetsSharedServer(target.workspaceKeyForBundles);
      const matchedSet = compareSets.find((item) => String(item.id) === scenarioId);
      teamNumbers = normalizeTeamNumbers(matchedSet?.teamNumbers);
    }
    if (!teamNumbers.length) {
      const compareDraft = await loadCompareDraftSharedServer(scope, target.workspaceKeyForBundles);
      teamNumbers = normalizeTeamNumbers(compareDraft.teamNumbers);
    }
    if (!teamNumbers.length) {
      return routeErrorJson(
        routeContext,
        'No compare teams are configured for the active target.',
        400,
      );
    }

    const response = await resolveWarmBundle({
      source: scenarioId ? 'compare_set' : 'compare_baseline',
      workspaceKey: target.workspaceKeyForBundles,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
      scenarioId: scenarioId ?? scope,
      forceRefresh: readBoolean(body.forceRefresh),
      meta: {
        scope,
        teamCount: teamNumbers.length,
      },
      build: async () => {
        const compareResponse = await teamComparePost(
          new Request('http://localhost/api/team-compare', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              teams: teamNumbers,
              eventKey: target.eventKey,
            }),
          }),
        );
        const snapshot = await readJsonResponse<TeamCompareSnapshot | { error: string }>(
          compareResponse,
        );
        if (!compareResponse.ok) {
          const message =
            typeof snapshot === 'object' &&
            snapshot !== null &&
            'error' in snapshot &&
            typeof snapshot.error === 'string'
              ? snapshot.error
              : 'Compare bundle failed';
          throw new Error(message);
        }
        return {
          generatedAtMs: Date.now(),
          compareScope: scope,
          teamNumbers,
          compareSetId: scenarioId,
          snapshot: snapshot as TeamCompareSnapshot,
        };
      },
    });

    queueHotDataPlaneParityCheck(req, 'compare-bundle', '/bundle/compare', response, {
      workspaceKey: target.workspaceKeyForBundles,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
      scenarioId: scenarioId ?? scope,
    });
    return routeJson(routeContext, response, undefined, {
      workspaceKey: target.workspaceKeyForBundles,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
      scenarioId: scenarioId ?? scope,
      cacheState: response.cacheState,
      cacheLayer: response.cacheLayer,
      bundleKey: response.bundleKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown compare bundle error';
    return routeErrorJson(routeContext, message, 500);
  }
}
