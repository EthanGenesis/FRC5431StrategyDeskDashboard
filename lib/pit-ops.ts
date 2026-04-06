import {
  allianceForTeam,
  bestCountdownUnix,
  formatMatchLabel,
  matchHasTeam,
  sortMatches,
  tbaTeamKey,
} from './logic';
import type { AppSnapshot, PitOpsResponse, PitTimelineMatchRow, PitTimelineRow } from './types';
import { buildQueueLadder } from './workspace-collab';

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCountdownMs(value: number | null | undefined, nowMs: number): number | null {
  if (!Number.isFinite(Number(value))) return null;
  return Math.max(0, Math.floor(Number(value) * 1000 - nowMs));
}

function compLevelLabel(value: string): string {
  if (value === 'qm') return 'Qualification';
  if (value === 'ef') return 'Round of 16';
  if (value === 'qf') return 'Quarterfinal';
  if (value === 'sf') return 'Semifinal';
  if (value === 'f') return 'Final';
  return value.toUpperCase();
}

function matchState(
  match: AppSnapshot['tba']['matches'][number],
  nowMs: number,
): PitTimelineMatchRow['state'] {
  const redScore = match?.alliances?.red?.score;
  const blueScore = match?.alliances?.blue?.score;
  const completed =
    (typeof redScore === 'number' &&
      typeof blueScore === 'number' &&
      redScore >= 0 &&
      blueScore >= 0) ||
    match.actual_time != null ||
    match.post_result_time != null;
  if (completed) return 'completed';
  const countdownMs = normalizeCountdownMs(bestCountdownUnix(match), nowMs);
  if (countdownMs != null && countdownMs <= 0) return 'playing_now';
  return 'upcoming';
}

function formatDurationLabel(durationMs: number | null): string {
  if (!Number.isFinite(Number(durationMs))) return 'Turnaround unknown';
  const minutes = Math.max(0, Math.round(Number(durationMs) / 60000));
  if (minutes <= 0) return 'No turnaround';
  return `${minutes}m turnaround`;
}

export function buildPitOpsResponse(params: {
  workspaceKey: string;
  eventKey: string;
  teamNumber: number;
  snapshot: AppSnapshot | null;
  nowMs?: number;
}): PitOpsResponse {
  const { workspaceKey, eventKey, teamNumber, snapshot } = params;
  const nowMs = Number.isFinite(Number(params.nowMs)) ? Number(params.nowMs) : Date.now();
  const loadedTeamKey = tbaTeamKey(teamNumber);
  const loadedTeamOps = snapshot?.nexus?.loadedTeamOps ?? null;
  const matches = sortMatches(snapshot?.tba?.matches ?? []);
  const nextLoadedMatch =
    matches.find(
      (match) => matchHasTeam(match, loadedTeamKey) && matchState(match, nowMs) !== 'completed',
    ) ?? null;
  const timeline: PitTimelineRow[] = [];
  let previousLoadedQualMatch: AppSnapshot['tba']['matches'][number] | null = null;

  for (const match of matches) {
    const isLoadedTeamMatch = matchHasTeam(match, loadedTeamKey);
    const label = formatMatchLabel(match);
    if (isLoadedTeamMatch && previousLoadedQualMatch && match.comp_level === 'qm') {
      const previousStart = bestCountdownUnix(previousLoadedQualMatch);
      const nextStart = bestCountdownUnix(match);
      const durationMs =
        Number.isFinite(Number(previousStart)) && Number.isFinite(Number(nextStart))
          ? Math.max(0, Math.round((Number(nextStart) - Number(previousStart)) * 1000))
          : null;
      timeline.push({
        kind: 'turnaround',
        id: `turnaround_${previousLoadedQualMatch.key}_${match.key}`,
        fromMatchKey: previousLoadedQualMatch.key,
        toMatchKey: match.key,
        fromLabel: formatMatchLabel(previousLoadedQualMatch),
        toLabel: label,
        durationMs,
        durationLabel: formatDurationLabel(durationMs),
      });
    }

    timeline.push({
      kind: 'match',
      id: match.key,
      matchKey: match.key,
      label: `${label} • ${compLevelLabel(match.comp_level)}`,
      compLevel: match.comp_level,
      setNumber: Math.floor(Number(match.set_number) || 0),
      matchNumber: Math.floor(Number(match.match_number) || 0),
      timeMs: Number.isFinite(Number(bestCountdownUnix(match)))
        ? Math.floor(Number(bestCountdownUnix(match)) * 1000)
        : null,
      countdownMs: normalizeCountdownMs(bestCountdownUnix(match), nowMs),
      state: matchState(match, nowMs),
      isLoadedTeamMatch,
      allianceColor: isLoadedTeamMatch ? allianceForTeam(match, loadedTeamKey) : null,
      teamKeys: [
        ...(match.alliances?.red?.team_keys ?? []),
        ...(match.alliances?.blue?.team_keys ?? []),
      ],
    });

    if (isLoadedTeamMatch && match.comp_level === 'qm') {
      previousLoadedQualMatch = match;
    }
  }

  return {
    generatedAtMs: nowMs,
    workspaceKey,
    eventKey,
    eventName:
      readString(snapshot?.tba?.event?.short_name) ||
      readString(snapshot?.tba?.event?.name) ||
      eventKey,
    teamNumber,
    currentMatchLabel: loadedTeamOps?.currentMatchLabel ?? null,
    nextMatchLabel: loadedTeamOps?.nextMatchLabel ?? null,
    countdownMs: nextLoadedMatch
      ? normalizeCountdownMs(bestCountdownUnix(nextLoadedMatch), nowMs)
      : null,
    bumperColor: loadedTeamOps?.bumperColor ?? null,
    allianceColor: loadedTeamOps?.allianceColor ?? null,
    queueState: loadedTeamOps?.queueState ?? snapshot?.nexus?.queueText ?? null,
    queueMatchesAway: loadedTeamOps?.queueMatchesAway ?? snapshot?.nexus?.queueMatchesAway ?? null,
    queueLadder: buildQueueLadder(
      loadedTeamOps?.queueState ?? snapshot?.nexus?.queueText ?? null,
      loadedTeamOps?.queueMatchesAway ?? snapshot?.nexus?.queueMatchesAway ?? null,
      {
        queue: loadedTeamOps?.estimatedQueueTimeMs ?? null,
        onDeck: loadedTeamOps?.estimatedOnDeckTimeMs ?? null,
        onField: loadedTeamOps?.estimatedOnFieldTimeMs ?? null,
        start: loadedTeamOps?.estimatedStartTimeMs ?? null,
      },
    ),
    pitAddress: loadedTeamOps?.pitAddress ?? null,
    inspectionStatus: loadedTeamOps?.inspectionStatus ?? null,
    estimatedQueueTimeMs: loadedTeamOps?.estimatedQueueTimeMs ?? null,
    estimatedOnDeckTimeMs: loadedTeamOps?.estimatedOnDeckTimeMs ?? null,
    estimatedOnFieldTimeMs: loadedTeamOps?.estimatedOnFieldTimeMs ?? null,
    estimatedStartTimeMs: loadedTeamOps?.estimatedStartTimeMs ?? null,
    timeline,
  };
}
