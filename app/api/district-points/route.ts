import type { NextResponse } from 'next/server';

import { buildDistrictSnapshotHotCacheKey } from '../../../lib/hot-cache-keys';
import { loadHotCacheJson, saveHotCacheJson } from '../../../lib/hot-cache-server';
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
    const hotCacheKey = buildDistrictSnapshotHotCacheKey(eventKey, loadedTeam);
    const hotCacheValue = await loadHotCacheJson<DistrictSnapshotResponse>(hotCacheKey);
    if (hotCacheValue.value && !hotCacheValue.isStale) {
      return routeJson(routeContext, hotCacheValue.value, undefined, {
        eventKey,
        loadedTeam,
        applicable: hotCacheValue.value.applicable,
        cacheState: 'hot',
        cacheLayer: hotCacheValue.layer ?? 'memory',
      });
    }

    const snapshot = await loadFitDistrictSnapshot(eventKey, loadedTeam);
    await saveHotCacheJson(hotCacheKey, snapshot, {
      freshForSeconds: 90,
      staleForSeconds: 240,
    });
    return routeJson(routeContext, snapshot, undefined, {
      eventKey,
      loadedTeam,
      applicable: snapshot.applicable,
      cacheState: 'warm',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown district-points error';
    const status = message === 'Missing TBA_AUTH_KEY in .env.local' ? 500 : 400;
    return routeErrorJson(routeContext, message, status);
  }
}
