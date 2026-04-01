import { SHARED_WORKSPACE_KEY } from './persistence-surfaces';

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readPositiveInteger(value: unknown): number | null {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function buildBootstrapHotCacheKey(workspaceKey: string | null | undefined): string {
  return ['bootstrap', readString(workspaceKey) || SHARED_WORKSPACE_KEY].join('::');
}

export function buildActiveTargetHotCacheKey(workspaceKey: string | null | undefined): string {
  return ['active_target', readString(workspaceKey) || SHARED_WORKSPACE_KEY].join('::');
}

export function buildRefreshStatusHotCacheKey(workspaceKey: string | null | undefined): string {
  return ['refresh_status', readString(workspaceKey) || SHARED_WORKSPACE_KEY].join('::');
}

export function buildTeamEventCatalogHotCacheKey(
  workspaceKey: string | null | undefined,
  teamNumber: number | null | undefined,
  year: number | null | undefined,
): string {
  return [
    'team_event_catalog',
    readString(workspaceKey) || SHARED_WORKSPACE_KEY,
    readPositiveInteger(teamNumber) ?? 'none',
    readPositiveInteger(year) ?? 'none',
  ].join('::');
}

export function buildWarmBundlePayloadHotCacheKey(bundleKey: string): string {
  return ['warm_bundle_payload', bundleKey].join('::');
}

export function buildWarmBundleStatusHotCacheKey(bundleKey: string): string {
  return ['warm_bundle_status', bundleKey].join('::');
}

export function buildWarmBundleManifestHotCacheKey(
  workspaceKey: string | null | undefined,
): string {
  return ['warm_bundle_manifest', readString(workspaceKey) || SHARED_WORKSPACE_KEY].join('::');
}

export function buildSnapshotHotCacheKey(
  source: string,
  eventKey: string | null | undefined,
  teamNumber: number | null | undefined,
): string {
  return [
    'snapshot_cache',
    readString(source) || 'snapshot',
    readString(eventKey) || 'none',
    readPositiveInteger(teamNumber) ?? 'none',
  ].join('::');
}

export function buildUpstreamHotCacheKey(source: string, requestPath: string): string {
  return ['upstream_cache', readString(source) || 'source', readString(requestPath)].join('::');
}
