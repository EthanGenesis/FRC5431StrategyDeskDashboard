import type { NextResponse } from 'next/server';

import { CACHE_REFRESH_SURFACES, isCacheRefreshSurfaceId } from '../../../lib/cache-surfaces';
import {
  buildBootstrapHotCacheKey,
  buildDistrictSnapshotHotCacheKey,
  buildGameManualHotCacheKey,
  buildRefreshStatusHotCacheKey,
} from '../../../lib/hot-cache-keys';
import { deleteHotCacheKey } from '../../../lib/hot-cache-server';
import { readJsonResponse } from '../../../lib/httpCache';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { loadSharedActiveTarget } from '../../../lib/shared-target-server';
import { deleteSnapshotCacheRecord } from '../../../lib/source-cache-server';
import type { CacheRefreshResponse, CacheRefreshSurfaceResult } from '../../../lib/types';
import { getEventWorkspaceKey } from '../../../lib/workspace-key';
import { GET as getBootstrapRoute } from '../bootstrap/route';
import { GET as getDataSuperRoute } from '../data-super/route';
import { GET as getDeskOpsRoute } from '../desk-ops/route';
import { GET as getDistrictPointsRoute } from '../district-points/route';
import { GET as getEventContextRoute } from '../event-context/route';
import { GET as getGameManualRoute } from '../game-manual/route';
import { GET as getPickListAnalysisRoute } from '../pick-list-analysis/route';
import { GET as getPitOpsRoute } from '../pit-ops/route';
import { GET as getPlayoffSummaryRoute } from '../playoff-summary/route';
import { refreshSharedTargetCaches } from '../refresh-active-target/refresh';
import { GET as getSnapshotRoute } from '../snapshot/route';
import { GET as getTeamDossierRoute } from '../team-dossier/route';
import { GET as getTeamProfileRoute } from '../team-profile/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseOptionalTeamNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function readAction(value: unknown): 'refresh' | 'clear' | 'reseed' {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'clear') return 'clear';
  if (normalized === 'reseed') return 'reseed';
  return 'refresh';
}

async function clearSurfaceCaches(input: {
  surface: string;
  workspaceKey: string;
  eventKey: string | null;
  teamNumber: number | null;
}): Promise<CacheRefreshSurfaceResult> {
  const { surface, workspaceKey, eventKey, teamNumber } = input;

  try {
    if (surface === 'bootstrap') {
      await Promise.all([
        deleteHotCacheKey(buildBootstrapHotCacheKey(workspaceKey)),
        deleteHotCacheKey(buildRefreshStatusHotCacheKey(workspaceKey)),
      ]);
    } else if (surface === 'snapshot') {
      await deleteSnapshotCacheRecord('snapshot', eventKey, teamNumber);
    } else if (surface === 'event-context') {
      await deleteSnapshotCacheRecord('event_context', eventKey, null);
    } else if (surface === 'team-profile') {
      await Promise.all([
        deleteSnapshotCacheRecord('team_profile', eventKey, teamNumber),
        deleteSnapshotCacheRecord('team_profile_summary', eventKey, teamNumber),
      ]);
    } else if (surface === 'data-super') {
      await deleteSnapshotCacheRecord('data_super', eventKey, teamNumber);
    } else if (surface === 'district-points') {
      await deleteHotCacheKey(buildDistrictSnapshotHotCacheKey(eventKey, teamNumber));
    } else if (surface === 'game-manual') {
      await deleteHotCacheKey(buildGameManualHotCacheKey('2026'));
    } else if (surface === 'team-dossier') {
      await deleteSnapshotCacheRecord('team_dossier', eventKey, teamNumber);
    } else if (surface === 'pit-ops') {
      await deleteSnapshotCacheRecord('pit_ops', eventKey, teamNumber);
    }

    return {
      surface,
      ok: true,
      status: 200,
      generatedAtMs: Date.now(),
      error: null,
    };
  } catch (error) {
    return {
      surface,
      ok: false,
      status: 500,
      generatedAtMs: null,
      error: error instanceof Error ? error.message : `Failed to clear ${surface}`,
    };
  }
}

async function invokeHandler(
  surface: string,
  handler: (req: Request) => Promise<Response>,
  request: Request,
): Promise<CacheRefreshSurfaceResult> {
  try {
    const response = await handler(request);
    const payload = await readJsonResponse<Record<string, unknown> | { error: string }>(response);
    if (!response.ok) {
      return {
        surface,
        ok: false,
        status: response.status,
        generatedAtMs: null,
        error:
          payload &&
          typeof payload === 'object' &&
          'error' in payload &&
          typeof payload.error === 'string'
            ? payload.error
            : `${surface} failed (${response.status})`,
      };
    }
    return {
      surface,
      ok: true,
      status: response.status,
      generatedAtMs:
        payload &&
        typeof payload === 'object' &&
        'generatedAtMs' in payload &&
        Number.isFinite(Number(payload.generatedAtMs))
          ? Number(payload.generatedAtMs)
          : Date.now(),
      error: null,
    };
  } catch (error) {
    return {
      surface,
      ok: false,
      status: null,
      generatedAtMs: null,
      error: error instanceof Error ? error.message : `${surface} failed`,
    };
  }
}

function buildSurfaceRequests(input: {
  baseUrl: string;
  eventKey: string | null;
  teamNumber: number | null;
}): Record<string, Request> {
  const { baseUrl, eventKey, teamNumber } = input;
  const withEvent = new URLSearchParams();
  if (eventKey) withEvent.set('eventKey', eventKey);
  if (teamNumber != null) withEvent.set('team', String(teamNumber));

  const snapshotParams = new URLSearchParams();
  if (eventKey) snapshotParams.set('eventKey', eventKey);
  if (teamNumber != null) snapshotParams.set('team', String(teamNumber));

  const dataSuperParams = new URLSearchParams();
  if (eventKey) dataSuperParams.set('eventKey', eventKey);
  if (teamNumber != null) dataSuperParams.set('loadedTeam', String(teamNumber));

  return {
    snapshot: new Request(`${baseUrl}/api/snapshot?${snapshotParams.toString()}`),
    'event-context': new Request(`${baseUrl}/api/event-context?${withEvent.toString()}`),
    'team-profile': new Request(
      `${baseUrl}/api/team-profile?${new URLSearchParams({
        ...(eventKey ? { eventKey } : {}),
        ...(teamNumber != null ? { team: String(teamNumber) } : {}),
      }).toString()}`,
    ),
    'data-super': new Request(`${baseUrl}/api/data-super?${dataSuperParams.toString()}`),
    'district-points': new Request(
      `${baseUrl}/api/district-points?${new URLSearchParams({
        ...(eventKey ? { eventKey } : {}),
        ...(teamNumber != null ? { team: String(teamNumber) } : {}),
      }).toString()}`,
    ),
    'game-manual': new Request(`${baseUrl}/api/game-manual`),
    'desk-ops': new Request(
      `${baseUrl}/api/desk-ops?${new URLSearchParams({
        ...(eventKey ? { eventKey } : {}),
        ...(teamNumber != null ? { team: String(teamNumber) } : {}),
      }).toString()}`,
    ),
    'team-dossier': new Request(
      `${baseUrl}/api/team-dossier?${new URLSearchParams({
        ...(eventKey ? { eventKey } : {}),
        ...(teamNumber != null ? { team: String(teamNumber) } : {}),
      }).toString()}`,
    ),
    'pick-list-analysis': new Request(
      `${baseUrl}/api/pick-list-analysis?${new URLSearchParams({
        ...(eventKey ? { eventKey } : {}),
        ...(teamNumber != null ? { team: String(teamNumber) } : {}),
      }).toString()}`,
    ),
    'playoff-summary': new Request(
      `${baseUrl}/api/playoff-summary?${new URLSearchParams({
        ...(eventKey ? { eventKey } : {}),
        ...(teamNumber != null ? { team: String(teamNumber) } : {}),
      }).toString()}`,
    ),
    'pit-ops': new Request(
      `${baseUrl}/api/pit-ops?${new URLSearchParams({
        ...(eventKey ? { eventKey } : {}),
        ...(teamNumber != null ? { team: String(teamNumber) } : {}),
      }).toString()}`,
    ),
  };
}

export async function POST(
  req: Request,
): Promise<NextResponse<CacheRefreshResponse | { error: string }>> {
  const routeContext = beginRouteRequest('/api/cache-refresh', req);
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sharedTarget = await loadSharedActiveTarget();
    const action = readAction(body.action);
    const eventKey =
      readOptionalString(body.eventKey) ??
      readOptionalString(body.event_key) ??
      sharedTarget.eventKey ??
      null;
    const teamNumber =
      parseOptionalTeamNumber(body.team ?? body.teamNumber ?? body.team_number) ??
      sharedTarget.teamNumber ??
      null;
    const workspaceKey = eventKey
      ? (getEventWorkspaceKey(eventKey) ?? sharedTarget.workspaceKey)
      : sharedTarget.workspaceKey;

    const requestedSurfaces = readStringArray(body.surfaces);
    const surfaces = requestedSurfaces.length
      ? requestedSurfaces.filter(isCacheRefreshSurfaceId)
      : [...CACHE_REFRESH_SURFACES];

    if (!surfaces.length) {
      return routeErrorJson(routeContext, 'No valid refresh surfaces were requested.', 400);
    }

    const baseUrl = 'http://localhost';
    const surfaceRequests = buildSurfaceRequests({
      baseUrl,
      eventKey,
      teamNumber,
    });

    const results = await Promise.all(
      surfaces.map(async (surface) => {
        if (action === 'clear') {
          return clearSurfaceCaches({
            surface,
            workspaceKey,
            eventKey,
            teamNumber,
          });
        }

        if (surface === 'bootstrap') {
          if (action === 'reseed') {
            await clearSurfaceCaches({
              surface,
              workspaceKey,
              eventKey,
              teamNumber,
            });
          }
          const refreshResult = await refreshSharedTargetCaches();
          if (!refreshResult.ok) {
            return {
              surface,
              ok: false,
              status: 500,
              generatedAtMs: null,
              error: 'Shared target refresh did not complete cleanly.',
            } satisfies CacheRefreshSurfaceResult;
          }
          return invokeHandler(surface, getBootstrapRoute, new Request(`${baseUrl}/api/bootstrap`));
        }

        if (!eventKey || teamNumber == null) {
          return {
            surface,
            ok: false,
            status: 400,
            generatedAtMs: null,
            error: 'A loaded event and team are required for this surface.',
          } satisfies CacheRefreshSurfaceResult;
        }

        if (action === 'reseed') {
          await clearSurfaceCaches({
            surface,
            workspaceKey,
            eventKey,
            teamNumber,
          });
        }

        const handlerMap = {
          snapshot: getSnapshotRoute,
          'event-context': getEventContextRoute,
          'team-profile': getTeamProfileRoute,
          'data-super': getDataSuperRoute,
          'district-points': getDistrictPointsRoute,
          'game-manual': getGameManualRoute,
          'desk-ops': getDeskOpsRoute,
          'team-dossier': getTeamDossierRoute,
          'pick-list-analysis': getPickListAnalysisRoute,
          'playoff-summary': getPlayoffSummaryRoute,
          'pit-ops': getPitOpsRoute,
        } as const;

        const handler = handlerMap[surface];
        const requestForSurface = surfaceRequests[surface];
        if (!handler || !requestForSurface) {
          return {
            surface,
            ok: false,
            status: 400,
            generatedAtMs: null,
            error: 'No refresh handler exists for this surface.',
          } satisfies CacheRefreshSurfaceResult;
        }
        return invokeHandler(surface, handler, requestForSurface);
      }),
    );

    const response: CacheRefreshResponse = {
      generatedAtMs: Date.now(),
      workspaceKey,
      eventKey,
      teamNumber,
      results,
    };

    return routeJson(routeContext, response, undefined, {
      workspaceKey,
      eventKey,
      teamNumber,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown cache refresh error';
    return routeErrorJson(routeContext, message, 500);
  }
}
