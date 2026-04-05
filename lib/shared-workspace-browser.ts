'use client';

import { DEFAULT_COMPARE_DRAFT } from './compare-storage';
import { PERSISTENCE_TABLES } from './persistence-surfaces';
import { DEFAULT_SETTINGS, DEFAULT_WEIGHTS } from './storage';
import { createSupabaseBrowserClient } from './supabase-browser';
import { isSupabaseConfigured } from './supabase';
import type { StrategyRecord, StrategyRecordSummary } from './strategy-types';
import type {
  CompareDraft,
  CompareSet,
  SettingsState,
  WorkspaceActivityEntry,
  WorkspaceChecklist,
  WorkspaceNote,
} from './types';
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
  | typeof PERSISTENCE_TABLES.playoffResults
  | typeof PERSISTENCE_TABLES.workspaceNotes
  | typeof PERSISTENCE_TABLES.workspaceChecklists;

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
const fallbackWorkspaceSettings = new Map<string, WorkspaceSettingsState>();
const fallbackCompareDrafts = new Map<string, CompareDraft>();
const fallbackNamedArtifacts = new Map<string, Map<string, NamedArtifact[]>>();
const fallbackStrategyRecords = new Map<string, StrategyRecord>();
const fallbackWorkspaceActivity = new Map<string, WorkspaceActivityEntry[]>();

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

function getFallbackNamedArtifactStore(table: NamedArtifactTable): Map<string, NamedArtifact[]> {
  let tableStore = fallbackNamedArtifacts.get(table);
  if (!tableStore) {
    tableStore = new Map<string, NamedArtifact[]>();
    fallbackNamedArtifacts.set(table, tableStore);
  }
  return tableStore;
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

function sortByCreatedDescending<
  T extends { createdAtMs?: number | null; createdAt?: number | string | null },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aCreated = Number(a.createdAtMs ?? a.createdAt ?? 0);
    const bCreated = Number(b.createdAtMs ?? b.createdAt ?? 0);
    return bCreated - aCreated;
  });
}

function normalizedFilterString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

type WorkspaceScopedFilter = {
  scope?: string;
  eventKey?: string | null;
  teamNumber?: number | null;
  matchKey?: string | null;
};

function matchesWorkspaceScopedFilter(
  item: Record<string, unknown>,
  filter: WorkspaceScopedFilter,
): boolean {
  if (filter.scope && normalizedFilterString(item.scope) !== normalizedFilterString(filter.scope)) {
    return false;
  }
  if (
    filter.eventKey != null &&
    normalizedFilterString(item.eventKey) !== normalizedFilterString(filter.eventKey)
  ) {
    return false;
  }
  if (filter.teamNumber != null) {
    const teamNumber = Number(item.teamNumber ?? 0);
    if (!Number.isFinite(teamNumber) || Math.floor(teamNumber) !== Math.floor(filter.teamNumber)) {
      return false;
    }
  }
  if (
    filter.matchKey != null &&
    normalizedFilterString(item.matchKey) !== normalizedFilterString(filter.matchKey)
  ) {
    return false;
  }
  return true;
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
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);
  const client = getBrowserClient();
  if (!client) {
    return (
      fallbackWorkspaceSettings.get(scopedWorkspaceKey) ?? pickWorkspaceSettings(DEFAULT_SETTINGS)
    );
  }

  try {
    const response = await client
      .from(PERSISTENCE_TABLES.workspaceSettings)
      .select('payload')
      .eq('workspace_key', scopedWorkspaceKey)
      .maybeSingle();

    if (response.error) {
      throw new Error(response.error.message);
    }

    return normalizeWorkspaceSettingsPayload(response.data?.payload);
  } catch {
    return (
      fallbackWorkspaceSettings.get(scopedWorkspaceKey) ?? pickWorkspaceSettings(DEFAULT_SETTINGS)
    );
  }
}

export async function saveWorkspaceSettings(
  workspaceKey: string | null | undefined,
  settings: SettingsState,
): Promise<void> {
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);
  const workspaceSettings = pickWorkspaceSettings(settings);
  const client = getBrowserClient();
  if (!client) {
    fallbackWorkspaceSettings.set(scopedWorkspaceKey, workspaceSettings);
    return;
  }

  try {
    const { error } = await client.from(PERSISTENCE_TABLES.workspaceSettings).upsert(
      {
        workspace_key: scopedWorkspaceKey,
        payload: workspaceSettings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_key' },
    );

    if (error) {
      throw new Error(error.message);
    }
  } catch {
    fallbackWorkspaceSettings.set(scopedWorkspaceKey, workspaceSettings);
  }
}

export async function loadCompareDraftForScope(
  scope: CompareDraftScope,
  workspaceKey: string | null | undefined,
): Promise<CompareDraft> {
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);
  const client = getBrowserClient();
  if (!client) {
    return normalizeCompareDraft(
      fallbackCompareDrafts.get(
        storageIdForWorkspace(scopedWorkspaceKey, `compare_draft_${scope}`),
      ),
    );
  }

  try {
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
  } catch {
    return normalizeCompareDraft(
      fallbackCompareDrafts.get(
        storageIdForWorkspace(scopedWorkspaceKey, `compare_draft_${scope}`),
      ),
    );
  }
}

export async function saveCompareDraftForScope(
  draft: CompareDraft,
  scope: CompareDraftScope,
  workspaceKey: string | null | undefined,
): Promise<void> {
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);
  const normalizedDraft = normalizeCompareDraft(draft);
  const client = getBrowserClient();
  if (!client) {
    fallbackCompareDrafts.set(
      storageIdForWorkspace(scopedWorkspaceKey, `compare_draft_${scope}`),
      normalizedDraft,
    );
    return;
  }

  try {
    const { error } = await client.from(PERSISTENCE_TABLES.compareDrafts).upsert(
      {
        id: storageIdForWorkspace(scopedWorkspaceKey, `compare_draft_${scope}`),
        workspace_key: scopedWorkspaceKey,
        scope,
        payload: normalizedDraft,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );

    if (error) {
      throw new Error(error.message);
    }
  } catch {
    fallbackCompareDrafts.set(
      storageIdForWorkspace(scopedWorkspaceKey, `compare_draft_${scope}`),
      normalizedDraft,
    );
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
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);
  const client = getBrowserClient();
  if (!client) {
    return normalizeNamedArtifactArray<CompareSet>(
      getFallbackNamedArtifactStore(PERSISTENCE_TABLES.compareSets).get(scopedWorkspaceKey) ?? [],
    );
  }

  try {
    const response = await client
      .from(PERSISTENCE_TABLES.compareSets)
      .select('payload')
      .eq('workspace_key', scopedWorkspaceKey)
      .order('updated_at', { ascending: false });

    if (response.error) {
      throw new Error(response.error.message);
    }

    return normalizeNamedArtifactArray<CompareSet>(extractPayloadArray(response.data));
  } catch {
    return normalizeNamedArtifactArray<CompareSet>(
      getFallbackNamedArtifactStore(PERSISTENCE_TABLES.compareSets).get(scopedWorkspaceKey) ?? [],
    );
  }
}

export async function saveCompareSetsShared(
  workspaceKey: string | null | undefined,
  sets: CompareSet[],
): Promise<void> {
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);
  if (!getBrowserClient()) {
    getFallbackNamedArtifactStore(PERSISTENCE_TABLES.compareSets).set(
      scopedWorkspaceKey,
      sortByUpdatedDescending(sets),
    );
    return;
  }
  try {
    await replaceNamedArtifactsForWorkspace(PERSISTENCE_TABLES.compareSets, workspaceKey, sets);
  } catch {
    getFallbackNamedArtifactStore(PERSISTENCE_TABLES.compareSets).set(
      scopedWorkspaceKey,
      sortByUpdatedDescending(sets),
    );
  }
}

export async function loadNamedArtifactsShared<T extends NamedArtifact>(
  table: NamedArtifactTable,
  workspaceKey: string | null | undefined,
): Promise<T[]> {
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);
  const client = getBrowserClient();
  if (!client) {
    return normalizeNamedArtifactArray<T>(
      getFallbackNamedArtifactStore(table).get(scopedWorkspaceKey) ?? [],
    );
  }

  try {
    const response = await client
      .from(table)
      .select('payload')
      .eq('workspace_key', scopedWorkspaceKey)
      .order('updated_at', { ascending: false });

    if (response.error) {
      throw new Error(response.error.message);
    }

    return normalizeNamedArtifactArray<T>(extractPayloadArray(response.data));
  } catch {
    return normalizeNamedArtifactArray<T>(
      getFallbackNamedArtifactStore(table).get(scopedWorkspaceKey) ?? [],
    );
  }
}

export async function saveNamedArtifactsShared<T extends NamedArtifact>(
  table: NamedArtifactTable,
  workspaceKey: string | null | undefined,
  items: T[],
): Promise<void> {
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);
  if (!getBrowserClient()) {
    getFallbackNamedArtifactStore(table).set(scopedWorkspaceKey, sortByUpdatedDescending(items));
    return;
  }
  try {
    await replaceNamedArtifactsForWorkspace(table, workspaceKey, items);
  } catch {
    getFallbackNamedArtifactStore(table).set(scopedWorkspaceKey, sortByUpdatedDescending(items));
  }
}

export async function loadWorkspaceNotesShared(
  workspaceKey: string | null | undefined,
  filter: WorkspaceScopedFilter = {},
): Promise<WorkspaceNote[]> {
  const rows = await loadNamedArtifactsShared<WorkspaceNote>(
    PERSISTENCE_TABLES.workspaceNotes,
    workspaceKey,
  );
  return sortByUpdatedDescending(
    rows.filter((row) => matchesWorkspaceScopedFilter(row as Record<string, unknown>, filter)),
  );
}

export async function saveWorkspaceNotesShared(
  workspaceKey: string | null | undefined,
  items: WorkspaceNote[],
): Promise<void> {
  await saveNamedArtifactsShared(PERSISTENCE_TABLES.workspaceNotes, workspaceKey, items);
}

export async function loadWorkspaceChecklistsShared(
  workspaceKey: string | null | undefined,
  filter: WorkspaceScopedFilter = {},
): Promise<WorkspaceChecklist[]> {
  const rows = await loadNamedArtifactsShared<WorkspaceChecklist>(
    PERSISTENCE_TABLES.workspaceChecklists,
    workspaceKey,
  );
  return sortByUpdatedDescending(
    rows.filter((row) => matchesWorkspaceScopedFilter(row as Record<string, unknown>, filter)),
  );
}

export async function saveWorkspaceChecklistsShared(
  workspaceKey: string | null | undefined,
  items: WorkspaceChecklist[],
): Promise<void> {
  await saveNamedArtifactsShared(PERSISTENCE_TABLES.workspaceChecklists, workspaceKey, items);
}

export async function listWorkspaceActivityShared(
  workspaceKey: string | null | undefined,
  filter: WorkspaceScopedFilter = {},
): Promise<WorkspaceActivityEntry[]> {
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);
  const client = getBrowserClient();
  if (!client) {
    return sortByCreatedDescending(
      (fallbackWorkspaceActivity.get(scopedWorkspaceKey) ?? []).filter((row) =>
        matchesWorkspaceScopedFilter(row as Record<string, unknown>, filter),
      ),
    );
  }

  try {
    const response = await client
      .from(PERSISTENCE_TABLES.workspaceActivity)
      .select('payload')
      .eq('workspace_key', scopedWorkspaceKey)
      .order('created_at', { ascending: false })
      .limit(60);

    if (response.error) {
      throw new Error(response.error.message);
    }

    return sortByCreatedDescending(
      extractPayloadArray(response.data)
        .filter((row): row is WorkspaceActivityEntry => isRecord(row))
        .filter((row) => matchesWorkspaceScopedFilter(row, filter)),
    );
  } catch {
    return sortByCreatedDescending(
      (fallbackWorkspaceActivity.get(scopedWorkspaceKey) ?? []).filter((row) =>
        matchesWorkspaceScopedFilter(row as Record<string, unknown>, filter),
      ),
    );
  }
}

export async function appendWorkspaceActivityShared(entry: WorkspaceActivityEntry): Promise<void> {
  const scopedWorkspaceKey = requireWorkspaceKey(entry.workspaceKey);
  const normalizedEntry = {
    ...entry,
    workspaceKey: scopedWorkspaceKey,
  };
  const client = getBrowserClient();
  if (!client) {
    const existing = fallbackWorkspaceActivity.get(scopedWorkspaceKey) ?? [];
    fallbackWorkspaceActivity.set(
      scopedWorkspaceKey,
      sortByCreatedDescending([normalizedEntry, ...existing]).slice(0, 80),
    );
    return;
  }

  try {
    const { error } = await client.from(PERSISTENCE_TABLES.workspaceActivity).upsert(
      {
        id: normalizedEntry.id,
        workspace_key: scopedWorkspaceKey,
        scope: normalizedEntry.scope,
        event_key: normalizedEntry.eventKey,
        team_number: normalizedEntry.teamNumber,
        match_key: normalizedEntry.matchKey,
        action: normalizedEntry.action,
        payload: normalizedEntry,
        created_at: toIsoTimestamp(normalizedEntry.createdAtMs),
      },
      { onConflict: 'id' },
    );

    if (error) {
      throw new Error(error.message);
    }
  } catch {
    const existing = fallbackWorkspaceActivity.get(scopedWorkspaceKey) ?? [];
    fallbackWorkspaceActivity.set(
      scopedWorkspaceKey,
      sortByCreatedDescending([normalizedEntry, ...existing]).slice(0, 80),
    );
  }
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
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);
  const client = getBrowserClient();
  if (!client) {
    return fallbackStrategyRecords.get(storageIdForWorkspace(scopedWorkspaceKey, id)) ?? null;
  }

  try {
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
  } catch {
    return fallbackStrategyRecords.get(storageIdForWorkspace(scopedWorkspaceKey, id)) ?? null;
  }
}

export async function saveStrategyRecordShared(record: StrategyRecord): Promise<void> {
  const scopedWorkspaceKey = requireWorkspaceKey(getEventWorkspaceKey(record.eventKey));
  const client = getBrowserClient();
  if (!client) {
    fallbackStrategyRecords.set(storageIdForWorkspace(scopedWorkspaceKey, record.id), record);
    return;
  }

  try {
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
  } catch {
    fallbackStrategyRecords.set(storageIdForWorkspace(scopedWorkspaceKey, record.id), record);
  }
}

export async function listStrategyRecordsShared(
  workspaceKey: string | null | undefined,
): Promise<StrategyRecordSummary[]> {
  const scopedWorkspaceKey = requireWorkspaceKey(workspaceKey);
  const client = getBrowserClient();
  if (!client) {
    return [...fallbackStrategyRecords.entries()]
      .filter(([id]) => id.startsWith(`${scopedWorkspaceKey}::`))
      .map(([, row]) => row)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .map((row) => ({
        id: row.id,
        eventKey: row.eventKey,
        matchKey: row.matchKey,
        matchLabel: row.matchLabel,
        eventName: row.eventName,
        status: row.status,
        planSummary: row.planSummary ?? null,
        templateId: row.templateId ?? null,
        riskLevel: row.riskLevel ?? null,
        copiedFrom: row.copiedFrom ?? null,
        updatedAtMs: row.updatedAtMs,
        allianceTeams: row.allianceTeams,
      }));
  }

  try {
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
        planSummary: row.planSummary ?? null,
        templateId: row.templateId ?? null,
        riskLevel: row.riskLevel ?? null,
        copiedFrom: row.copiedFrom ?? null,
        updatedAtMs: row.updatedAtMs,
        allianceTeams: row.allianceTeams,
      }));
  } catch {
    return [...fallbackStrategyRecords.entries()]
      .filter(([id]) => id.startsWith(`${scopedWorkspaceKey}::`))
      .map(([, row]) => row)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .map((row) => ({
        id: row.id,
        eventKey: row.eventKey,
        matchKey: row.matchKey,
        matchLabel: row.matchLabel,
        eventName: row.eventName,
        status: row.status,
        planSummary: row.planSummary ?? null,
        templateId: row.templateId ?? null,
        riskLevel: row.riskLevel ?? null,
        copiedFrom: row.copiedFrom ?? null,
        updatedAtMs: row.updatedAtMs,
        allianceTeams: row.allianceTeams,
      }));
  }
}
