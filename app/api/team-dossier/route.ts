import type { NextResponse } from 'next/server';

import { readJsonResponse } from '../../../lib/httpCache';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { loadSnapshotCacheRecord, saveSnapshotCacheRecord } from '../../../lib/source-cache-server';
import { buildTeamDossier } from '../../../lib/team-dossier';
import type { TeamProfileRouteResponse } from '../../../lib/strategy-types';
import type { TeamDossierResponse } from '../../../lib/types';
import { loadSharedActiveTarget } from '../../../lib/shared-target-server';
import { GET as getTeamProfileRoute } from '../team-profile/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WARM_TEAM_DOSSIER_MAX_AGE_SECONDS = 120;

function parseOptionalTeamNumber(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export async function GET(
  req: Request,
): Promise<NextResponse<TeamDossierResponse | { error: string }>> {
  const routeContext = beginRouteRequest('/api/team-dossier', req);
  try {
    const { searchParams } = new URL(req.url);
    const sharedTarget = await loadSharedActiveTarget();
    const teamNumber =
      parseOptionalTeamNumber(searchParams.get('team')) ?? sharedTarget.teamNumber ?? null;
    const eventKey =
      String(searchParams.get('eventKey') ?? sharedTarget.eventKey ?? '').trim() || null;

    if (!teamNumber) {
      return routeErrorJson(routeContext, 'A valid team number is required.', 400);
    }

    const cachedPayload = await loadSnapshotCacheRecord<TeamDossierResponse>(
      'team_dossier',
      eventKey,
      teamNumber,
      WARM_TEAM_DOSSIER_MAX_AGE_SECONDS,
    );
    if (cachedPayload) {
      return routeJson(routeContext, cachedPayload, undefined, {
        eventKey,
        teamNumber,
        cacheState: 'warm',
        source: 'warm_cache',
      });
    }

    const params = new URLSearchParams({ team: String(teamNumber) });
    if (eventKey) params.set('eventKey', eventKey);
    const profileResponse = await getTeamProfileRoute(
      new Request(`http://localhost/api/team-profile?${params.toString()}`),
    );
    const profilePayload = await readJsonResponse<TeamProfileRouteResponse | { error: string }>(
      profileResponse,
    );
    if (!profileResponse.ok || !profilePayload || 'error' in profilePayload) {
      const errorText =
        profilePayload && 'error' in profilePayload
          ? profilePayload.error
          : 'Failed to load team profile for dossier.';
      return routeErrorJson(routeContext, errorText, profileResponse.status || 500);
    }

    const dossier = buildTeamDossier(profilePayload);
    void saveSnapshotCacheRecord({
      source: 'team_dossier',
      eventKey,
      teamNumber,
      generatedAt: dossier.generatedAtMs,
      payload: dossier,
    });

    return routeJson(routeContext, dossier, undefined, {
      eventKey,
      teamNumber,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown team dossier error';
    return routeErrorJson(routeContext, message, 500);
  }
}
