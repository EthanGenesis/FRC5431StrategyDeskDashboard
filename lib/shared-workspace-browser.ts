'use client';

import { DEFAULT_COMPARE_DRAFT } from './compare-storage';
import { PERSISTENCE_TABLES } from './persistence-surfaces';
import { DEFAULT_SETTINGS, DEFAULT_WEIGHTS } from './storage';
import { createSupabaseBrowserClient } from './supabase-browser';
import { isSupabaseConfigured } from './supabase';
import type { StrategyRecord, StrategyRecordSummary } from './strategy-types';
import type { CompareDraft, CompareSet, SettingsState } from './types';
import { getEventWorkspaceKey } from './workspace-key';

type CompareDraftScope = 'current' | 'historical';

type WorkspaceArtifact = CompareSet | StrategyRecord | Record<string, unknown>;

type NamedArtifact = {
  id: string;
  name?: string;
  label?: string;
  createdAt?: number | string | null;
  createdAtMs?: number | null;
  updatedAt?: number | string | null;
  updatedAtMs?: number | null;
  [key: string]: unknown;
};

type NamedArtifactTable =
  | typeof PERSISTENCE_TABLES.compareSets
  | typeof PERSISTENCE_TABLES.predictScenarios
  | typeof PERSISTENCE_TABLES.allianceScenarios
  | typeof PERSISTENCE_TABLES.pickLists
  | typeof PERSISTENCE_TABLES.playoffResults;

const _WORKSPACE_SETTINGS_KEYS = [
  'lagMatches',
  'pollMs',
  'repeatUntilAck',
  'enablePlayingAnimation',
  'recentStartQual',
  'scoutingUrl',
  'logoDataUrl',
  'weights',
] as const;

type WorkspaceSettingsState = Pick<SettingsState, (typeof _WORKSPACE_SETTINGS_KEYS)[number]>;

let browserClient: ReturnType<typeof createSupabaseBrowserClient> | null = null;

function getBrowserClient() {
  if (!isSupabaseConfigured()) return null;
  browserClient ??= createSupabaseBrowserClient();
  return browserClient;
}

function assertBrowserClient() {
  const client = getBrowserClient();
  if (!client) {
    throw new Error('Supabase public client is not configured.');
  }
  return client;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeWorkspaceSettingsPayload(value: unknown): WorkspaceSettingsState {
  const parsedRecord = isRecord(value) ? value : {};
  const parsedWeights = isRecord(parsedRecord.weights) ? parsedRecord.weights : {};

  return {
    lagMatches:
      Number.isFinite(Number(parsedRecord.lagMatches)) && Number(parsedRecord.lagMatches) > 0
        ? Number(parsedRecord.lagMatches)
        : DEFAULT_SETTINGS.lagMatches,
    pollMs:
      Number.isFinite(Number(parsedRecord.pollMs)) && Number(parsedRecord.pollMs) > 0
        ? Number(parsedRecord.pollMs)
        : DEFAULT_SETTINGS.pollMs,
    repeatUntilAck:
      typeof parsedRecord.repeatUntilAck === 'boolean'
        ? parsedRecord.repeatUntilAck
        : DEFAULT_SETTINGS.repeatUntilAck,
    enablePlayingAnimation:
      typeof parsedRecord.enablePlayingAnimation === 'boolean'
        ? parsedRecord.enablePlayingAnimation
        : DEFAULT_SETTINGS.enablePlayingAnimation,
    recentStartQual:
      Number.isFinite(Number(parsedRecord.recentStartQual)) &&
      Number(parsedRecord.recentStartQual) >= 1
        ? Number(parsedRecord.recentStartQual)
        : DEFAULT_SETTINGS.recentStartQual,
    scoutingUrl:
      typeof parsedRecord.scoutingUrl === 'string'
        ? parsedRecord.scoutingUrl
        : DEFAULT_SETTINGS.scoutingUrl,
    logoDataUrl:
      typeof parsedRecord.logoDataUrl === 'string' || parsedRecord.logoDataUrl === null
        ? parsedRecord.logoDataUrl
        : DEFAULT_SETTINGS.logoDataUrl,
    weights: {
      ...DEFAULT_WEIGHTS,
      ...parsedWeights,
    },
  };
}

export function mergeWorkspaceSettingsIntoSettings(
  baseSettings: SettingsState,
  workspaceSettings: WorkspaceSettingsState,
): SettingsState {
  return {
    ...baseSettings,
    ...workspaceSettings,
    weights: {
      ...DEFAULT_WEIGHTS,
      ...workspaceSettings.weights,
    },
  };
}

function pickWorkspaceSettings(settings: SettingsState): WorkspaceSettingsState {
  return {
    lagMatches: settings.lagMatches,
    pollMs: settings.pollMs,
    repeatUntilAck: settings.repeatUntilAck,
    enablePlayingAnimation: settings.enablePlayingAnimation,
    recentStartQual: settings.recentStartQual,
    scoutingUrl: settings.scoutingUrl,
    logoDataUrl: settings.logoDataUrl,
    weights: {
      ...DEFAULT_WEIGHTS,
      ...(isRecord(settings.weights) ? settings.weights : {}),
    },
  };
}

function requireWorkspaceKey(workspaceKey: string | null | undefined): string {
  const normalized = String(workspaceKey ?? '').trim();
  if (!normalized) {
    throw new Error('A loaded event is required for shared workspace storage.');
  }
  return normalized;
}

function storageIdForWorkspace(workspaceKey: string, id: string): string {
  return `${workspaceKey}::${id}`;
}

function normalizeCompareDraft(value: CompareDraft | null | undefined): CompareDraft {
  return {
    ...DEFAULT_COMPARE_DRAFT,
    ...(value ?? {}),
    teamNumbers: Array.from(
      new Set(
        (value?.teamNumbers ?? [])
          .map((teamNumber) => Math.floor(Number(teamNumber)))
          .filter((teamNumber) => Number.isFinite(teamNumber) && teamNumber > 0),
      ),
    ),
  };
}

function normalizeNamedArtifactArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value as T[];
}

function extractPayloadArray(data: unknown): unknown[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => (isRecord(row) ? row.payload : null))
    .filter((payload): payload is NonNullable<unknown> => payload != null);
}

function artifactLabel(item: NamedArtifact): string {
  if (typeof item.name === 'string' && item.name.trim()) return item.name.trim();
  if (typeof item.label === 'string' && item.label.trim()) return item.label.trim();
  return item.id;
}

function toIsoTimestamp(value: number | string | null | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function sortByUpdatedDescending<T extends NamedArtifact>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aUpdated = Number(a.updatedAtMs ?? a.updatedAt ?? 0);
    const bUpdated = Number(b.updatedAtMs ?? b.updatedAt ?? 0);
    return bUpdated - aUpdated;
  });
}

async function replaceNamedArtifactsForWorkspace(
  table: NamedArtifactTable,
  workspaceKey: string | null | undefined,
  items: NamedArtifact[],
) {
  const client = assertBrowserClient();
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);
  const currentItems = sortByUpdatedDescending(items);
  const currentStorageIds = new Set(
    currentItems.map((item) => storageIdForWorkspace(scopedWorkspaceKey, item.id)),
  );

  const existingResponse = await client
    .from(table)
    .select('id')
    .eq('workspace_key', scopedWorkspaceKey);

  if (existingResponse.error) {
    throw new Error(existingResponse.error.message);
  }

  if (currentItems.length) {
    const { error: upsertError } = await client.from(table).upsert(
      currentItems.map((item) => ({
        id: storageIdForWorkspace(scopedWorkspaceKey, item.id),
        workspace_key: scopedWorkspaceKey,
        label: artifactLabel(item),
        payload: item,
        created_at: toIsoTimestamp(item.createdAtMs ?? item.createdAt),
        updated_at: toIsoTimestamp(item.updatedAtMs ?? item.updatedAt),
      })),
      { onConflict: 'id' },
    );

    if (upsertError) {
      throw new Error(upsertError.message);
    }
  }

  const existingIds = ((existingResponse.data ?? []) as { id: string }[]).map((row) => row.id);
  const idsToDelete = existingIds.filter((id) => !currentStorageIds.has(id));

  if (idsToDelete.length) {
    const { error: deleteError } = await client
      .from(table)
      .delete()
      .eq('workspace_key', scopedWorkspaceKey)
      .in('id', idsToDelete);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }
}

export async function loadWorkspaceSettings(
  workspaceKey: string | null | undefined,
): Promise<WorkspaceSettingsState> {
  const client = getBrowserClient();
  if (!client) return pickWorkspaceSettings(DEFAULT_SETTINGS);
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);

  const response = await client
    .from(PERSISTENCE_TABLES.workspaceSettings)
    .select('payload')
    .eq('workspace_key', scopedWorkspaceKey)
    .maybeSingle();

  if (response.error) {
    throw new Error(response.error.message);
  }

  return normalizeWorkspaceSettingsPayload(response.data?.payload);
}

export async function saveWorkspaceSettings(
  workspaceKey: string | null | undefined,
  settings: SettingsState,
): Promise<void> {
  const client = assertBrowserClient();
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);
  const { error } = await client.from(PERSISTENCE_TABLES.workspaceSettings).upsert(
    {
      workspace_key: scopedWorkspaceKey,
      payload: pickWorkspaceSettings(settings),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_key' },
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function loadCompareDraftForScope(
  scope: CompareDraftScope,
  workspaceKey: string | null | undefined,
): Promise<CompareDraft> {
  const client = getBrowserClient();
  if (!client) return DEFAULT_COMPARE_DRAFT;
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);

  const response = await client
    .from(PERSISTENCE_TABLES.compareDrafts)
    .select('payload')
    .eq('workspace_key', scopedWorkspaceKey)
    .eq('scope', scope)
    .maybeSingle();

  if (response.error) {
    throw new Error(response.error.message);
  }

  return normalizeCompareDraft((response.data?.payload ?? null) as CompareDraft | null);
}

export async function saveCompareDraftForScope(
  draft: CompareDraft,
  scope: CompareDraftScope,
  workspaceKey: string | null | undefined,
): Promise<void> {
  const client = assertBrowserClient();
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);
  const { error } = await client.from(PERSISTENCE_TABLES.compareDrafts).upsert(
    {
      id: storageIdForWorkspace(scopedWorkspaceKey, `compare_draft_${scope}`),
      workspace_key: scopedWorkspaceKey,
      scope,
      payload: normalizeCompareDraft(draft),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function addTeamToCompareDraftShared(
  teamNumber: number,
  loadedTeam: number | null | undefined,
  scope: CompareDraftScope,
  workspaceKey: string | null | undefined,
): Promise<CompareDraft> {
  const normalized = Math.floor(Number(teamNumber));
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return loadCompareDraftForScope(scope, workspaceKey);
  }

  const current = await loadCompareDraftForScope(scope, workspaceKey);
  const nextTeamNumbers = Array.from(new Set([...(current.teamNumbers ?? []), normalized]));
  const normalizedLoadedTeam =
    loadedTeam != null && Number.isFinite(Number(loadedTeam))
      ? Math.floor(Number(loadedTeam))
      : null;
  const nextDraft: CompareDraft = {
    ...current,
    teamNumbers: nextTeamNumbers,
    baselineTeamNumber:
      normalizedLoadedTeam != null && nextTeamNumbers.includes(normalizedLoadedTeam)
        ? normalizedLoadedTeam
        : current.baselineTeamNumber && nextTeamNumbers.includes(current.baselineTeamNumber)
          ? current.baselineTeamNumber
          : (nextTeamNumbers[0] ?? null),
  };

  await saveCompareDraftForScope(nextDraft, scope, workspaceKey);
  return nextDraft;
}

export async function loadCompareSetsShared(
  workspaceKey: string | null | undefined,
): Promise<CompareSet[]> {
  const client = getBrowserClient();
  if (!client) return [];
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);

  const response = await client
    .from(PERSISTENCE_TABLES.compareSets)
    .select('payload')
    .eq('workspace_key', scopedWorkspaceKey)
    .order('updated_at', { ascending: false });

  if (response.error) {
    throw new Error(response.error.message);
  }

  return normalizeNamedArtifactArray<CompareSet>(extractPayloadArray(response.data));
}

export async function saveCompareSetsShared(
  workspaceKey: string | null | undefined,
  sets: CompareSet[],
): Promise<void> {
  await replaceNamedArtifactsForWorkspace(PERSISTENCE_TABLES.compareSets, workspaceKey, sets);
}

export async function loadNamedArtifactsShared<T extends NamedArtifact>(
  table: NamedArtifactTable,
  workspaceKey: string | null | undefined,
): Promise<T[]> {
  const client = getBrowserClient();
  if (!client) return [];
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);

  const response = await client
    .from(table)
    .select('payload')
    .eq('workspace_key', scopedWorkspaceKey)
    .order('updated_at', { ascending: false });

  if (response.error) {
    throw new Error(response.error.message);
  }

  return normalizeNamedArtifactArray<T>(extractPayloadArray(response.data));
}

export async function saveNamedArtifactsShared<T extends NamedArtifact>(
  table: NamedArtifactTable,
  workspaceKey: string | null | undefined,
  items: T[],
): Promise<void> {
  await replaceNamedArtifactsForWorkspace(table, workspaceKey, items);
}

export async function getStrategyRecordShared(
  eventKey: string,
  matchKey: string,
): Promise<StrategyRecord | null> {
  return getStrategyRecordByIdShared(getEventWorkspaceKey(eventKey), `${eventKey}__${matchKey}`);
}

export async function getStrategyRecordByIdShared(
  workspaceKey: string | null | undefined,
  id: string,
): Promise<StrategyRecord | null> {
  const client = getBrowserClient();
  if (!client) return null;
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);

  const response = await client
    .from(PERSISTENCE_TABLES.strategyRecords)
    .select('payload')
    .eq('workspace_key', scopedWorkspaceKey)
    .eq('id', id)
    .maybeSingle();

  if (response.error) {
    throw new Error(response.error.message);
  }

  const payload: unknown = isRecord(response.data) ? response.data.payload : null;
  return isRecord(payload) ? (payload as StrategyRecord) : null;
}

export async function saveStrategyRecordShared(record: StrategyRecord): Promise<void> {
  const client = assertBrowserClient();
  const scopedWorkspaceKey = requireWorkspaceKey(getEventWorkspaceKey(record.eventKey));
  const { error } = await client.from(PERSISTENCE_TABLES.strategyRecords).upsert(
    {
      id: record.id,
      workspace_key: scopedWorkspaceKey,
      event_key: record.eventKey,
      match_key: record.matchKey,
      match_label: record.matchLabel,
      event_name: record.eventName,
      payload: record as WorkspaceArtifact,
      created_at: toIsoTimestamp(record.createdAtMs),
      updated_at: toIsoTimestamp(record.updatedAtMs),
    },
    { onConflict: 'id' },
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function listStrategyRecordsShared(
  workspaceKey: string | null | undefined,
): Promise<StrategyRecordSummary[]> {
  const client = getBrowserClient();
  if (!client) return [];
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);

  const response = await client
    .from(PERSISTENCE_TABLES.strategyRecords)
    .select('payload, updated_at')
    .eq('workspace_key', scopedWorkspaceKey)
    .order('updated_at', { ascending: false });

  if (response.error) {
    throw new Error(response.error.message);
  }

  return extractPayloadArray(response.data)
    .filter((row): row is StrategyRecord => isRecord(row))
    .map((row) => ({
      id: row.id,
      eventKey: row.eventKey,
      matchKey: row.matchKey,
      matchLabel: row.matchLabel,
      eventName: row.eventName,
      status: row.status,
      updatedAtMs: row.updatedAtMs,
      allianceTeams: row.allianceTeams,
    }));
}
