import type { NextResponse } from 'next/server';

import { loadGameManualSnapshot } from '../../../lib/game-manual';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import type { GameManualSnapshot } from '../../../lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
): Promise<NextResponse<GameManualSnapshot | { error: string }>> {
  const routeContext = beginRouteRequest('/api/game-manual', req);

  try {
    const snapshot = await loadGameManualSnapshot();
    return routeJson(routeContext, snapshot, undefined, {
      sectionCount: snapshot.sections.length,
      tocCount: snapshot.toc.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown game manual error';
    return routeErrorJson(routeContext, message, 502);
  }
}
