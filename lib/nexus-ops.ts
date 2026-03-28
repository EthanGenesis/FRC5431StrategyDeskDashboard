import type { AllianceColor, NexusMatchStatus, NexusOpsSnapshot, NexusTeamOps } from './types';

function normalizeTeamNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function matchIncludesTeam(match: NexusMatchStatus, teamNumber: number): boolean {
  return match.redTeams.includes(teamNumber) || match.blueTeams.includes(teamNumber);
}

function activeMatchIndex(matches: NexusMatchStatus[]): number {
  const preferred = matches.findIndex((match) =>
    /on field|playing|in progress/i.test(match.status),
  );
  if (preferred >= 0) return preferred;
  const fallback = matches.findIndex((match) => /queue|queued|on deck/i.test(match.status));
  return fallback >= 0 ? fallback : -1;
}

export function inferAllianceColorForTeam(
  match: NexusMatchStatus | null | undefined,
  teamNumber: number | null | undefined,
): AllianceColor | null {
  if (!match || teamNumber == null) return null;
  if (match.redTeams.includes(teamNumber)) return 'red';
  if (match.blueTeams.includes(teamNumber)) return 'blue';
  return null;
}

export function deriveTeamOpsFromNexusSnapshot(
  snapshot: NexusOpsSnapshot | null | undefined,
  teamNumberInput: number | null | undefined,
): NexusTeamOps | null {
  const teamNumber = normalizeTeamNumber(teamNumberInput);
  if (!snapshot || teamNumber == null) return null;

  const mapKey = String(teamNumber);
  const pitAddress = snapshot.pitAddressByTeam?.[mapKey] ?? null;
  const inspectionStatus = snapshot.inspectionByTeam?.[mapKey] ?? null;
  const matches = Array.isArray(snapshot.matches) ? snapshot.matches : [];
  const eventActiveIndex = activeMatchIndex(matches);
  const teamMatchIndex = matches.findIndex((match) => matchIncludesTeam(match, teamNumber));
  const teamMatch = teamMatchIndex >= 0 ? matches[teamMatchIndex] : null;
  const currentMatch = eventActiveIndex >= 0 ? matches[eventActiveIndex] : null;
  const allianceColor = inferAllianceColorForTeam(teamMatch, teamNumber);
  const partsRequestCount = Array.isArray(snapshot.partsRequests)
    ? snapshot.partsRequests.filter((item) => item.teamNumber === teamNumber).length
    : 0;

  if (!pitAddress && !inspectionStatus && !teamMatch && !partsRequestCount) {
    return null;
  }

  return {
    teamNumber,
    pitAddress,
    inspectionStatus,
    currentMatchLabel: currentMatch?.label ?? null,
    nextMatchLabel: teamMatch?.label ?? null,
    queueState: teamMatch ? `${teamMatch.status}: ${teamMatch.label}` : null,
    allianceColor,
    bumperColor: allianceColor ? allianceColor.toUpperCase() : null,
    queueMatchesAway:
      eventActiveIndex >= 0 && teamMatchIndex >= 0
        ? Math.max(0, teamMatchIndex - eventActiveIndex)
        : null,
    partsRequestCount,
    estimatedQueueTimeMs: teamMatch?.times.estimatedQueueTimeMs ?? null,
    estimatedOnDeckTimeMs: teamMatch?.times.estimatedOnDeckTimeMs ?? null,
    estimatedOnFieldTimeMs: teamMatch?.times.estimatedOnFieldTimeMs ?? null,
    estimatedStartTimeMs: teamMatch?.times.estimatedStartTimeMs ?? null,
    actualQueueTimeMs: teamMatch?.times.actualQueueTimeMs ?? null,
    actualOnDeckTimeMs: teamMatch?.times.actualOnDeckTimeMs ?? null,
    actualOnFieldTimeMs: teamMatch?.times.actualOnFieldTimeMs ?? null,
    actualStartTimeMs: teamMatch?.times.actualStartTimeMs ?? null,
  };
}
