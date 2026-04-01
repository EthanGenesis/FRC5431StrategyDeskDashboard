import type { NextResponse } from 'next/server';

import {
  maybeProxyToHotDataPlane,
  queueHotDataPlaneParityCheck,
} from '../../../lib/hot-plane-server';
import { buildPlayoffBundle } from '../../../lib/tab-bundle-builders';
import {
  loadBundleContext,
  resolveBundleTarget,
  resolveWarmBundle,
  type WarmBundleRouteResponse,
} from '../../../lib/tab-bundle-server';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PlayoffBundleBody = {
  eventKey?: unknown;
  teamNumber?: unknown;
  forceRefresh?: unknown;
  simRuns?: unknown;
  model?: unknown;
};

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export async function POST(
  req: Request,
): Promise<
  NextResponse<WarmBundleRouteResponse<ReturnType<typeof buildPlayoffBundle>> | { error: string }>
> {
  const proxied = await maybeProxyToHotDataPlane(req, 'playoff-bundle', '/bundle/playoff');
  if (proxied) {
    return proxied as NextResponse<
      WarmBundleRouteResponse<ReturnType<typeof buildPlayoffBundle>> | { error: string }
    >;
  }

  const routeContext = beginRouteRequest('/api/playoff-bundle:POST', req);

  try {
    const body = (await req.json().catch(() => ({}))) as PlayoffBundleBody;
    const target = await resolveBundleTarget({
      eventKey: body.eventKey,
      teamNumber: body.teamNumber,
    });
    const response = await resolveWarmBundle({
      source: 'playoff_live',
      workspaceKey: target.workspaceKeyForBundles,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
      forceRefresh: readBoolean(body.forceRefresh),
      meta: { model: body.model ?? 'composite', simRuns: body.simRuns ?? null },
      build: async () => {
        const context = await loadBundleContext(target);
        const model = typeof body.model === 'string' ? body.model : undefined;
        const simRuns = Number(body.simRuns ?? 0) || undefined;
        return buildPlayoffBundle({
          eventRows: context.eventRows,
          teamNumber: target.teamNumber,
          ...(model ? { model } : {}),
          ...(simRuns ? { simRuns } : {}),
        });
      },
    });

    queueHotDataPlaneParityCheck(req, 'playoff-bundle', '/bundle/playoff', response, {
      workspaceKey: target.workspaceKeyForBundles,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
    });
    return routeJson(routeContext, response, undefined, {
      workspaceKey: target.workspaceKeyForBundles,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
      cacheState: response.cacheState,
      cacheLayer: response.cacheLayer,
      bundleKey: response.bundleKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown playoff bundle error';
    return routeErrorJson(routeContext, message, 500);
  }
}
