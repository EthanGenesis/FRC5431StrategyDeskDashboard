import type { NextResponse } from 'next/server';

import {
  maybeProxyToHotDataPlane,
  queueHotDataPlaneParityCheck,
} from '../../../lib/hot-plane-server';
import { buildImpactBundle } from '../../../lib/tab-bundle-builders';
import {
  loadBundleContext,
  resolveBundleTarget,
  resolveWarmBundle,
  type WarmBundleRouteResponse,
} from '../../../lib/tab-bundle-server';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ImpactBundleBody = {
  eventKey?: unknown;
  teamNumber?: unknown;
  forceRefresh?: unknown;
};

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export async function POST(
  req: Request,
): Promise<
  NextResponse<WarmBundleRouteResponse<ReturnType<typeof buildImpactBundle>> | { error: string }>
> {
  const proxied = await maybeProxyToHotDataPlane(req, 'impact-bundle', '/bundle/impact');
  if (proxied) {
    return proxied as NextResponse<
      WarmBundleRouteResponse<ReturnType<typeof buildImpactBundle>> | { error: string }
    >;
  }

  const routeContext = beginRouteRequest('/api/impact-bundle:POST', req);

  try {
    const body = (await req.json().catch(() => ({}))) as ImpactBundleBody;
    const target = await resolveBundleTarget({
      eventKey: body.eventKey,
      teamNumber: body.teamNumber,
    });
    const response = await resolveWarmBundle({
      source: 'impact_live',
      workspaceKey: target.workspaceKeyForBundles,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
      forceRefresh: readBoolean(body.forceRefresh),
      build: async () => {
        const context = await loadBundleContext(target);
        return buildImpactBundle({
          eventRows: context.eventRows,
          matches: context.eventContext.tba.matches ?? [],
          teamNumber: target.teamNumber,
        });
      },
    });

    queueHotDataPlaneParityCheck(req, 'impact-bundle', '/bundle/impact', response, {
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
    const message = error instanceof Error ? error.message : 'Unknown impact bundle error';
    return routeErrorJson(routeContext, message, 500);
  }
}
