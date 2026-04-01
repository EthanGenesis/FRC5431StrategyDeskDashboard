import type { NextResponse } from 'next/server';

import {
  maybeProxyToHotDataPlane,
  queueHotDataPlaneParityCheck,
} from '../../../lib/hot-plane-server';
import { buildPickListBundle } from '../../../lib/tab-bundle-builders';
import {
  loadBundleContext,
  resolveBundleTarget,
  resolveWarmBundle,
  type WarmBundleRouteResponse,
} from '../../../lib/tab-bundle-server';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PickListBundleBody = {
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
  NextResponse<WarmBundleRouteResponse<ReturnType<typeof buildPickListBundle>> | { error: string }>
> {
  const proxied = await maybeProxyToHotDataPlane(req, 'pick-list-bundle', '/bundle/pick-list');
  if (proxied) {
    return proxied as NextResponse<
      WarmBundleRouteResponse<ReturnType<typeof buildPickListBundle>> | { error: string }
    >;
  }

  const routeContext = beginRouteRequest('/api/pick-list-bundle:POST', req);

  try {
    const body = (await req.json().catch(() => ({}))) as PickListBundleBody;
    const target = await resolveBundleTarget({
      eventKey: body.eventKey,
      teamNumber: body.teamNumber,
    });
    const response = await resolveWarmBundle({
      source: 'pick_list_live',
      workspaceKey: target.workspaceKeyForBundles,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
      forceRefresh: readBoolean(body.forceRefresh),
      build: async () => {
        const context = await loadBundleContext(target);
        return buildPickListBundle(context.eventRows);
      },
    });

    queueHotDataPlaneParityCheck(req, 'pick-list-bundle', '/bundle/pick-list', response, {
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
    const message = error instanceof Error ? error.message : 'Unknown pick-list bundle error';
    return routeErrorJson(routeContext, message, 500);
  }
}
