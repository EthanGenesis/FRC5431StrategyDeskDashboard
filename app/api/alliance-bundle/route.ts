import type { NextResponse } from 'next/server';

import {
  maybeProxyToHotDataPlane,
  queueHotDataPlaneParityCheck,
} from '../../../lib/hot-plane-server';
import { buildAllianceBundle } from '../../../lib/tab-bundle-builders';
import {
  loadBundleContext,
  resolveBundleTarget,
  resolveWarmBundle,
  type WarmBundleRouteResponse,
} from '../../../lib/tab-bundle-server';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AllianceBundleBody = {
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
  NextResponse<WarmBundleRouteResponse<ReturnType<typeof buildAllianceBundle>> | { error: string }>
> {
  const proxied = await maybeProxyToHotDataPlane(req, 'alliance-bundle', '/bundle/alliance');
  if (proxied) {
    return proxied as NextResponse<
      WarmBundleRouteResponse<ReturnType<typeof buildAllianceBundle>> | { error: string }
    >;
  }

  const routeContext = beginRouteRequest('/api/alliance-bundle:POST', req);

  try {
    const body = (await req.json().catch(() => ({}))) as AllianceBundleBody;
    const target = await resolveBundleTarget({
      eventKey: body.eventKey,
      teamNumber: body.teamNumber,
    });
    const response = await resolveWarmBundle({
      source: 'alliance_live',
      workspaceKey: target.workspaceKeyForBundles,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
      forceRefresh: readBoolean(body.forceRefresh),
      build: async () => {
        const context = await loadBundleContext(target);
        return buildAllianceBundle(context.eventRows);
      },
    });

    queueHotDataPlaneParityCheck(req, 'alliance-bundle', '/bundle/alliance', response, {
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
    const message = error instanceof Error ? error.message : 'Unknown alliance bundle error';
    return routeErrorJson(routeContext, message, 500);
  }
}
