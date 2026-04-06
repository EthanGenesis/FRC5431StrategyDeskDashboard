import { formatMatchLabel, matchHasTeam, sortMatches, tbaTeamKey } from './logic';
import type { AllianceColor, AppSnapshot } from './types';

export const REHEARSAL_STORAGE_KEY = 'tbsb_rehearsal_mode_v1';

export type RehearsalModeConfig = {
  active: boolean;
  currentMatchKey: string | null;
  queueState: string;
  minutesToMatch: number;
  bumperColor: string;
  allianceColor: AllianceColor | null;
  inspectionStatus: string;
  pitAddress: string;
  signalTitle: string;
  signalBody: string;
};

export const DEFAULT_REHEARSAL_MODE_CONFIG: RehearsalModeConfig = {
  active: false,
  currentMatchKey: null,
  queueState: 'QUEUE_5',
  minutesToMatch: 18,
  bumperColor: 'RED',
  allianceColor: 'red',
  inspectionStatus: 'Ready',
  pitAddress: 'Pit TBD',
  signalTitle: '',
  signalBody: '',
};

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function queueMatchesAwayForState(queueState: string): number {
  const normalized = String(queueState ?? '')
    .trim()
    .toUpperCase();
  if (normalized === 'PLAYING_NOW') return 0;
  if (normalized === 'QUEUE_1') return 1;
  if (normalized === 'QUEUE_2') return 2;
  return 5;
}

function firstNonEmptyString(primary: string, fallback: string | null | undefined): string | null {
  const normalizedPrimary = primary.trim();
  if (normalizedPrimary) return normalizedPrimary;
  const normalizedFallback = String(fallback ?? '').trim();
  return normalizedFallback || null;
}

export function applyRehearsalMode(
  snapshot: AppSnapshot | null,
  teamNumber: number | null,
  config: RehearsalModeConfig,
): AppSnapshot | null {
  if (!snapshot || !teamNumber || !config.active) return snapshot;

  const nextSnapshot = cloneValue(snapshot);
  const loadedTeamKey = tbaTeamKey(teamNumber);
  const sortedMatches = sortMatches(nextSnapshot.tba?.matches ?? []);
  const loadedTeamMatches = sortedMatches.filter((match) => matchHasTeam(match, loadedTeamKey));
  const selectedMatch =
    loadedTeamMatches.find((match) => match.key === config.currentMatchKey) ??
    loadedTeamMatches[0] ??
    null;
  const selectedIndex = selectedMatch
    ? loadedTeamMatches.findIndex((match) => match.key === selectedMatch.key)
    : -1;
  const nextLoadedMatch =
    selectedIndex >= 0
      ? (loadedTeamMatches[selectedIndex + 1] ?? null)
      : (loadedTeamMatches[1] ?? null);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const startSeconds = nowSeconds + Math.max(0, Math.floor(config.minutesToMatch)) * 60;

  if (selectedMatch) {
    selectedMatch.predicted_time = startSeconds;
    selectedMatch.time = startSeconds;
    if (config.queueState === 'PLAYING_NOW') {
      selectedMatch.actual_time = nowSeconds;
    } else {
      selectedMatch.actual_time = null;
    }
  }
  if (nextLoadedMatch) {
    nextLoadedMatch.predicted_time = startSeconds + 45 * 60;
    nextLoadedMatch.time = startSeconds + 45 * 60;
  }

  nextSnapshot.nexus = nextSnapshot.nexus ?? {
    supported: true,
    status: 'available',
    currentMatchKey: selectedMatch?.key ?? null,
    nextMatchKey: nextLoadedMatch?.key ?? selectedMatch?.key ?? null,
    queueMatchesAway: null,
    queueText: null,
    pitMapUrl: null,
    pitsStatus: 'available',
    inspectionStatus: 'available',
    pitMapStatus: 'available',
    announcements: [],
    partsRequests: [],
    inspectionSummary: null,
    pits: [],
    matches: [],
    pitAddressByTeam: {},
    inspectionByTeam: {},
    loadedTeamOps: null,
    raw: {
      status: null,
      pits: [],
      pitMap: null,
      inspection: [],
      announcements: [],
      partsRequests: [],
    },
  };

  nextSnapshot.nexus.queueText = config.queueState;
  nextSnapshot.nexus.queueMatchesAway = queueMatchesAwayForState(config.queueState);
  nextSnapshot.nexus.currentMatchKey =
    config.queueState === 'PLAYING_NOW' ? (selectedMatch?.key ?? null) : null;
  nextSnapshot.nexus.nextMatchKey = selectedMatch?.key ?? null;
  nextSnapshot.nexus.loadedTeamOps = {
    teamNumber,
    pitAddress: firstNonEmptyString(
      config.pitAddress,
      nextSnapshot.nexus.loadedTeamOps?.pitAddress,
    ),
    inspectionStatus: firstNonEmptyString(
      config.inspectionStatus,
      nextSnapshot.nexus.loadedTeamOps?.inspectionStatus,
    ),
    currentMatchLabel:
      config.queueState === 'PLAYING_NOW' && selectedMatch ? formatMatchLabel(selectedMatch) : null,
    nextMatchLabel: selectedMatch ? formatMatchLabel(selectedMatch) : null,
    queueState: config.queueState,
    allianceColor: config.allianceColor,
    bumperColor: config.bumperColor || null,
    queueMatchesAway: queueMatchesAwayForState(config.queueState),
    partsRequestCount: 0,
    estimatedQueueTimeMs: Date.now() + Math.max(0, config.minutesToMatch - 10) * 60000,
    estimatedOnDeckTimeMs: Date.now() + Math.max(0, config.minutesToMatch - 5) * 60000,
    estimatedOnFieldTimeMs: Date.now() + Math.max(0, config.minutesToMatch - 2) * 60000,
    estimatedStartTimeMs: Date.now() + Math.max(0, config.minutesToMatch) * 60000,
    actualQueueTimeMs: null,
    actualOnDeckTimeMs: null,
    actualOnFieldTimeMs: null,
    actualStartTimeMs: null,
  };

  if (config.signalTitle.trim() || config.signalBody.trim()) {
    nextSnapshot.liveSignals = [
      {
        id: 'rehearsal_signal',
        workspaceKey: 'rehearsal',
        eventKey: nextSnapshot.inputs.eventKey,
        source: 'rehearsal',
        signalType: 'practice',
        title: config.signalTitle.trim() || 'Rehearsal signal',
        body: config.signalBody.trim(),
        dedupeKey: 'rehearsal_signal',
        createdAtMs: Date.now(),
        payload: {
          rehearsal: true,
        },
      },
      ...(Array.isArray(nextSnapshot.liveSignals) ? nextSnapshot.liveSignals : []),
    ];
  }

  return nextSnapshot;
}
