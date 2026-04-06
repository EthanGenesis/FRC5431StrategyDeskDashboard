import type { NextResponse } from 'next/server';

import { loadCacheInspectorSummary } from '../../../lib/desk-health';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { loadSharedActiveTarget } from '../../../lib/shared-target-server';
import type { CacheInspectorResponse } from '../../../lib/types';
import { getEventWorkspaceKey } from '../../../lib/workspace-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseOptionalTeamNumber(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export async function GET(
  req: Request,
): Promise<NextResponse<CacheInspectorResponse | { error: string }>> {
  const routeContext = beginRouteRequest('/api/cache-inspector', req);
  try {
    const { searchParams } = new URL(req.url);
    const sharedTarget = await loadSharedActiveTarget();
    const eventKey =
      String(searchParams.get('eventKey') ?? sharedTarget.eventKey ?? '').trim() || null;
    const teamNumber =
      parseOptionalTeamNumber(searchParams.get('team')) ?? sharedTarget.teamNumber ?? null;
    const workspaceKey = eventKey
      ? (getEventWorkspaceKey(eventKey) ?? sharedTarget.workspaceKey)
      : sharedTarget.workspaceKey;

    const response = await loadCacheInspectorSummary({
      workspaceKey,
      eventKey,
      teamNumber,
    });

    return routeJson(routeContext, response, undefined, {
      workspaceKey,
      eventKey,
      teamNumber,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown cache inspector error';
    return routeErrorJson(routeContext, message, 500);
  }
}
