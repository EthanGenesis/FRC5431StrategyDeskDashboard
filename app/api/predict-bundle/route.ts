import type { NextResponse } from 'next/server';

import {
  maybeProxyToHotDataPlane,
  queueHotDataPlaneParityCheck,
} from '../../../lib/hot-plane-server';
import { buildPredictBaselineBundle } from '../../../lib/tab-bundle-builders';
import {
  loadBundleContext,
  resolveBundleTarget,
  resolveWarmBundle,
  type WarmBundleRouteResponse,
} from '../../../lib/tab-bundle-server';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PredictBundleBody = {
  eventKey?: unknown;
  teamNumber?: unknown;
  forceRefresh?: unknown;
  simRuns?: unknown;
};

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export async function POST(
  req: Request,
): Promise<
  NextResponse<
    WarmBundleRouteResponse<ReturnType<typeof buildPredictBaselineBundle>> | { error: string }
  >
> {
  const proxied = await maybeProxyToHotDataPlane(req, 'predict-bundle', '/bundle/predict');
  if (proxied) {
    return proxied as NextResponse<
      WarmBundleRouteResponse<ReturnType<typeof buildPredictBaselineBundle>> | { error: string }
    >;
  }

  const routeContext = beginRouteRequest('/api/predict-bundle:POST', req);

  try {
    const body = (await req.json().catch(() => ({}))) as PredictBundleBody;
    const target = await resolveBundleTarget({
      eventKey: body.eventKey,
      teamNumber: body.teamNumber,
    });
    const response = await resolveWarmBundle({
      source: 'predict_baseline',
      workspaceKey: target.workspaceKeyForBundles,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
      forceRefresh: readBoolean(body.forceRefresh),
      meta: { simRuns: body.simRuns ?? null },
      build: async () => {
        const context = await loadBundleContext(target);
        const simRuns = Number(body.simRuns ?? 0) || undefined;
        return buildPredictBaselineBundle({
          eventKey: target.eventKey,
          teamNumber: target.teamNumber,
          eventRows: context.eventRows,
          matches: context.eventContext.tba.matches ?? [],
          sbMatches: context.eventContext.sb.matches ?? [],
          ...(simRuns ? { simRuns } : {}),
        });
      },
    });

    queueHotDataPlaneParityCheck(req, 'predict-bundle', '/bundle/predict', response, {
      workspaceKey: target.workspaceKeyForBundles,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
    });
    return routeJson(routeContext, response, undefined, {
      workspaceKey: target.workspaceKeyForBundles,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
      scenarioId: null,
      cacheState: response.cacheState,
      cacheLayer: response.cacheLayer,
      bundleKey: response.bundleKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown predict bundle error';
    return routeErrorJson(routeContext, message, 500);
  }
}
