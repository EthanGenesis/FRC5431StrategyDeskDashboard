export type SharedWorkspaceKey = 'shared';

export type PersistedWorkspaceSettingsRecord = {
  workspaceKey: SharedWorkspaceKey;
  payload: Record<string, unknown>;
  updatedAt: string;
  updatedBy: string | null;
};

export type PersistedCompareDraftRecord = {
  id: string;
  workspaceKey: SharedWorkspaceKey;
  scope: 'current' | 'historical';
  payload: Record<string, unknown>;
  updatedAt: string;
  updatedBy: string | null;
};

export type PersistedArtifactRecord = {
  id: string;
  workspaceKey: SharedWorkspaceKey;
  label: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type PersistedStrategyRecord = {
  id: string;
  workspaceKey: SharedWorkspaceKey;
  eventKey: string;
  matchKey: string;
  matchLabel: string;
  eventName: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type PersistedSnapshotCacheRecord = {
  cacheKey: string;
  source: string;
  eventKey: string | null;
  teamNumber: number | null;
  generatedAt: string | null;
  payload: Record<string, unknown>;
  updatedAt: string;
};

export type PersistedUpstreamCacheRecord = {
  cacheKey: string;
  source: string;
  requestPath: string;
  payload: Record<string, unknown>;
  updatedAt: string;
};
