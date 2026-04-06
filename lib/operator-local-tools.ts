import type {
  AppSnapshot,
  DeskOpsResponse,
  PickListAnalysisResponse,
  PitOpsResponse,
  PlayoffSummaryResponse,
  TeamDossierResponse,
  WorkspacePresenceMode,
} from './types';
import type { RehearsalModeConfig } from './rehearsal-mode';

const DESK_PACKS_KEY = 'tbsb_local_desk_packs_v1';
const REPLAY_SESSIONS_KEY = 'tbsb_local_replay_sessions_v1';
const REHEARSAL_DRILLS_KEY = 'tbsb_local_rehearsal_drills_v1';
const WORKSPACE_PRESETS_KEY = 'tbsb_local_workspace_presets_v1';
const RECENT_SEARCHES_KEY = 'tbsb_local_recent_searches_v1';

const DESK_PACK_LIMIT = 4;
const REPLAY_SESSION_LIMIT = 8;
const REHEARSAL_DRILL_LIMIT = 12;
const WORKSPACE_PRESET_LIMIT = 18;
const RECENT_SEARCH_LIMIT = 20;

type JsonRecord = Record<string, unknown>;

export type LocalDeskPack = {
  id: string;
  workspaceKey: string;
  eventKey: string;
  teamNumber: number;
  label: string;
  capturedAtMs: number;
  snapshot: AppSnapshot | null;
  deskOps: DeskOpsResponse | null;
  teamDossier: TeamDossierResponse | null;
  pickListAnalysis: PickListAnalysisResponse | null;
  playoffSummary: PlayoffSummaryResponse | null;
  pitOps: PitOpsResponse | null;
};

export type ReplaySession = {
  id: string;
  label: string;
  createdAtMs: number;
  eventKey: string;
  teamNumber: number;
  workspaceKey: string;
  sourcePackId: string | null;
  pack: LocalDeskPack;
};

export type RehearsalDrill = {
  id: string;
  name: string;
  createdAtMs: number;
  updatedAtMs: number;
  config: RehearsalModeConfig;
};

export type WorkspacePreset = {
  id: string;
  name: string;
  createdAtMs: number;
  updatedAtMs: number;
  majorTab: string;
  currentSubTab: string;
  historicalSubTab: string;
  predictSubTab: string;
  eventKey: string;
  teamNumber: number | null;
  selectedMatchKey: string | null;
  selectedTeamNumber: number | null;
  activePickListId: string | null;
  activePlayoffResultId: string | null;
};

export type RecentSearchEntry = {
  id: string;
  eventKey: string;
  teamNumber: number;
  label: string;
  eventLabel: string;
  createdAtMs: number;
  matchLabel: string | null;
};

export type LocalPresenceArtifactMeta = {
  label: string;
  artifactId: string | null;
  mode: WorkspacePresenceMode;
};

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function readArray<T>(key: string): T[] {
  if (!hasWindow()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeArray<T>(key: string, rows: T[]): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    // Ignore browser storage failures and keep the desk working.
  }
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDeskPack(value: unknown): LocalDeskPack | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as JsonRecord;
  const workspaceKey = normalizeString(row.workspaceKey);
  const eventKey = normalizeString(row.eventKey);
  const teamNumber = normalizePositiveInteger(row.teamNumber);
  const capturedAtMs = Number(row.capturedAtMs);
  if (!workspaceKey || !eventKey || teamNumber == null || !Number.isFinite(capturedAtMs)) {
    return null;
  }
  return {
    id: normalizeString(row.id) || createId('desk_pack'),
    workspaceKey,
    eventKey,
    teamNumber,
    label: normalizeString(row.label) || `${eventKey} | ${teamNumber}`,
    capturedAtMs,
    snapshot: (row.snapshot ?? null) as AppSnapshot | null,
    deskOps: (row.deskOps ?? null) as DeskOpsResponse | null,
    teamDossier: (row.teamDossier ?? null) as TeamDossierResponse | null,
    pickListAnalysis: (row.pickListAnalysis ?? null) as PickListAnalysisResponse | null,
    playoffSummary: (row.playoffSummary ?? null) as PlayoffSummaryResponse | null,
    pitOps: (row.pitOps ?? null) as PitOpsResponse | null,
  };
}

function normalizeReplaySession(value: unknown): ReplaySession | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as JsonRecord;
  const pack = normalizeDeskPack(row.pack);
  const createdAtMs = Number(row.createdAtMs);
  if (!pack || !Number.isFinite(createdAtMs)) return null;
  return {
    id: normalizeString(row.id) || createId('replay'),
    label: normalizeString(row.label) || pack.label,
    createdAtMs,
    eventKey: pack.eventKey,
    teamNumber: pack.teamNumber,
    workspaceKey: pack.workspaceKey,
    sourcePackId: normalizeString(row.sourcePackId) || null,
    pack,
  };
}

function normalizeRehearsalDrill(value: unknown): RehearsalDrill | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as JsonRecord;
  const name = normalizeString(row.name);
  const createdAtMs = Number(row.createdAtMs);
  const updatedAtMs = Number(row.updatedAtMs);
  const config =
    row.config && typeof row.config === 'object' ? (row.config as RehearsalModeConfig) : null;
  if (!name || !Number.isFinite(createdAtMs) || !Number.isFinite(updatedAtMs) || !config) {
    return null;
  }
  return {
    id: normalizeString(row.id) || createId('rehearsal'),
    name,
    createdAtMs,
    updatedAtMs,
    config: cloneValue(config),
  };
}

function normalizeWorkspacePreset(value: unknown): WorkspacePreset | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as JsonRecord;
  const name = normalizeString(row.name);
  const eventKey = normalizeString(row.eventKey);
  const createdAtMs = Number(row.createdAtMs);
  const updatedAtMs = Number(row.updatedAtMs);
  if (!name || !eventKey || !Number.isFinite(createdAtMs) || !Number.isFinite(updatedAtMs)) {
    return null;
  }
  return {
    id: normalizeString(row.id) || createId('preset'),
    name,
    createdAtMs,
    updatedAtMs,
    majorTab: normalizeString(row.majorTab) || 'CURRENT',
    currentSubTab: normalizeString(row.currentSubTab) || 'NOW',
    historicalSubTab: normalizeString(row.historicalSubTab) || 'PRE_EVENT',
    predictSubTab: normalizeString(row.predictSubTab) || 'PREDICT',
    eventKey,
    teamNumber: normalizePositiveInteger(row.teamNumber),
    selectedMatchKey: normalizeString(row.selectedMatchKey) || null,
    selectedTeamNumber: normalizePositiveInteger(row.selectedTeamNumber),
    activePickListId: normalizeString(row.activePickListId) || null,
    activePlayoffResultId: normalizeString(row.activePlayoffResultId) || null,
  };
}

function normalizeRecentSearchEntry(value: unknown): RecentSearchEntry | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as JsonRecord;
  const eventKey = normalizeString(row.eventKey);
  const label = normalizeString(row.label);
  const eventLabel = normalizeString(row.eventLabel);
  const teamNumber = normalizePositiveInteger(row.teamNumber);
  const createdAtMs = Number(row.createdAtMs);
  if (!eventKey || !label || !eventLabel || teamNumber == null || !Number.isFinite(createdAtMs)) {
    return null;
  }
  return {
    id: normalizeString(row.id) || createId('recent'),
    eventKey,
    teamNumber,
    label,
    eventLabel,
    createdAtMs,
    matchLabel: normalizeString(row.matchLabel) || null,
  };
}

export function loadDeskPacks(): LocalDeskPack[] {
  return readArray<unknown>(DESK_PACKS_KEY)
    .map(normalizeDeskPack)
    .filter((row): row is LocalDeskPack => Boolean(row))
    .sort((left, right) => right.capturedAtMs - left.capturedAtMs);
}

export function saveDeskPack(pack: LocalDeskPack): LocalDeskPack[] {
  const existing = loadDeskPacks().filter((row) => row.id !== pack.id);
  const next = [cloneValue(pack), ...existing].slice(0, DESK_PACK_LIMIT);
  writeArray(DESK_PACKS_KEY, next);
  return next;
}

export function clearDeskPacks(): void {
  writeArray(DESK_PACKS_KEY, []);
}

export function getLastKnownGoodDeskPack(input?: {
  eventKey?: string | null;
  teamNumber?: number | null;
}): LocalDeskPack | null {
  const rows = loadDeskPacks();
  const filtered = rows.filter((row) => {
    if (input?.eventKey && row.eventKey !== normalizeString(input.eventKey)) return false;
    if (input?.teamNumber != null && row.teamNumber !== normalizePositiveInteger(input.teamNumber))
      return false;
    return true;
  });
  return filtered[0] ?? null;
}

export function loadReplaySessions(): ReplaySession[] {
  return readArray<unknown>(REPLAY_SESSIONS_KEY)
    .map(normalizeReplaySession)
    .filter((row): row is ReplaySession => Boolean(row))
    .sort((left, right) => right.createdAtMs - left.createdAtMs);
}

export function saveReplaySession(input: {
  label: string;
  pack: LocalDeskPack;
  sourcePackId?: string | null;
}): ReplaySession[] {
  const session: ReplaySession = {
    id: createId('replay'),
    label: normalizeString(input.label) || input.pack.label,
    createdAtMs: Date.now(),
    eventKey: input.pack.eventKey,
    teamNumber: input.pack.teamNumber,
    workspaceKey: input.pack.workspaceKey,
    sourcePackId: normalizeString(input.sourcePackId) || input.pack.id,
    pack: cloneValue(input.pack),
  };
  const next = [session, ...loadReplaySessions()].slice(0, REPLAY_SESSION_LIMIT);
  writeArray(REPLAY_SESSIONS_KEY, next);
  return next;
}

export function deleteReplaySession(sessionId: string): ReplaySession[] {
  const next = loadReplaySessions().filter((row) => row.id !== sessionId);
  writeArray(REPLAY_SESSIONS_KEY, next);
  return next;
}

export function clearReplaySessions(): void {
  writeArray(REPLAY_SESSIONS_KEY, []);
}

export function loadRehearsalDrills(): RehearsalDrill[] {
  return readArray<unknown>(REHEARSAL_DRILLS_KEY)
    .map(normalizeRehearsalDrill)
    .filter((row): row is RehearsalDrill => Boolean(row))
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}

export function saveRehearsalDrill(input: {
  id?: string | null;
  name: string;
  config: RehearsalModeConfig;
}): RehearsalDrill[] {
  const current = loadRehearsalDrills();
  const now = Date.now();
  const existing = current.find((row) => row.id === input.id) ?? null;
  const requestedName = normalizeString(input.name);
  const nextDrill: RehearsalDrill = {
    id: existing?.id ?? createId('rehearsal'),
    name:
      requestedName !== '' ? requestedName : (existing?.name ?? `Rehearsal ${current.length + 1}`),
    createdAtMs: existing?.createdAtMs ?? now,
    updatedAtMs: now,
    config: cloneValue(input.config),
  };
  const next = [nextDrill, ...current.filter((row) => row.id !== nextDrill.id)].slice(
    0,
    REHEARSAL_DRILL_LIMIT,
  );
  writeArray(REHEARSAL_DRILLS_KEY, next);
  return next;
}

export function duplicateRehearsalDrill(drillId: string): RehearsalDrill[] {
  const current = loadRehearsalDrills();
  const existing = current.find((row) => row.id === drillId);
  if (!existing) return current;
  const duplicated: RehearsalDrill = {
    ...cloneValue(existing),
    id: createId('rehearsal'),
    name: `${existing.name} Copy`,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };
  const next = [duplicated, ...current].slice(0, REHEARSAL_DRILL_LIMIT);
  writeArray(REHEARSAL_DRILLS_KEY, next);
  return next;
}

export function deleteRehearsalDrill(drillId: string): RehearsalDrill[] {
  const next = loadRehearsalDrills().filter((row) => row.id !== drillId);
  writeArray(REHEARSAL_DRILLS_KEY, next);
  return next;
}

export function loadWorkspacePresets(): WorkspacePreset[] {
  return readArray<unknown>(WORKSPACE_PRESETS_KEY)
    .map(normalizeWorkspacePreset)
    .filter((row): row is WorkspacePreset => Boolean(row))
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}

export function saveWorkspacePreset(
  input: Omit<WorkspacePreset, 'id' | 'createdAtMs' | 'updatedAtMs'> & { id?: string | null },
): WorkspacePreset[] {
  const current = loadWorkspacePresets();
  const now = Date.now();
  const existing = current.find((row) => row.id === input.id) ?? null;
  const requestedName = normalizeString(input.name);
  const nextPreset: WorkspacePreset = {
    id: existing?.id ?? createId('preset'),
    createdAtMs: existing?.createdAtMs ?? now,
    updatedAtMs: now,
    name: requestedName !== '' ? requestedName : (existing?.name ?? `Preset ${current.length + 1}`),
    majorTab: normalizeString(input.majorTab) || 'CURRENT',
    currentSubTab: normalizeString(input.currentSubTab) || 'NOW',
    historicalSubTab: normalizeString(input.historicalSubTab) || 'PRE_EVENT',
    predictSubTab: normalizeString(input.predictSubTab) || 'PREDICT',
    eventKey: normalizeString(input.eventKey),
    teamNumber: normalizePositiveInteger(input.teamNumber),
    selectedMatchKey: normalizeString(input.selectedMatchKey) || null,
    selectedTeamNumber: normalizePositiveInteger(input.selectedTeamNumber),
    activePickListId: normalizeString(input.activePickListId) || null,
    activePlayoffResultId: normalizeString(input.activePlayoffResultId) || null,
  };
  const next = [nextPreset, ...current.filter((row) => row.id !== nextPreset.id)].slice(
    0,
    WORKSPACE_PRESET_LIMIT,
  );
  writeArray(WORKSPACE_PRESETS_KEY, next);
  return next;
}

export function deleteWorkspacePreset(presetId: string): WorkspacePreset[] {
  const next = loadWorkspacePresets().filter((row) => row.id !== presetId);
  writeArray(WORKSPACE_PRESETS_KEY, next);
  return next;
}

export function loadRecentSearches(): RecentSearchEntry[] {
  return readArray<unknown>(RECENT_SEARCHES_KEY)
    .map(normalizeRecentSearchEntry)
    .filter((row): row is RecentSearchEntry => Boolean(row))
    .sort((left, right) => right.createdAtMs - left.createdAtMs);
}

export function saveRecentSearch(input: {
  eventKey: string;
  teamNumber: number;
  label: string;
  eventLabel: string;
  matchLabel?: string | null;
}): RecentSearchEntry[] {
  const eventKey = normalizeString(input.eventKey);
  const teamNumber = normalizePositiveInteger(input.teamNumber);
  if (!eventKey || teamNumber == null) return loadRecentSearches();
  const current = loadRecentSearches().filter(
    (row) => !(row.eventKey === eventKey && row.teamNumber === teamNumber),
  );
  const nextEntry: RecentSearchEntry = {
    id: createId('recent'),
    eventKey,
    teamNumber,
    label: normalizeString(input.label) || `${teamNumber} @ ${eventKey}`,
    eventLabel: normalizeString(input.eventLabel) || eventKey,
    createdAtMs: Date.now(),
    matchLabel: normalizeString(input.matchLabel) || null,
  };
  const next = [nextEntry, ...current].slice(0, RECENT_SEARCH_LIMIT);
  writeArray(RECENT_SEARCHES_KEY, next);
  return next;
}

export function rankCompareSuggestions(input: {
  eventTeamRows?: {
    teamKey?: string | null;
    teamNumber?: number | null;
    nickname?: string | null;
    rank?: number | null;
    composite?: number | null;
  }[];
  recentSearches?: RecentSearchEntry[];
  selectedTeams?: number[];
  loadedTeam?: number | null;
}): {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  score: number;
  reason: string;
}[] {
  const selected = new Set((input.selectedTeams ?? []).map((row) => Number(row)));
  const recentMap = new Map<number, number>();
  for (const [index, row] of (input.recentSearches ?? []).entries()) {
    recentMap.set(row.teamNumber, Math.max(0, RECENT_SEARCH_LIMIT - index));
  }
  const rows = Array.isArray(input.eventTeamRows) ? input.eventTeamRows : [];
  return rows
    .map((row) => {
      const teamNumber = normalizePositiveInteger(row.teamNumber);
      const teamKey = normalizeString(row.teamKey);
      if (teamNumber == null || !teamKey || selected.has(teamNumber)) return null;
      let score = 0;
      const reasons: string[] = [];
      const recentWeight = recentMap.get(teamNumber) ?? 0;
      if (recentWeight > 0) {
        score += recentWeight * 4;
        reasons.push('recently searched');
      }
      const rank = Number(row.rank);
      if (Number.isFinite(rank) && rank > 0 && rank <= 12) {
        score += Math.max(0, 26 - rank);
        reasons.push(`rank ${Math.floor(rank)}`);
      }
      const composite = Number(row.composite);
      if (Number.isFinite(composite)) {
        score += composite / 12;
        reasons.push('high composite');
      }
      if (teamNumber === normalizePositiveInteger(input.loadedTeam)) {
        score += 10;
        reasons.push('loaded team');
      }
      return {
        teamKey,
        teamNumber,
        nickname: normalizeString(row.nickname),
        score,
        reason: reasons.join(' | ') || 'event team',
      };
    })
    .filter(
      (
        row,
      ): row is {
        teamKey: string;
        teamNumber: number;
        nickname: string;
        score: number;
        reason: string;
      } => Boolean(row),
    )
    .sort((left, right) => right.score - left.score || left.teamNumber - right.teamNumber)
    .slice(0, 6);
}
