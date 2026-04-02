import { POST as postAllianceBundleRoute } from '../alliance-bundle/route';
import { POST as postCompareBundleRoute } from '../compare-bundle/route';
import { GET as getDataSuperRoute, POST as postDataSuperRoute } from '../data-super/route';
import { GET as getDistrictRoute } from '../district-points/route';
import { GET as getEventContextRoute } from '../event-context/route';
import { GET as getGameManualRoute } from '../game-manual/route';
import { POST as postImpactBundleRoute } from '../impact-bundle/route';
import { POST as postPickListBundleRoute } from '../pick-list-bundle/route';
import { POST as postPlayoffBundleRoute } from '../playoff-bundle/route';
import { GET as getPreEventScoutRoute } from '../pre-event-scout/route';
import { POST as postPredictBundleRoute } from '../predict-bundle/route';
import { GET as getSnapshotRoute } from '../snapshot/route';
import { POST as postTeamCompareRoute } from '../team-compare/route';
import { GET as getTeamProfileRoute } from '../team-profile/route';
import { readJsonResponse } from '../../../lib/httpCache';
import { saveWarmBundlePayload } from '../../../lib/bundle-cache-server';
import { PERSISTENCE_TABLES } from '../../../lib/persistence-surfaces';
import {
  loadSharedActiveTarget,
  loadSharedRefreshStatus,
  loadTeamEventCatalog,
  saveSharedActiveTarget,
  saveSharedRefreshStatus,
} from '../../../lib/shared-target-server';
import {
  loadCompareDraftSharedServer,
  loadCompareSetsSharedServer,
  loadNamedArtifactsSharedServer,
} from '../../../lib/shared-workspace-server';
import {
  sharedTargetHasSelection,
  type SharedActiveTarget,
  type SharedRefreshStatus,
} from '../../../lib/shared-target';
import { getEventWorkspaceKey } from '../../../lib/workspace-key';

export type RefreshComponentState = {
  ok: boolean;
  status: number | null;
  error: string | null;
  generatedAtMs: number | null;
};

export type SharedTargetRefreshResult = {
  ok: boolean;
  target: SharedActiveTarget;
  refreshStatus: SharedRefreshStatus;
  components: Record<string, RefreshComponentState>;
};

type SavedArtifact = {
  id: string;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toIsoString(value: string | number | Date | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readTimestamp(value: unknown): number {
  const directNumber = readNumber(value);
  if (directNumber != null) return directNumber;
  const parsed =
    typeof value === 'string' || value instanceof Date ? Date.parse(String(value)) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isSkippableRefreshFailure(name: string, errorText: string): boolean {
  const normalizedName = readString(name).toLowerCase();
  const normalizedError = readString(errorText).toLowerCase();
  if (!normalizedName.startsWith('compare_')) {
    return false;
  }
  return normalizedError.includes('no compare teams are configured');
}

async function invokeRoute(
  name: string,
  handler: (req: Request) => Promise<Response>,
  request: Request,
): Promise<RefreshComponentState> {
  try {
    const response = await handler(request);
    const json = await readJsonResponse<Record<string, unknown> | { error: string }>(response);
    if (!response.ok) {
      const errorText =
        isRecord(json) && typeof json.error === 'string'
          ? json.error
          : `${name} failed (${response.status})`;
      if (isSkippableRefreshFailure(name, errorText)) {
        return {
          ok: true,
          status: response.status,
          error: null,
          generatedAtMs: null,
        };
      }
      return {
        ok: false,
        status: response.status,
        error: errorText,
        generatedAtMs: null,
      };
    }

    const generatedAtRecord = isRecord(json) ? (json as Record<string, unknown>) : null;
    const generatedAtValue = generatedAtRecord?.generatedAtMs ?? null;
    const generatedAtMs = Number.isFinite(Number(generatedAtValue))
      ? Number(generatedAtValue)
      : null;
    return {
      ok: true,
      status: response.status,
      error: null,
      generatedAtMs,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : `${name} failed`,
      generatedAtMs: null,
    };
  }
}

async function cacheSavedArtifactBundle(
  source: string,
  workspaceKey: string,
  eventKey: string,
  teamNumber: number | null,
  artifact: SavedArtifact,
): Promise<RefreshComponentState> {
  try {
    const scenarioId = readString(artifact.id);
    if (!scenarioId) {
      return {
        ok: false,
        status: null,
        error: 'Missing saved artifact id',
        generatedAtMs: null,
      };
    }

    await saveWarmBundlePayload({
      workspaceKey,
      source,
      eventKey,
      teamNumber,
      scenarioId,
      generatedAt:
        readTimestamp(
          artifact.updatedAtMs ?? artifact.updatedAt ?? artifact.createdAtMs ?? artifact.createdAt,
        ) ?? Date.now(),
      payload: artifact,
      meta: {
        artifactLabel: readString(artifact.name ?? artifact.label) || scenarioId,
      },
    });

    return {
      ok: true,
      status: 200,
      error: null,
      generatedAtMs: Date.now(),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : 'Failed to cache saved artifact',
      generatedAtMs: null,
    };
  }
}

export async function refreshSharedTargetCaches(): Promise<SharedTargetRefreshResult> {
  const currentStatus = await loadSharedRefreshStatus();
  const target = await loadSharedActiveTarget();
  const startedAt = new Date().toISOString();

  if (!sharedTargetHasSelection(target)) {
    return {
      ok: false,
      target,
      refreshStatus: currentStatus,
      components: {},
    };
  }

  await saveSharedRefreshStatus({
    state: 'loading',
    lastRunAt: startedAt,
    lastError: null,
    detail: { teamNumber: target.teamNumber, eventKey: target.eventKey },
  });
  await saveSharedActiveTarget(
    {
      refreshState: 'loading',
      refreshError: null,
    },
    {
      baseTarget: target,
    },
  );

  const teamCatalogResult = await loadTeamEventCatalog(target.teamNumber ?? 0, {
    year: target.seasonYear,
    forceRefresh: true,
  });
  const workspaceKey = getEventWorkspaceKey(target.eventKey) ?? target.workspaceKey;
  const [currentCompareDraft, historicalCompareDraft] = await Promise.all([
    loadCompareDraftSharedServer('current', workspaceKey),
    loadCompareDraftSharedServer('historical', workspaceKey),
  ]);

  const baseUrl = 'http://localhost';
  const currentCompareTeams = Array.from(
    new Set([...(currentCompareDraft.teamNumbers ?? []), target.teamNumber ?? 0].filter(Boolean)),
  );
  const historicalCompareTeams = Array.from(
    new Set(
      [...(historicalCompareDraft.teamNumbers ?? []), target.teamNumber ?? 0].filter(Boolean),
    ),
  );
  const componentEntries = await Promise.all([
    invokeRoute(
      'snapshot',
      getSnapshotRoute,
      new Request(
        `${baseUrl}/api/snapshot?team=${encodeURIComponent(String(target.teamNumber))}&eventKey=${encodeURIComponent(target.eventKey)}`,
      ),
    ).then((result) => ['snapshot', result] as const),
    invokeRoute(
      'event_context',
      getEventContextRoute,
      new Request(`${baseUrl}/api/event-context?eventKey=${encodeURIComponent(target.eventKey)}`),
    ).then((result) => ['event_context', result] as const),
    invokeRoute(
      'team_profile',
      getTeamProfileRoute,
      new Request(
        `${baseUrl}/api/team-profile?team=${encodeURIComponent(String(target.teamNumber))}&eventKey=${encodeURIComponent(target.eventKey)}`,
      ),
    ).then((result) => ['team_profile', result] as const),
    invokeRoute(
      'pre_event_scout',
      getPreEventScoutRoute,
      new Request(`${baseUrl}/api/pre-event-scout?eventKey=${encodeURIComponent(target.eventKey)}`),
    ).then((result) => ['pre_event_scout', result] as const),
    invokeRoute(
      'data_super',
      getDataSuperRoute,
      new Request(
        `${baseUrl}/api/data-super?eventKey=${encodeURIComponent(target.eventKey)}&loadedTeam=${encodeURIComponent(String(target.teamNumber))}`,
      ),
    ).then((result) => ['data_super', result] as const),
    ...(currentCompareTeams.length
      ? [
          invokeRoute(
            'data_super_current',
            postDataSuperRoute,
            new Request(`${baseUrl}/api/data-super`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                eventKey: target.eventKey,
                loadedTeam: target.teamNumber,
                compareTeams: currentCompareTeams,
              }),
            }),
          ).then((result) => ['data_super_current', result] as const),
        ]
      : []),
    ...(historicalCompareTeams.length
      ? [
          invokeRoute(
            'data_super_historical',
            postDataSuperRoute,
            new Request(`${baseUrl}/api/data-super`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                eventKey: target.eventKey,
                loadedTeam: target.teamNumber,
                compareTeams: historicalCompareTeams,
              }),
            }),
          ).then((result) => ['data_super_historical', result] as const),
        ]
      : []),
    invokeRoute(
      'district_points',
      getDistrictRoute,
      new Request(
        `${baseUrl}/api/district-points?eventKey=${encodeURIComponent(target.eventKey)}&team=${encodeURIComponent(String(target.teamNumber))}`,
      ),
    ).then((result) => ['district_points', result] as const),
    invokeRoute('game_manual', getGameManualRoute, new Request(`${baseUrl}/api/game-manual`)).then(
      (result) => ['game_manual', result] as const,
    ),
    invokeRoute(
      'compare_bundle',
      postCompareBundleRoute,
      new Request(`${baseUrl}/api/compare-bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: target.eventKey,
          teamNumber: target.teamNumber,
        }),
      }),
    ).then((result) => ['compare_bundle', result] as const),
    invokeRoute(
      'compare_bundle_historical',
      postCompareBundleRoute,
      new Request(`${baseUrl}/api/compare-bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: target.eventKey,
          teamNumber: target.teamNumber,
          scope: 'historical',
        }),
      }),
    ).then((result) => ['compare_bundle_historical', result] as const),
    ...(currentCompareTeams.length
      ? [
          invokeRoute(
            'team_compare_current',
            postTeamCompareRoute,
            new Request(`${baseUrl}/api/team-compare`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                teams: currentCompareTeams,
                eventKey: target.eventKey,
              }),
            }),
          ).then((result) => ['team_compare_current', result] as const),
        ]
      : []),
    ...(historicalCompareTeams.length
      ? [
          invokeRoute(
            'team_compare_historical',
            postTeamCompareRoute,
            new Request(`${baseUrl}/api/team-compare`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                teams: historicalCompareTeams,
                eventKey: target.eventKey,
              }),
            }),
          ).then((result) => ['team_compare_historical', result] as const),
        ]
      : []),
    invokeRoute(
      'predict_bundle',
      postPredictBundleRoute,
      new Request(`${baseUrl}/api/predict-bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: target.eventKey,
          teamNumber: target.teamNumber,
        }),
      }),
    ).then((result) => ['predict_bundle', result] as const),
    invokeRoute(
      'alliance_bundle',
      postAllianceBundleRoute,
      new Request(`${baseUrl}/api/alliance-bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: target.eventKey,
          teamNumber: target.teamNumber,
        }),
      }),
    ).then((result) => ['alliance_bundle', result] as const),
    invokeRoute(
      'playoff_bundle',
      postPlayoffBundleRoute,
      new Request(`${baseUrl}/api/playoff-bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: target.eventKey,
          teamNumber: target.teamNumber,
        }),
      }),
    ).then((result) => ['playoff_bundle', result] as const),
    invokeRoute(
      'impact_bundle',
      postImpactBundleRoute,
      new Request(`${baseUrl}/api/impact-bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: target.eventKey,
          teamNumber: target.teamNumber,
        }),
      }),
    ).then((result) => ['impact_bundle', result] as const),
    invokeRoute(
      'pick_list_bundle',
      postPickListBundleRoute,
      new Request(`${baseUrl}/api/pick-list-bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: target.eventKey,
          teamNumber: target.teamNumber,
        }),
      }),
    ).then((result) => ['pick_list_bundle', result] as const),
  ]);

  const [compareSets, predictScenarios, allianceScenarios, pickLists, playoffResults] =
    await Promise.all([
      loadCompareSetsSharedServer(workspaceKey),
      loadNamedArtifactsSharedServer<SavedArtifact>(
        PERSISTENCE_TABLES.predictScenarios,
        workspaceKey,
      ),
      loadNamedArtifactsSharedServer<SavedArtifact>(
        PERSISTENCE_TABLES.allianceScenarios,
        workspaceKey,
      ),
      loadNamedArtifactsSharedServer<SavedArtifact>(PERSISTENCE_TABLES.pickLists, workspaceKey),
      loadNamedArtifactsSharedServer<SavedArtifact>(
        PERSISTENCE_TABLES.playoffResults,
        workspaceKey,
      ),
    ]);

  const compareSetEntries = await Promise.all(
    compareSets.map((compareSet) =>
      invokeRoute(
        `compare_set_${compareSet.id}`,
        postCompareBundleRoute,
        new Request(`${baseUrl}/api/compare-bundle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventKey: target.eventKey,
            teamNumber: target.teamNumber,
            scenarioId: compareSet.id,
          }),
        }),
      ).then((result) => [`compare_set_${compareSet.id}`, result] as const),
    ),
  );

  const savedArtifactEntries = await Promise.all([
    ...predictScenarios.map((artifact) =>
      cacheSavedArtifactBundle(
        'predict_saved',
        workspaceKey,
        target.eventKey,
        target.teamNumber,
        artifact,
      ).then((result) => [`predict_saved_${readString(artifact.id)}`, result] as const),
    ),
    ...allianceScenarios.map((artifact) =>
      cacheSavedArtifactBundle(
        'alliance_saved',
        workspaceKey,
        target.eventKey,
        target.teamNumber,
        artifact,
      ).then((result) => [`alliance_saved_${readString(artifact.id)}`, result] as const),
    ),
    ...pickLists.map((artifact) =>
      cacheSavedArtifactBundle(
        'pick_list_saved',
        workspaceKey,
        target.eventKey,
        target.teamNumber,
        artifact,
      ).then((result) => [`pick_list_saved_${readString(artifact.id)}`, result] as const),
    ),
    ...playoffResults.map((artifact) =>
      cacheSavedArtifactBundle(
        'playoff_saved',
        workspaceKey,
        target.eventKey,
        target.teamNumber,
        artifact,
      ).then((result) => [`playoff_saved_${readString(artifact.id)}`, result] as const),
    ),
  ]);

  const components = Object.fromEntries([
    ...componentEntries,
    ...compareSetEntries,
    ...savedArtifactEntries,
  ]) as Record<string, RefreshComponentState>;

  const failedComponents = Object.entries(components).filter(([, state]) => !state.ok);
  const refreshError = failedComponents
    .map(([name, state]) => `${name}: ${state.error}`)
    .join('; ');
  const completedAt = new Date().toISOString();
  const nextTarget = await saveSharedActiveTarget(
    {
      lastSnapshotGeneratedAt:
        toIsoString(components.snapshot?.generatedAtMs) ?? target.lastSnapshotGeneratedAt,
      lastEventContextGeneratedAt:
        toIsoString(components.event_context?.generatedAtMs) ?? target.lastEventContextGeneratedAt,
      lastTeamCatalogGeneratedAt: teamCatalogResult.generatedAt,
      lastRefreshedAt: completedAt,
      refreshState: failedComponents.length ? 'error' : 'ready',
      refreshError: refreshError || null,
    },
    {
      baseTarget: target,
    },
  );
  const nextStatus = await saveSharedRefreshStatus({
    state: failedComponents.length ? 'error' : 'ready',
    lastRunAt: startedAt,
    lastSuccessAt: failedComponents.length ? currentStatus.lastSuccessAt : completedAt,
    lastErrorAt: failedComponents.length ? completedAt : null,
    lastError: refreshError || null,
    detail: {
      teamNumber: target.teamNumber,
      eventKey: target.eventKey,
      teamCatalogGeneratedAt: teamCatalogResult.generatedAt,
      components,
    },
  });

  return {
    ok: failedComponents.length === 0,
    target: nextTarget,
    refreshStatus: nextStatus,
    components,
  };
}
