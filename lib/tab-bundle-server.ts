import { buildEventTeamRowsFromContext } from './analytics';
import {
  buildWarmBundleKey,
  loadWarmBundlePayloadRecord,
  loadWarmBundleStatus,
  saveWarmBundlePayload,
  saveWarmBundleStatus,
  type WarmBundleState,
} from './bundle-cache-server';
import { hashJsonValue } from './json-stable';
import { ACTIVE_TARGET_WORKSPACE_KEY } from './shared-target';
import { EMPTY_SHARED_ACTIVE_TARGET, EMPTY_SHARED_REFRESH_STATUS } from './shared-target';
import {
  loadSharedActiveTarget,
  loadSharedRefreshStatus,
  type TeamEventCatalogResult,
} from './shared-target-server';
import { loadEventContext } from './server-data';
import { getEventWorkspaceKey } from './workspace-key';

export const WARM_BUNDLE_MAX_AGE_SECONDS = 90;

export type WarmBundleRouteResponse<T> = {
  generatedAtMs: number;
  bundleKey: string;
  cacheState: 'warm' | 'cold';
  refreshState: WarmBundleState;
  cacheLayer: 'memory' | 'redis' | 'supabase' | 'origin';
  bundleVersion: string;
  etag: string;
  freshUntil: string;
  staleAt: string;
  payload: T;
};

export type ResolvedBundleTarget = Awaited<ReturnType<typeof loadSharedActiveTarget>> & {
  workspaceKeyForBundles: string;
};

export type LoadedBundleContext = {
  target: ResolvedBundleTarget;
  eventContext: Awaited<ReturnType<typeof loadEventContext>>;
  eventRows: ReturnType<typeof buildEventTeamRowsFromContext>;
};

function readPositiveInteger(value: unknown): number | null {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readMetaString(
  value: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const nested = value?.[key];
  return typeof nested === 'string' && nested.trim() ? nested.trim() : null;
}

function buildWarmBundleMeta(
  generatedAtMs: number,
  payload: unknown,
  extraMeta: Record<string, unknown> | undefined,
  params: {
    eventKey?: string | null | undefined;
    teamNumber?: number | null | undefined;
    scenarioId?: string | null | undefined;
  },
) {
  const freshUntil = new Date(generatedAtMs + WARM_BUNDLE_MAX_AGE_SECONDS * 1000).toISOString();
  const staleAt = new Date(
    generatedAtMs +
      Math.max(WARM_BUNDLE_MAX_AGE_SECONDS + 60, WARM_BUNDLE_MAX_AGE_SECONDS * 3) * 1000,
  ).toISOString();

  return {
    ...(extraMeta ?? {}),
    bundleVersion: String(generatedAtMs),
    etag: hashJsonValue(payload),
    freshUntil,
    staleAt,
    dependencyKeys: [
      params.eventKey ? `event:${params.eventKey}` : null,
      params.teamNumber ? `team:${params.teamNumber}` : null,
      params.scenarioId ? `scenario:${params.scenarioId}` : null,
    ].filter(Boolean),
  };
}

export async function resolveBundleTarget(partial: {
  eventKey?: unknown;
  teamNumber?: unknown;
}): Promise<ResolvedBundleTarget> {
  const requestedEventKey = readString(partial.eventKey);
  const requestedTeamNumber = readPositiveInteger(partial.teamNumber);
  const sharedTarget = await loadSharedActiveTarget().catch(() => ({
    workspaceKey: ACTIVE_TARGET_WORKSPACE_KEY,
    seasonYear: 2026,
    teamNumber: null,
    eventKey: '',
    eventName: '',
    eventShortName: '',
    eventLocation: '',
    startDate: null,
    endDate: null,
    lastSnapshotGeneratedAt: null,
    lastEventContextGeneratedAt: null,
    lastTeamCatalogGeneratedAt: null,
    lastRefreshedAt: null,
    refreshState: 'idle' as const,
    refreshError: null,
    updatedAt: null,
  }));
  const eventKey = requestedEventKey || sharedTarget.eventKey;
  const teamNumber = requestedTeamNumber ?? sharedTarget.teamNumber;
  const target = {
    ...sharedTarget,
    eventKey,
    teamNumber,
  };

  if (!eventKey) {
    throw new Error('No shared active target is selected.');
  }

  return {
    ...target,
    workspaceKeyForBundles: getEventWorkspaceKey(eventKey) ?? ACTIVE_TARGET_WORKSPACE_KEY,
  };
}

export async function loadBundleContext(
  target: ResolvedBundleTarget,
): Promise<LoadedBundleContext> {
  const eventContext = await loadEventContext(target.eventKey, target.teamNumber ?? null);
  const eventRows = buildEventTeamRowsFromContext(eventContext);
  return {
    target,
    eventContext,
    eventRows,
  };
}

export async function resolveWarmBundle<T>(params: {
  source: string;
  eventKey?: string | null;
  teamNumber?: number | null;
  workspaceKey: string;
  scenarioId?: string | null;
  variant?: string | null;
  forceRefresh?: boolean;
  build: () => Promise<T> | T;
  meta?: Record<string, unknown>;
}): Promise<WarmBundleRouteResponse<T>> {
  const bundleKey = buildWarmBundleKey({
    source: params.source,
    workspaceKey: params.workspaceKey,
    eventKey: params.eventKey,
    teamNumber: params.teamNumber,
    scenarioId: params.scenarioId,
    variant: params.variant,
  });

  if (!params.forceRefresh) {
    try {
      const cachedPayload = await loadWarmBundlePayloadRecord<T>(
        {
          source: params.source,
          workspaceKey: params.workspaceKey,
          eventKey: params.eventKey,
          teamNumber: params.teamNumber,
          scenarioId: params.scenarioId,
          variant: params.variant,
        },
        WARM_BUNDLE_MAX_AGE_SECONDS,
      );
      if (cachedPayload.payload != null) {
        const status = await loadWarmBundleStatus(bundleKey).catch(() => null);
        const generatedAtMs =
          typeof (cachedPayload.payload as { generatedAtMs?: unknown }).generatedAtMs === 'number'
            ? Number((cachedPayload.payload as { generatedAtMs?: unknown }).generatedAtMs)
            : Date.parse(String(cachedPayload.generatedAt ?? '')) || Date.now();
        return {
          generatedAtMs,
          bundleKey,
          cacheState: 'warm',
          refreshState: status?.state ?? 'ready',
          cacheLayer: cachedPayload.cacheLayer === 'none' ? 'supabase' : cachedPayload.cacheLayer,
          bundleVersion: readMetaString(status?.meta, 'bundleVersion') ?? String(generatedAtMs),
          etag:
            readMetaString(status?.meta, 'etag') ??
            cachedPayload.etag ??
            hashJsonValue(cachedPayload.payload),
          freshUntil:
            readMetaString(status?.meta, 'freshUntil') ??
            new Date(generatedAtMs + WARM_BUNDLE_MAX_AGE_SECONDS * 1000).toISOString(),
          staleAt:
            readMetaString(status?.meta, 'staleAt') ??
            new Date(
              generatedAtMs +
                Math.max(WARM_BUNDLE_MAX_AGE_SECONDS + 60, WARM_BUNDLE_MAX_AGE_SECONDS * 3) * 1000,
            ).toISOString(),
          payload: cachedPayload.payload,
        };
      }
    } catch {
      // Warm-cache lookups should never block a cold rebuild path.
    }
  }

  const baseBundleStatus = {
    bundleKey,
    workspaceKey: params.workspaceKey,
    source: params.source,
    eventKey: params.eventKey,
    teamNumber: params.teamNumber,
    scenarioId: params.scenarioId,
    variant: params.variant,
  };

  await saveWarmBundleStatus({
    ...baseBundleStatus,
    state: 'loading',
    ...(params.meta != null ? { meta: params.meta } : {}),
  }).catch(() => null);

  try {
    const payload = await params.build();
    const generatedAt =
      typeof (payload as { generatedAtMs?: unknown }).generatedAtMs === 'number'
        ? Number((payload as { generatedAtMs?: unknown }).generatedAtMs)
        : Date.now();
    const bundleMeta = buildWarmBundleMeta(generatedAt, payload, params.meta, {
      eventKey: params.eventKey,
      teamNumber: params.teamNumber,
      scenarioId: params.scenarioId,
    });

    await saveWarmBundlePayload({
      bundleKey,
      workspaceKey: params.workspaceKey,
      source: params.source,
      eventKey: params.eventKey,
      teamNumber: params.teamNumber,
      scenarioId: params.scenarioId,
      variant: params.variant,
      generatedAt,
      payload,
      state: 'ready',
      meta: bundleMeta,
    }).catch(() => null);

    return {
      generatedAtMs: generatedAt,
      bundleKey,
      cacheState: 'cold',
      refreshState: 'ready',
      cacheLayer: 'origin',
      bundleVersion: String(generatedAt),
      etag: readString(bundleMeta.etag),
      freshUntil: readString(bundleMeta.freshUntil),
      staleAt: readString(bundleMeta.staleAt),
      payload,
    };
  } catch (error) {
    await saveWarmBundleStatus({
      ...baseBundleStatus,
      state: 'error',
      error: error instanceof Error ? error.message : 'Unknown warm bundle error',
      ...(params.meta != null ? { meta: params.meta } : {}),
    }).catch(() => null);
    throw error;
  }
}

export async function readWarmBootstrapState(): Promise<{
  target: Awaited<ReturnType<typeof loadSharedActiveTarget>>;
  refreshStatus: Awaited<ReturnType<typeof loadSharedRefreshStatus>>;
}> {
  const [target, refreshStatus] = await Promise.all([
    loadSharedActiveTarget().catch(() => EMPTY_SHARED_ACTIVE_TARGET),
    loadSharedRefreshStatus().catch(() => EMPTY_SHARED_REFRESH_STATUS),
  ]);
  return { target, refreshStatus };
}

export type TeamCatalogBootstrapResult = {
  teamNumber: number | null;
  year: number;
  cached: boolean;
  generatedAt: string;
  events: TeamEventCatalogResult['events'];
};
