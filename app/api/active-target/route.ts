import type { NextResponse } from 'next/server';

import {
  maybeProxyToHotDataPlane,
  queueHotDataPlaneParityCheck,
} from '../../../lib/hot-plane-server';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { EMPTY_SHARED_ACTIVE_TARGET } from '../../../lib/shared-target';
import {
  loadSharedActiveTarget,
  loadSharedRefreshStatus,
  saveSharedActiveTarget,
} from '../../../lib/shared-target-server';
import type { SharedActiveTarget } from '../../../lib/shared-target';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

type ActiveTargetResponse = {
  generatedAtMs: number;
  target: SharedActiveTarget;
  refreshStatus: Awaited<ReturnType<typeof loadSharedRefreshStatus>>;
};

export async function GET(
  req: Request,
): Promise<NextResponse<ActiveTargetResponse | { error: string }>> {
  const proxied = await maybeProxyToHotDataPlane(req, 'active-target', '/active-target');
  if (proxied) return proxied as NextResponse<ActiveTargetResponse | { error: string }>;

  const routeContext = beginRouteRequest('/api/active-target:GET', req);

  try {
    const [target, refreshStatus] = await Promise.all([
      loadSharedActiveTarget(),
      loadSharedRefreshStatus(),
    ]);

    const body = {
      generatedAtMs: Date.now(),
      target,
      refreshStatus,
    };
    queueHotDataPlaneParityCheck(req, 'active-target', '/active-target', body, {
      workspaceKey: target.workspaceKey,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
    });
    return routeJson(routeContext, body, undefined, {
      workspaceKey: target.workspaceKey,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown active-target error';
    return routeErrorJson(routeContext, message, 500);
  }
}

export async function POST(
  req: Request,
): Promise<NextResponse<ActiveTargetResponse | { error: string }>> {
  const proxied = await maybeProxyToHotDataPlane(req, 'active-target', '/active-target');
  if (proxied) return proxied as NextResponse<ActiveTargetResponse | { error: string }>;

  const routeContext = beginRouteRequest('/api/active-target:POST', req);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const teamNumber = Number(body.teamNumber ?? body.team_number);
    const normalizedTeam =
      Number.isFinite(teamNumber) && teamNumber > 0 ? Math.floor(teamNumber) : null;
    const nextTarget = await saveSharedActiveTarget(
      {
        teamNumber: normalizedTeam,
        eventKey: readString(body.eventKey ?? body.event_key),
        eventName: readString(body.eventName ?? body.event_name),
        eventShortName: readString(body.eventShortName ?? body.event_short_name),
        eventLocation: readString(body.eventLocation ?? body.event_location),
        startDate:
          typeof body.startDate === 'string'
            ? body.startDate.trim() || null
            : typeof body.start_date === 'string'
              ? body.start_date.trim() || null
              : null,
        endDate:
          typeof body.endDate === 'string'
            ? body.endDate.trim() || null
            : typeof body.end_date === 'string'
              ? body.end_date.trim() || null
              : null,
        lastSnapshotGeneratedAt: null,
        lastEventContextGeneratedAt: null,
        lastTeamCatalogGeneratedAt: null,
        lastRefreshedAt: null,
        refreshState: 'idle',
        refreshError: null,
      },
      {
        baseTarget: EMPTY_SHARED_ACTIVE_TARGET,
        requirePersistence: true,
      },
    );

    const refreshStatus = await loadSharedRefreshStatus();
    const responseBody = {
      generatedAtMs: Date.now(),
      target: nextTarget,
      refreshStatus,
    };
    queueHotDataPlaneParityCheck(req, 'active-target', '/active-target', responseBody, {
      workspaceKey: nextTarget.workspaceKey,
      eventKey: nextTarget.eventKey,
      teamNumber: nextTarget.teamNumber,
    });
    return routeJson(routeContext, responseBody, undefined, {
      workspaceKey: nextTarget.workspaceKey,
      eventKey: nextTarget.eventKey,
      teamNumber: nextTarget.teamNumber,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown active-target error';
    return routeErrorJson(routeContext, message, 500);
  }
}
