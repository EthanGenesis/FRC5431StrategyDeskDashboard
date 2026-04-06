import { buildEventTeamRowsFromContext } from './analytics';
import {
  formatMatchLabel,
  realPointerIndex,
  sortMatches,
  tbaTeamKey,
  teamNumberFromKey,
} from './logic';
import { buildImpactBundle } from './tab-bundle-builders';
import type {
  AppSnapshot,
  CompareTeamEventRow,
  DeskOpsDelayDiagnostics,
  DeskOpsImpactSummary,
  DeskOpsKeyMatchWatchRow,
  DeskOpsRivalPressureRow,
  NexusTeamOps,
} from './types';

type SbMatchRecord = Record<string, unknown>;

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSbMatchMap(sbMatches: unknown[]): Map<string, SbMatchRecord> {
  const map = new Map<string, SbMatchRecord>();
  for (const item of Array.isArray(sbMatches) ? sbMatches : []) {
    if (typeof item !== 'object' || item == null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const key =
      typeof record.key === 'string'
        ? record.key
        : typeof record.match === 'string'
          ? record.match
          : null;
    if (key) map.set(key, record);
  }
  return map;
}

function getSbPred(match: SbMatchRecord | null | undefined): SbMatchRecord | null {
  const pred = match?.pred;
  return typeof pred === 'object' && pred != null && !Array.isArray(pred)
    ? (pred as SbMatchRecord)
    : null;
}

function matchWasCompleted(
  match: AppSnapshot['tba']['matches'][number] | null | undefined,
): boolean {
  if (!match) return false;
  const redScore = match.alliances?.red?.score;
  const blueScore = match.alliances?.blue?.score;
  return (
    (typeof redScore === 'number' &&
      redScore >= 0 &&
      typeof blueScore === 'number' &&
      blueScore >= 0) ||
    match.actual_time != null ||
    match.post_result_time != null
  );
}

function describeRivalGap(gapToUs: number | null): string {
  if (gapToUs == null) return 'RP gap unknown.';
  if (Math.abs(gapToUs) < 0.25) return 'Essentially tied on TOTAL RP.';
  if (gapToUs > 0) return `Currently ${gapToUs.toFixed(1)} TOTAL RP ahead of us.`;
  return `Currently ${Math.abs(gapToUs).toFixed(1)} TOTAL RP behind us.`;
}

function buildKeyMatchNarrative(params: {
  rivalTeamKey: string | null;
  redTeams: string[];
  blueTeams: string[];
  redWinProb: number | null;
  ourTotalRp: number | null;
  rivalTotalRp: number | null;
}): string {
  const { rivalTeamKey, redTeams, blueTeams, redWinProb, ourTotalRp, rivalTotalRp } = params;
  if (!rivalTeamKey) return 'Relevant match in our rival band.';
  const rivalOnRed = redTeams.includes(rivalTeamKey);
  const rivalWinProb = redWinProb == null ? null : rivalOnRed ? redWinProb : 1 - redWinProb;
  const gapToUs = ourTotalRp != null && rivalTotalRp != null ? rivalTotalRp - ourTotalRp : null;
  const side = rivalOnRed ? 'red' : 'blue';
  const partnerText = (rivalOnRed ? redTeams : blueTeams).filter(
    (teamKey) => teamKey !== rivalTeamKey,
  );
  const opponentText = rivalOnRed ? blueTeams : redTeams;
  const winText =
    rivalWinProb == null
      ? 'Win odds are still unclear.'
      : `${Math.round(rivalWinProb * 100)}% rival win chance.`;
  return [
    `${rivalTeamKey} is on ${side} with ${partnerText.join(', ') || 'no listed partners'}.`,
    `Opposing alliance: ${opponentText.join(', ') || 'unknown'}.`,
    describeRivalGap(gapToUs),
    winText,
  ].join(' ');
}

export function buildDeskOpsRivalPressureRows(
  eventRows: {
    teamKey: string;
    teamNumber: number;
    nickname: string;
    rank: number | null;
    totalRp: number | null;
    composite: number | null;
    record: string;
  }[],
  teamNumber: number | null,
): DeskOpsRivalPressureRow[] {
  if (teamNumber == null) return [];
  const ourKey = tbaTeamKey(teamNumber);
  const ourRow = eventRows.find((row) => row.teamKey === ourKey) ?? null;
  const ourTotalRp = ourRow?.totalRp ?? null;
  if (ourTotalRp == null) return [];
  return eventRows
    .filter((row) => row.totalRp != null && Math.abs(Number(row.totalRp) - ourTotalRp) <= 6)
    .map((row) => ({
      teamKey: row.teamKey,
      teamNumber: row.teamNumber ?? null,
      nickname: row.nickname ?? '',
      rank: row.rank ?? null,
      totalRp: row.totalRp ?? null,
      gapToUs: row.totalRp != null ? Number(row.totalRp) - ourTotalRp : null,
      composite: row.composite ?? null,
      record: row.record ?? null,
      isLoadedTeam: row.teamKey === ourKey,
    }))
    .sort((left, right) => {
      if (left.isLoadedTeam !== right.isLoadedTeam) return left.isLoadedTeam ? -1 : 1;
      const rankGap = Number(left.rank ?? 9999) - Number(right.rank ?? 9999);
      if (rankGap !== 0) return rankGap;
      return Math.abs(Number(left.gapToUs ?? 999)) - Math.abs(Number(right.gapToUs ?? 999));
    });
}

export function buildDeskOpsKeyMatchWatchRows(params: {
  matches: AppSnapshot['tba']['matches'];
  sbMatches: unknown[];
  rivalPressure: DeskOpsRivalPressureRow[];
  teamNumber: number | null;
}): DeskOpsKeyMatchWatchRow[] {
  if (params.teamNumber == null) return [];
  const rivalTeamsOnly = params.rivalPressure.filter((row) => !row.isLoadedTeam);
  if (!rivalTeamsOnly.length) return [];
  const rivalKeys = new Set(rivalTeamsOnly.map((row) => row.teamKey));
  const rivalMap = new Map(rivalTeamsOnly.map((row) => [row.teamKey, row]));
  const sortedMatches = sortMatches(Array.isArray(params.matches) ? params.matches : []);
  const pointerIndex = realPointerIndex(sortedMatches);
  const sbMatchMap = buildSbMatchMap(params.sbMatches);
  const ourTotalRp = params.rivalPressure.find((row) => row.isLoadedTeam)?.totalRp ?? null;

  return sortedMatches
    .filter((match, index) => index > pointerIndex && !matchWasCompleted(match))
    .map((match) => {
      const teams = [...match.alliances.red.team_keys, ...match.alliances.blue.team_keys];
      const rivalTeamKey = teams.find((teamKey) => rivalKeys.has(teamKey)) ?? null;
      return { match, rivalTeamKey };
    })
    .filter((row) => Boolean(row.rivalTeamKey))
    .slice(0, 8)
    .map(({ match, rivalTeamKey }) => {
      const pred = getSbPred(sbMatchMap.get(match.key));
      const redWinProb = numeric(pred?.red_win_prob);
      const rivalRow = rivalTeamKey ? (rivalMap.get(rivalTeamKey) ?? null) : null;
      return {
        matchKey: match.key,
        matchLabel: formatMatchLabel(match),
        rivalTeamKey,
        rivalTeamNumber: rivalTeamKey ? teamNumberFromKey(rivalTeamKey) : null,
        redTeams: [...match.alliances.red.team_keys],
        blueTeams: [...match.alliances.blue.team_keys],
        redWinProb,
        blueWinProb: redWinProb == null ? null : 1 - redWinProb,
        redScore: numeric(pred?.red_score),
        blueScore: numeric(pred?.blue_score),
        narrative: buildKeyMatchNarrative({
          rivalTeamKey,
          redTeams: match.alliances.red.team_keys,
          blueTeams: match.alliances.blue.team_keys,
          redWinProb,
          ourTotalRp,
          rivalTotalRp: rivalRow?.totalRp ?? null,
        }),
      };
    });
}

export function buildDeskOpsImpactSummary(params: {
  eventRows: CompareTeamEventRow[];
  matches: AppSnapshot['tba']['matches'];
  teamNumber: number | null;
}): DeskOpsImpactSummary | null {
  if (params.teamNumber == null) return null;
  const bundle = buildImpactBundle({
    eventRows: params.eventRows,
    matches: params.matches,
    teamNumber: params.teamNumber,
  });
  if (!bundle.selectedMatchKey || !bundle.scenarios.length) return null;
  const selectedMatch =
    sortMatches(Array.isArray(params.matches) ? params.matches : []).find(
      (match) => match.key === bundle.selectedMatchKey,
    ) ?? null;
  const bestScenario = [...bundle.scenarios].sort((left, right) => {
    const rankGap = Number(left.ourRank ?? 9999) - Number(right.ourRank ?? 9999);
    if (rankGap !== 0) return rankGap;
    return Number(left.rp ?? 99) - Number(right.rp ?? 99);
  })[0];
  const worstScenario = [...bundle.scenarios].sort((left, right) => {
    const rankGap = Number(right.ourRank ?? -1) - Number(left.ourRank ?? -1);
    if (rankGap !== 0) return rankGap;
    return Number(left.rp ?? 99) - Number(right.rp ?? 99);
  })[0];
  const zeroRpScenario = bundle.scenarios.find((scenario) => scenario.rp === 0) ?? null;
  const fourRpScenario = bundle.scenarios.find((scenario) => scenario.rp === 4) ?? null;
  const projectedBand =
    bestScenario?.ourRank != null && worstScenario?.ourRank != null
      ? `#${bestScenario.ourRank} to #${worstScenario.ourRank}`
      : '-';
  const quickCalls = [
    bestScenario?.ourRank != null
      ? `Best case: ${bestScenario.rp} RP in ${selectedMatch ? formatMatchLabel(selectedMatch) : 'the next match'} can move us as high as #${bestScenario.ourRank}.`
      : null,
    worstScenario?.ourRank != null
      ? `Floor case: ${worstScenario.rp} RP leaves us as low as #${worstScenario.ourRank}.`
      : null,
    fourRpScenario?.ourRank != null
      ? `At 4 RP, we project around #${fourRpScenario.ourRank} and can pressure ${fourRpScenario.aboveTeam?.teamKey ?? 'the team above us'}.`
      : null,
    zeroRpScenario?.ourRank != null
      ? `At 0 RP, we are most exposed to ${zeroRpScenario.belowTeam?.teamKey ?? 'the next rival down'}.`
      : null,
  ].filter((value): value is string => Boolean(value));

  return {
    selectedMatchKey: bundle.selectedMatchKey,
    selectedMatchLabel: selectedMatch ? formatMatchLabel(selectedMatch) : null,
    projectedBestRank: bestScenario?.ourRank ?? null,
    projectedBestRankRp: bestScenario?.rp ?? null,
    projectedWorstRank: worstScenario?.ourRank ?? null,
    projectedWorstRankRp: worstScenario?.rp ?? null,
    projectedBand,
    quickCalls,
  };
}

export function buildDeskOpsDelayDiagnostics(params: {
  matches: AppSnapshot['tba']['matches'];
  teamNumber: number | null;
  loadedTeamOps: NexusTeamOps | null | undefined;
  preferredMatchKey?: string | null;
}): DeskOpsDelayDiagnostics | null {
  if (!params.loadedTeamOps || params.teamNumber == null) return null;
  const ourKey = tbaTeamKey(params.teamNumber);
  const sortedMatches = sortMatches(Array.isArray(params.matches) ? params.matches : []);
  const selectedMatch =
    (params.preferredMatchKey
      ? sortedMatches.find((match) => match.key === params.preferredMatchKey)
      : null) ??
    sortedMatches.find(
      (match) =>
        match.comp_level === 'qm' &&
        match.alliances.red.team_keys.concat(match.alliances.blue.team_keys).includes(ourKey) &&
        !matchWasCompleted(match),
    ) ??
    null;
  if (!selectedMatch) return null;
  const officialMatchTimeMs = numeric(selectedMatch.time);
  const predictedMatchTimeMs = numeric(selectedMatch.predicted_time);
  const estimatedStartTimeMs = numeric(params.loadedTeamOps.estimatedStartTimeMs);
  const baselineTime = predictedMatchTimeMs ?? officialMatchTimeMs;
  const fieldLagMinutes =
    baselineTime != null && estimatedStartTimeMs != null
      ? Math.round((estimatedStartTimeMs - baselineTime) / 60000)
      : null;
  const summary =
    fieldLagMinutes == null
      ? 'No field-delay estimate yet.'
      : fieldLagMinutes >= 8
        ? `Field pace is running about ${fieldLagMinutes} minutes behind the published prediction.`
        : fieldLagMinutes >= 3
          ? `Field pace is drifting about ${fieldLagMinutes} minutes behind schedule.`
          : fieldLagMinutes <= -3
            ? `Nexus start estimate is about ${Math.abs(fieldLagMinutes)} minutes ahead of TBA time.`
            : 'Field timing is close to the published prediction.';

  return {
    officialMatchTimeMs,
    predictedMatchTimeMs,
    estimatedQueueTimeMs: numeric(params.loadedTeamOps.estimatedQueueTimeMs),
    estimatedOnDeckTimeMs: numeric(params.loadedTeamOps.estimatedOnDeckTimeMs),
    estimatedOnFieldTimeMs: numeric(params.loadedTeamOps.estimatedOnFieldTimeMs),
    estimatedStartTimeMs,
    fieldLagMinutes,
    summary,
  };
}

export function buildDeskOpsInsights(
  snapshot: AppSnapshot | null | undefined,
  teamNumber: number | null,
): {
  rivalPressure: DeskOpsRivalPressureRow[];
  keyMatchWatchlist: DeskOpsKeyMatchWatchRow[];
  impactSummary: DeskOpsImpactSummary | null;
  delayDiagnostics: DeskOpsDelayDiagnostics | null;
} {
  if (!snapshot || teamNumber == null) {
    return {
      rivalPressure: [],
      keyMatchWatchlist: [],
      impactSummary: null,
      delayDiagnostics: null,
    };
  }
  const eventRows = buildEventTeamRowsFromContext(snapshot);
  const rivalPressure = buildDeskOpsRivalPressureRows(eventRows, teamNumber);
  const impactSummary = buildDeskOpsImpactSummary({
    eventRows,
    matches: snapshot.tba.matches ?? [],
    teamNumber,
  });
  const keyMatchWatchlist = buildDeskOpsKeyMatchWatchRows({
    matches: snapshot.tba.matches ?? [],
    sbMatches: snapshot.sb.matches ?? [],
    rivalPressure,
    teamNumber,
  });
  const delayDiagnostics = buildDeskOpsDelayDiagnostics({
    matches: snapshot.tba.matches ?? [],
    teamNumber,
    loadedTeamOps: snapshot.nexus?.loadedTeamOps ?? null,
    preferredMatchKey: impactSummary?.selectedMatchKey ?? null,
  });
  return {
    rivalPressure,
    keyMatchWatchlist,
    impactSummary,
    delayDiagnostics,
  };
}
