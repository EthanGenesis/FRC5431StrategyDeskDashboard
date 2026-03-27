import type { NextResponse } from 'next/server';

import {
  parseDistrictSimulationRequest,
  simulateFitDistrictEvent,
  simulateFitDistrictSeason,
} from '../../../../lib/fit-district';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../../lib/observability';
import type { DistrictEventProjection, DistrictSeasonProjection } from '../../../../lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
): Promise<NextResponse<DistrictEventProjection | DistrictSeasonProjection | { error: string }>> {
  const routeContext = beginRouteRequest('/api/district-points/simulate', req);

  try {
    const body = parseDistrictSimulationRequest(await req.json().catch(() => ({})));
    const loadedTeam = body.team ?? null;
    const runs = body.runs ?? 800;

    const response =
      body.mode === 'event'
        ? await simulateFitDistrictEvent(body.eventKey, loadedTeam, runs)
        : await simulateFitDistrictSeason(body.eventKey, loadedTeam, runs);

    return routeJson(routeContext, response, undefined, {
      eventKey: body.eventKey,
      loadedTeam,
      runs: response.runs,
      mode: body.mode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown district simulation error';
    const status = message === 'Missing TBA_AUTH_KEY in .env.local' ? 500 : 400;
    return routeErrorJson(routeContext, message, status);
  }
}
