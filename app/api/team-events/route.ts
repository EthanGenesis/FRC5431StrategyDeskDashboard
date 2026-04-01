import type { NextResponse } from 'next/server';

import {
  maybeProxyToHotDataPlane,
  queueHotDataPlaneParityCheck,
} from '../../../lib/hot-plane-server';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { ACTIVE_TARGET_SEASON_YEAR } from '../../../lib/shared-target';
import { loadTeamEventCatalog } from '../../../lib/shared-target-server';
import { filterTeamEventCatalog } from '../../../lib/team-event-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TeamEventsResponse = {
  generatedAtMs: number;
  teamNumber: number;
  year: number;
  cached: boolean;
  events: Awaited<ReturnType<typeof loadTeamEventCatalog>>['events'];
};

export async function GET(
  req: Request,
): Promise<NextResponse<TeamEventsResponse | { error: string }>> {
  const proxied = await maybeProxyToHotDataPlane(req, 'team-events', '/team-events');
  if (proxied) return proxied as NextResponse<TeamEventsResponse | { error: string }>;

  const routeContext = beginRouteRequest('/api/team-events', req);

  try {
    const { searchParams } = new URL(req.url);
    const teamNumber = Math.floor(Number(searchParams.get('team') ?? '0'));
    const year = Math.floor(Number(searchParams.get('year') ?? ACTIVE_TARGET_SEASON_YEAR));
    const query = String(searchParams.get('query') ?? '').trim();

    if (!Number.isFinite(teamNumber) || teamNumber <= 0) {
      return routeErrorJson(routeContext, 'Missing or invalid team', 400);
    }

    const catalog = await loadTeamEventCatalog(teamNumber, { year });
    const body = {
      generatedAtMs: Date.now(),
      teamNumber,
      year,
      cached: catalog.cached,
      events: filterTeamEventCatalog(catalog.events, query),
    };
    queueHotDataPlaneParityCheck(req, 'team-events', '/team-events', body, {
      workspaceKey: 'shared',
      teamNumber,
    });
    return routeJson(routeContext, body, undefined, {
      workspaceKey: 'shared',
      teamNumber,
      cacheState: catalog.cached ? 'warm' : 'cold',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown team-events error';
    return routeErrorJson(routeContext, message, 500);
  }
}
