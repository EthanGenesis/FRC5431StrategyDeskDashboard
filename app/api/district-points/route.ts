import type { NextResponse } from 'next/server';

import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { loadFitDistrictSnapshot } from '../../../lib/fit-district';
import type { DistrictSnapshotResponse } from '../../../lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
): Promise<NextResponse<DistrictSnapshotResponse | { error: string }>> {
  const routeContext = beginRouteRequest('/api/district-points', req);
  const { searchParams } = new URL(req.url);

  try {
    const eventKey = String(searchParams.get('eventKey') ?? '').trim();
    const teamRaw = searchParams.get('team');
    const teamNumber = teamRaw ? Number(teamRaw) : null;
    const loadedTeam =
      teamNumber != null && Number.isFinite(teamNumber) && teamNumber > 0
        ? Math.floor(teamNumber)
        : null;

    const snapshot = await loadFitDistrictSnapshot(eventKey, loadedTeam);
    return routeJson(routeContext, snapshot, undefined, {
      eventKey,
      loadedTeam,
      applicable: snapshot.applicable,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown district-points error';
    const status = message === 'Missing TBA_AUTH_KEY in .env.local' ? 500 : 400;
    return routeErrorJson(routeContext, message, status);
  }
}
