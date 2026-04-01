import type { NextResponse } from 'next/server';

import {
  maybeProxyToHotDataPlane,
  queueHotDataPlaneParityCheck,
} from '../../../lib/hot-plane-server';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { refreshSharedTargetCaches } from './refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RefreshActiveTargetResponse = Awaited<ReturnType<typeof refreshSharedTargetCaches>> & {
  generatedAtMs: number;
};

async function handleRefresh(
  req: Request,
  routeName: string,
): Promise<NextResponse<RefreshActiveTargetResponse | { error: string }>> {
  const proxied = await maybeProxyToHotDataPlane(req, 'refresh-active-target', '/refresh');
  if (proxied) return proxied as NextResponse<RefreshActiveTargetResponse | { error: string }>;

  const routeContext = beginRouteRequest(routeName, req);

  try {
    const result = await refreshSharedTargetCaches();
    const body = {
      generatedAtMs: Date.now(),
      ...result,
    };
    queueHotDataPlaneParityCheck(req, 'refresh-active-target', '/refresh', body, {
      workspaceKey: result.target.workspaceKey,
      eventKey: result.target.eventKey || null,
      teamNumber: result.target.teamNumber,
    });
    return routeJson(routeContext, body, undefined, {
      ok: result.ok,
      workspaceKey: result.target.workspaceKey,
      eventKey: result.target.eventKey || null,
      teamNumber: result.target.teamNumber,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown refresh-active-target error';
    return routeErrorJson(routeContext, message, 500);
  }
}

export async function GET(
  req: Request,
): Promise<NextResponse<RefreshActiveTargetResponse | { error: string }>> {
  return handleRefresh(req, '/api/refresh-active-target:GET');
}

export async function POST(
  req: Request,
): Promise<NextResponse<RefreshActiveTargetResponse | { error: string }>> {
  return handleRefresh(req, '/api/refresh-active-target:POST');
}
