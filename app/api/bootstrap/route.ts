import type { NextResponse } from 'next/server';

import { listWarmBundleStatuses } from '../../../lib/bundle-cache-server';
import { buildBootstrapHotCacheKey } from '../../../lib/hot-cache-keys';
import { loadHotCacheJson, saveHotCacheJson } from '../../../lib/hot-cache-server';
import {
  maybeProxyToHotDataPlane,
  queueHotDataPlaneParityCheck,
} from '../../../lib/hot-plane-server';
import { routeJson, beginRouteRequest } from '../../../lib/observability';
import { ACTIVE_TARGET_WORKSPACE_KEY, sharedTargetHasSelection } from '../../../lib/shared-target';
import {
  EMPTY_SHARED_ACTIVE_TARGET,
  EMPTY_SHARED_REFRESH_STATUS,
} from '../../../lib/shared-target';
import { loadTeamEventCatalog } from '../../../lib/shared-target-server';
import { loadSnapshotCacheRecord } from '../../../lib/source-cache-server';
import {
  readWarmBootstrapState,
  WARM_BUNDLE_MAX_AGE_SECONDS,
} from '../../../lib/tab-bundle-server';
import type { AppSnapshot } from '../../../lib/types';
import { getEventWorkspaceKey } from '../../../lib/workspace-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOOTSTRAP_ROUTE_TIMEOUT_MS = 800;

type BootstrapResponse = {
  generatedAtMs: number;
  target: Awaited<ReturnType<typeof readWarmBootstrapState>>['target'];
  refreshStatus: Awaited<ReturnType<typeof readWarmBootstrapState>>['refreshStatus'];
  snapshot: AppSnapshot | null;
  teamEventCatalog: {
    teamNumber: number | null;
    year: number;
    cached: boolean;
    generatedAt: string;
    events: Awaited<ReturnType<typeof loadTeamEventCatalog>>['events'];
  };
  bundleManifest: Awaited<ReturnType<typeof listWarmBundleStatuses>>;
};

export async function GET(
  req: Request,
): Promise<NextResponse<BootstrapResponse | { error: string }>> {
  const proxied = await maybeProxyToHotDataPlane(req, 'bootstrap', '/bootstrap');
  if (proxied) return proxied as NextResponse<BootstrapResponse | { error: string }>;

  const routeContext = beginRouteRequest('/api/bootstrap', req);
  const hotCacheKey = buildBootstrapHotCacheKey(ACTIVE_TARGET_WORKSPACE_KEY);
  const hotCacheValue = await loadHotCacheJson<BootstrapResponse>(hotCacheKey);

  if (hotCacheValue.value && !hotCacheValue.isStale) {
    queueHotDataPlaneParityCheck(req, 'bootstrap', '/bootstrap', hotCacheValue.value, {
      workspaceKey: hotCacheValue.value.target?.workspaceKey ?? ACTIVE_TARGET_WORKSPACE_KEY,
      eventKey: hotCacheValue.value.target?.eventKey ?? null,
      teamNumber: hotCacheValue.value.target?.teamNumber ?? null,
    });
    return routeJson(routeContext, hotCacheValue.value, undefined, {
      workspaceKey: hotCacheValue.value.target?.workspaceKey ?? ACTIVE_TARGET_WORKSPACE_KEY,
      eventKey: hotCacheValue.value.target?.eventKey ?? null,
      teamNumber: hotCacheValue.value.target?.teamNumber ?? null,
      cacheState: 'hot',
      cacheLayer: hotCacheValue.layer ?? 'memory',
    });
  }

  try {
    const { target, refreshStatus }: Awaited<ReturnType<typeof readWarmBootstrapState>> =
      await Promise.race([
        readWarmBootstrapState().catch(() => ({
          target: EMPTY_SHARED_ACTIVE_TARGET,
          refreshStatus: EMPTY_SHARED_REFRESH_STATUS,
        })),
        new Promise<Awaited<ReturnType<typeof readWarmBootstrapState>>>((resolve) => {
          setTimeout(() => {
            resolve({
              target: EMPTY_SHARED_ACTIVE_TARGET,
              refreshStatus: EMPTY_SHARED_REFRESH_STATUS,
            });
          }, BOOTSTRAP_ROUTE_TIMEOUT_MS);
        }),
      ]);

    if (!sharedTargetHasSelection(target)) {
      const body = {
        generatedAtMs: Date.now(),
        target,
        refreshStatus,
        snapshot: null,
        teamEventCatalog: {
          teamNumber: target.teamNumber,
          year: target.seasonYear,
          cached: false,
          generatedAt: new Date(0).toISOString(),
          events: [],
        },
        bundleManifest: [],
      };
      void saveHotCacheJson(hotCacheKey, body, {
        freshForSeconds: 5,
        staleForSeconds: 30,
      });
      queueHotDataPlaneParityCheck(req, 'bootstrap', '/bootstrap', body, {
        workspaceKey: target.workspaceKey,
      });
      return routeJson(routeContext, body, undefined, {
        workspaceKey: target.workspaceKey,
        cacheState: 'warm',
      });
    }

    const workspaceKey = getEventWorkspaceKey(target.eventKey) ?? ACTIVE_TARGET_WORKSPACE_KEY;
    const [snapshot, teamEventCatalog, bundleManifest] = await Promise.all([
      loadSnapshotCacheRecord<AppSnapshot>(
        'snapshot',
        target.eventKey,
        target.teamNumber ?? null,
        WARM_BUNDLE_MAX_AGE_SECONDS,
      ).catch(() => null),
      loadTeamEventCatalog(target.teamNumber ?? 0, {
        year: target.seasonYear,
      }).catch(() => ({
        generatedAt: new Date(0).toISOString(),
        cached: false,
        events: [],
      })),
      listWarmBundleStatuses(workspaceKey).catch(() => []),
    ]);

    const body = {
      generatedAtMs: Date.now(),
      target,
      refreshStatus,
      snapshot,
      teamEventCatalog: {
        teamNumber: target.teamNumber,
        year: target.seasonYear,
        cached: teamEventCatalog.cached,
        generatedAt: teamEventCatalog.generatedAt,
        events: teamEventCatalog.events,
      },
      bundleManifest,
    };
    void saveHotCacheJson(hotCacheKey, body, {
      freshForSeconds: 5,
      staleForSeconds: 30,
    });
    queueHotDataPlaneParityCheck(req, 'bootstrap', '/bootstrap', body, {
      workspaceKey,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
    });
    return routeJson(routeContext, body, undefined, {
      workspaceKey,
      eventKey: target.eventKey,
      teamNumber: target.teamNumber,
      cacheState: snapshot ? 'warm' : 'cold',
    });
  } catch {
    const body = hotCacheValue.value ?? {
      generatedAtMs: Date.now(),
      target: EMPTY_SHARED_ACTIVE_TARGET,
      refreshStatus: EMPTY_SHARED_REFRESH_STATUS,
      snapshot: null,
      teamEventCatalog: {
        teamNumber: null,
        year: 2026,
        cached: false,
        generatedAt: new Date(0).toISOString(),
        events: [],
      },
      bundleManifest: [],
    };
    queueHotDataPlaneParityCheck(req, 'bootstrap', '/bootstrap', body, {
      workspaceKey: body.target?.workspaceKey ?? ACTIVE_TARGET_WORKSPACE_KEY,
    });
    return routeJson(routeContext, body, undefined, {
      workspaceKey: body.target?.workspaceKey ?? ACTIVE_TARGET_WORKSPACE_KEY,
      eventKey: body.target?.eventKey ?? null,
      teamNumber: body.target?.teamNumber ?? null,
      cacheState: hotCacheValue.value ? 'stale' : 'cold',
    });
  }
}
