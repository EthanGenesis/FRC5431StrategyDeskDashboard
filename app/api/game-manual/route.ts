import type { NextResponse } from 'next/server';

import { buildGameManualHotCacheKey } from '../../../lib/hot-cache-keys';
import { loadHotCacheJson, saveHotCacheJson } from '../../../lib/hot-cache-server';
import { loadGameManualSnapshot } from '../../../lib/game-manual';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import type { GameManualSnapshot } from '../../../lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type GameManualRouteResponse = GameManualSnapshot & {
  generatedAtMs: number;
};

export async function GET(
  req: Request,
): Promise<NextResponse<GameManualRouteResponse | { error: string }>> {
  const routeContext = beginRouteRequest('/api/game-manual', req);
  const hotCacheKey = buildGameManualHotCacheKey('2026');

  const hotCacheValue = await loadHotCacheJson<GameManualRouteResponse>(hotCacheKey);
  if (hotCacheValue.value && !hotCacheValue.isStale) {
    return routeJson(routeContext, hotCacheValue.value, undefined, {
      sectionCount: hotCacheValue.value.sections.length,
      tocCount: hotCacheValue.value.toc.length,
      cacheState: 'hot',
      cacheLayer: hotCacheValue.layer ?? 'memory',
    });
  }

  try {
    const snapshot = await loadGameManualSnapshot();
    const body = {
      ...snapshot,
      generatedAtMs: snapshot.fetchedAtMs,
    } satisfies GameManualRouteResponse;
    await saveHotCacheJson(hotCacheKey, body, {
      freshForSeconds: 60 * 60,
      staleForSeconds: 60 * 60 * 6,
    });
    return routeJson(routeContext, body, undefined, {
      sectionCount: body.sections.length,
      tocCount: body.toc.length,
      cacheState: 'warm',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown game manual error';
    return routeErrorJson(routeContext, message, 502);
  }
}
