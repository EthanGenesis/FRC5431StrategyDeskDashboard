import { SHARED_WORKSPACE_KEY } from './persistence-surfaces';

export const ACTIVE_TARGET_SEASON_YEAR = 2026 as const;
export const ACTIVE_TARGET_WORKSPACE_KEY = SHARED_WORKSPACE_KEY;
export const TEAM_EVENT_CATALOG_MAX_AGE_MS = 1000 * 60 * 10;

export type SharedTargetRefreshState = 'idle' | 'loading' | 'ready' | 'error';

export type TeamEventCatalogEntry = {
  key: string;
  name: string;
  shortName: string;
  location: string;
  startDate: string | null;
  endDate: string | null;
};

export type SharedActiveTarget = {
  workspaceKey: string;
  seasonYear: number;
  teamNumber: number | null;
  eventKey: string;
  eventName: string;
  eventShortName: string;
  eventLocation: string;
  startDate: string | null;
  endDate: string | null;
  lastSnapshotGeneratedAt: string | null;
  lastEventContextGeneratedAt: string | null;
  lastTeamCatalogGeneratedAt: string | null;
  lastRefreshedAt: string | null;
  refreshState: SharedTargetRefreshState;
  refreshError: string | null;
  updatedAt: string | null;
};

export type SharedRefreshStatus = {
  workspaceKey: string;
  state: SharedTargetRefreshState;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  detail: Record<string, unknown> | null;
  updatedAt: string | null;
};

export const EMPTY_SHARED_ACTIVE_TARGET: SharedActiveTarget = {
  workspaceKey: ACTIVE_TARGET_WORKSPACE_KEY,
  seasonYear: ACTIVE_TARGET_SEASON_YEAR,
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
  refreshState: 'idle',
  refreshError: null,
  updatedAt: null,
};

export const EMPTY_SHARED_REFRESH_STATUS: SharedRefreshStatus = {
  workspaceKey: ACTIVE_TARGET_WORKSPACE_KEY,
  state: 'idle',
  lastRunAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  detail: null,
  updatedAt: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNullableString(value: unknown): string | null {
  const normalized = readString(value);
  return normalized || null;
}

function readPositiveInteger(value: unknown): number | null {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function readRefreshState(value: unknown): SharedTargetRefreshState {
  return value === 'loading' || value === 'ready' || value === 'error' ? value : 'idle';
}

export function normalizeTeamEventCatalogEntry(value: unknown): TeamEventCatalogEntry | null {
  const row = isRecord(value) ? value : {};
  const key = readString(row.key);
  const name = readString(row.name);
  if (!key || !name) return null;

  return {
    key,
    name,
    shortName: readString(row.shortName ?? row.short_name) || name,
    location: readString(row.location),
    startDate: readNullableString(row.startDate ?? row.start_date),
    endDate: readNullableString(row.endDate ?? row.end_date),
  };
}

export function normalizeTeamEventCatalog(value: unknown): TeamEventCatalogEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => normalizeTeamEventCatalogEntry(row))
    .filter((row): row is TeamEventCatalogEntry => row != null);
}

export function normalizeSharedActiveTarget(value: unknown): SharedActiveTarget {
  const row = isRecord(value) ? value : {};
  return {
    workspaceKey: readString(row.workspaceKey ?? row.workspace_key) || ACTIVE_TARGET_WORKSPACE_KEY,
    seasonYear: readPositiveInteger(row.seasonYear ?? row.season_year) ?? ACTIVE_TARGET_SEASON_YEAR,
    teamNumber: readPositiveInteger(row.teamNumber ?? row.team_number),
    eventKey: readString(row.eventKey ?? row.event_key),
    eventName: readString(row.eventName ?? row.event_name),
    eventShortName: readString(row.eventShortName ?? row.event_short_name),
    eventLocation: readString(row.eventLocation ?? row.event_location),
    startDate: readNullableString(row.startDate ?? row.start_date),
    endDate: readNullableString(row.endDate ?? row.end_date),
    lastSnapshotGeneratedAt: readNullableString(
      row.lastSnapshotGeneratedAt ?? row.last_snapshot_generated_at,
    ),
    lastEventContextGeneratedAt: readNullableString(
      row.lastEventContextGeneratedAt ?? row.last_event_context_generated_at,
    ),
    lastTeamCatalogGeneratedAt: readNullableString(
      row.lastTeamCatalogGeneratedAt ?? row.last_team_catalog_generated_at,
    ),
    lastRefreshedAt: readNullableString(row.lastRefreshedAt ?? row.last_refreshed_at),
    refreshState: readRefreshState(row.refreshState ?? row.refresh_state),
    refreshError: readNullableString(row.refreshError ?? row.refresh_error),
    updatedAt: readNullableString(row.updatedAt ?? row.updated_at),
  };
}

export function normalizeSharedRefreshStatus(value: unknown): SharedRefreshStatus {
  const row = isRecord(value) ? value : {};
  return {
    workspaceKey: readString(row.workspaceKey ?? row.workspace_key) || ACTIVE_TARGET_WORKSPACE_KEY,
    state: readRefreshState(row.state),
    lastRunAt: readNullableString(row.lastRunAt ?? row.last_run_at),
    lastSuccessAt: readNullableString(row.lastSuccessAt ?? row.last_success_at),
    lastErrorAt: readNullableString(row.lastErrorAt ?? row.last_error_at),
    lastError: readNullableString(row.lastError ?? row.last_error),
    detail: isRecord(row.detail) ? row.detail : null,
    updatedAt: readNullableString(row.updatedAt ?? row.updated_at),
  };
}

export function sharedTargetHasSelection(target: SharedActiveTarget | null | undefined): boolean {
  return Boolean(target?.teamNumber && target?.eventKey);
}

export function teamEventLabel(entry: TeamEventCatalogEntry | null | undefined): string {
  if (!entry) return '';
  const name = entry.shortName || entry.name || entry.key;
  return `${name} (${entry.key})`;
}
