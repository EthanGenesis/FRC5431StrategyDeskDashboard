import { buildAllianceCandidateInsights } from './alliance-insights';
import { extractKnownRpFromMatch, extractSbMatchKey } from './analytics';
import { matchHasTeam, safeNumber, sortMatches, tbaTeamKey } from './logic';
import type { CompareTeamEventRow, MatchSimple } from './types';

export const DEFAULT_BUNDLE_SIM_RUNS = 1000;
export const DEFAULT_MONTE_CARLO_SCENARIO_DEPTH = 12;
export const DEFAULT_PLAYOFF_SIM_MODEL = 'composite';

export type PredictOverride = {
  redRp: number | null;
  blueRp: number | null;
};

export type PredictOverrideMap = Record<string, PredictOverride>;

export type ScenarioRow = {
  teamKey: string;
  teamNumber: number | null;
  nickname: string;
  simRank: number | null;
  simTotalRp: number | null;
  realRank: number | null;
  overallEpa: number | null;
  autoEpa?: number | null;
  teleopEpa?: number | null;
  endgameEpa?: number | null;
  opr: number | null;
  composite: number | null;
  totalSos: number | null;
  record: string | null;
  matchesPlayed?: number | null;
};

export type PredictProjectedRow = CompareTeamEventRow & {
  projectedTotalRp: number;
  projectedRank: number;
};

export type PredictDeterministicRow = CompareTeamEventRow & {
  deterministicTotalRp: number;
  deterministicRank: number;
};

export type MonteCarloRow = CompareTeamEventRow & {
  mcAvgRank: number | null;
  mcTop1: number;
  mcTop4: number;
  mcTop8: number;
  mcLikelyBand: string;
  mcAvgTotalRp: number;
};

export type MonteCarloTopScenario = {
  id: string;
  teams: string[];
  count: number;
  probability: number;
};

export type MonteCarloProjection = {
  rows: MonteCarloRow[];
  ourAvgSeed: number | null;
  ourMostLikelySeed: number | null;
  ourTop1: number;
  ourTop4: number;
  ourTop8: number;
  ourLikelyBand: string;
  ourObservedHighest: number | null;
  ourObservedLowest: number | null;
  ourTheoreticalHighest: number | null;
  ourTheoreticalLowest: number | null;
  uniqueScenarioCount: number;
  top16Scenarios: MonteCarloTopScenario[];
};

export type PredictBundlePayload = {
  generatedAtMs: number;
  eventKey: string;
  teamNumber: number | null;
  simRuns: number;
  predictOverrides: PredictOverrideMap;
  projectedRows: PredictProjectedRow[];
  deterministicRows: PredictDeterministicRow[];
  monteCarloProjection: MonteCarloProjection;
  defaultImpactMatchKey: string | null;
  completedQualCount: number;
};

export type AllianceCaptainSlot = {
  seed: number;
  captain: string;
  picks: string[];
};

export type AllianceRuntimeState = {
  sourceRows: ScenarioRow[];
  captainSlots: AllianceCaptainSlot[];
  round: number;
  currentIndex: number;
  direction: number;
  declined: string[];
  chosen: string[];
  complete: boolean;
};

export type AllianceBundlePayload = {
  generatedAtMs: number;
  sourceRows: ScenarioRow[];
  allianceState: AllianceRuntimeState;
  availableRows: ScenarioRow[];
  candidateInsights: ReturnType<typeof buildAllianceCandidateInsights>;
  recommendationRows: {
    label: string;
    key: string;
    row: ReturnType<typeof buildAllianceCandidateInsights>[number] | null;
  }[];
};

export type PlayoffBracketAlliance = {
  seed: number | string;
  teams: string[];
};

export type PlayoffBracketMatch = {
  key: string;
  title: string;
  red: PlayoffBracketAlliance;
  blue: PlayoffBracketAlliance;
};

export type PlayoffBundlePayload = {
  generatedAtMs: number;
  model: string;
  simRuns: number;
  allianceState: AllianceRuntimeState;
  bracket: Record<string, PlayoffBracketMatch>;
  simSummary: {
    champ: number;
    finals: number;
    upperFinal: number;
    bestRound: string;
    furthest: Record<string, number>;
  };
  allAllianceRows: {
    seed: number;
    teams: string[];
    isUs: boolean;
    champ: number;
    finals: number;
    upperFinal: number;
    bestRound: string;
    furthestCounts: Record<string, number>;
    epaStrength: number;
    compositeStrength: number;
  }[];
  manualSummary: {
    bestRound: string;
    champ: boolean;
    finals: boolean;
    upperFinal: boolean;
  };
};

export type ImpactScenarioRow = {
  rp: number;
  ourRank: number;
  total: number;
  rankDelta: number | null;
  totalDelta: number | null;
  top1: boolean;
  top4: boolean;
  top8: boolean;
  aboveTeam: CompareTeamEventRow | null;
  belowTeam: CompareTeamEventRow | null;
};

export type ImpactBundlePayload = {
  generatedAtMs: number;
  selectedMatchKey: string | null;
  scenarios: ImpactScenarioRow[];
};

export type PickListBundlePayload = {
  generatedAtMs: number;
  pickDeskRuntime: AllianceRuntimeState;
  candidateInsights: ReturnType<typeof buildAllianceCandidateInsights>;
  recommendationRows: {
    label: string;
    key: string;
    row: ReturnType<typeof buildAllianceCandidateInsights>[number] | null;
  }[];
};

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function matchIsCompleted(match: MatchSimple | null | undefined): boolean {
  const redScore = match?.alliances?.red?.score;
  const blueScore = match?.alliances?.blue?.score;
  const hasScore =
    typeof redScore === 'number' &&
    typeof blueScore === 'number' &&
    redScore >= 0 &&
    blueScore >= 0;
  return hasScore || match?.actual_time != null || match?.post_result_time != null;
}

function topInsightRows<T extends Record<string, unknown>>(rows: T[], key: string): T[] {
  return [...rows].sort((a, b) => Number(b?.[key] ?? 0) - Number(a?.[key] ?? 0)).slice(0, 3);
}

function mapEventRowToScenarioRow(row: CompareTeamEventRow): ScenarioRow {
  return {
    teamKey: row.teamKey,
    teamNumber: row.teamNumber ?? null,
    nickname: row.nickname ?? '',
    simRank: row.rank ?? null,
    simTotalRp: row.totalRp ?? null,
    realRank: row.rank ?? null,
    overallEpa: row.overallEpa ?? null,
    autoEpa: row.autoEpa ?? null,
    teleopEpa: row.teleopEpa ?? null,
    endgameEpa: row.endgameEpa ?? null,
    opr: row.opr ?? null,
    composite: row.composite ?? null,
    totalSos: row.totalSos ?? null,
    record: row.record ?? null,
    matchesPlayed: row.matchesPlayed ?? null,
  };
}

function buildSbMatchMap(sbMatches: unknown[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const item of Array.isArray(sbMatches) ? sbMatches : []) {
    const key = extractSbMatchKey(
      typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null,
    );
    if (key && typeof item === 'object' && item !== null && !Array.isArray(item)) {
      map.set(key, item as Record<string, unknown>);
    }
  }
  return map;
}

function getSbPred(
  match: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const pred = match?.pred;
  return typeof pred === 'object' && pred !== null ? (pred as Record<string, unknown>) : null;
}

function defaultPredictOverrideMap(matches: MatchSimple[]): PredictOverrideMap {
  const baseMap: PredictOverrideMap = {};
  for (const match of matches.filter((item) => item.comp_level === 'qm')) {
    baseMap[match.key] = {
      redRp: extractKnownRpFromMatch(match, 'red'),
      blueRp: extractKnownRpFromMatch(match, 'blue'),
    };
  }
  return baseMap;
}

function currentTotalsMap(eventRows: CompareTeamEventRow[]): Map<string, number> {
  return new Map(eventRows.map((row) => [row.teamKey, Number(row.totalRp ?? 0)]));
}

function getMatchPredictionProfile(
  match: MatchSimple,
  sbMatchMap: Map<string, Record<string, unknown>>,
) {
  const pred = getSbPred(sbMatchMap.get(match.key));
  const redWinProb =
    pred?.red_win_prob != null && Number.isFinite(Number(pred.red_win_prob))
      ? Number(pred.red_win_prob)
      : 0.5;
  const blueWinProb = 1 - redWinProb;
  return {
    redWinProb,
    blueWinProb,
    redRpAvg:
      pred?.red_rp_1 != null || pred?.red_rp_2 != null
        ? Number(pred?.red_rp_1 ?? 0) + Number(pred?.red_rp_2 ?? 0) + redWinProb * 2
        : 2 * redWinProb,
    blueRpAvg:
      pred?.blue_rp_1 != null || pred?.blue_rp_2 != null
        ? Number(pred?.blue_rp_1 ?? 0) + Number(pred?.blue_rp_2 ?? 0) + blueWinProb * 2
        : 2 * blueWinProb,
  };
}

function emptyMonteCarloProjection(eventRows: CompareTeamEventRow[]): MonteCarloProjection {
  return {
    rows: eventRows.map((row) => ({
      ...row,
      mcAvgRank: row.rank ?? null,
      mcTop1: 0,
      mcTop4: 0,
      mcTop8: 0,
      mcLikelyBand: '-',
      mcAvgTotalRp: row.totalRp ?? 0,
    })),
    ourAvgSeed: null,
    ourMostLikelySeed: null,
    ourTop1: 0,
    ourTop4: 0,
    ourTop8: 0,
    ourLikelyBand: '-',
    ourObservedHighest: null,
    ourObservedLowest: null,
    ourTheoreticalHighest: 1,
    ourTheoreticalLowest: eventRows.length || null,
    uniqueScenarioCount: 0,
    top16Scenarios: [],
  };
}

export function buildPredictBaselineBundle(params: {
  eventKey: string;
  teamNumber: number | null;
  eventRows: CompareTeamEventRow[];
  matches: MatchSimple[];
  sbMatches: unknown[];
  simRuns?: number;
  monteCarloDepth?: number;
}): PredictBundlePayload {
  const sortedMatches = sortMatches(Array.isArray(params.matches) ? params.matches : []);
  const eventRows = Array.isArray(params.eventRows) ? params.eventRows : [];
  const overrides = defaultPredictOverrideMap(sortedMatches);
  const totalsMap = currentTotalsMap(eventRows);
  const sbMatchMap = buildSbMatchMap(Array.isArray(params.sbMatches) ? params.sbMatches : []);

  const projectedRows = eventRows
    .map((row) => ({
      ...row,
      projectedTotalRp: totalsMap.get(row.teamKey) ?? Number(row.totalRp ?? 0),
      projectedRank: 0,
    }))
    .sort((a, b) => safeNumber(b.projectedTotalRp, -999) - safeNumber(a.projectedTotalRp, -999))
    .map((row, index) => ({ ...row, projectedRank: index + 1 }));

  const deterministicTotals = new Map(totalsMap);
  for (const match of sortedMatches.filter((item) => item.comp_level === 'qm')) {
    if (matchIsCompleted(match)) continue;
    const prediction = getMatchPredictionProfile(match, sbMatchMap);
    for (const teamKey of match.alliances.red.team_keys) {
      deterministicTotals.set(
        teamKey,
        (deterministicTotals.get(teamKey) ?? 0) + prediction.redRpAvg,
      );
    }
    for (const teamKey of match.alliances.blue.team_keys) {
      deterministicTotals.set(
        teamKey,
        (deterministicTotals.get(teamKey) ?? 0) + prediction.blueRpAvg,
      );
    }
  }

  const deterministicRows = eventRows
    .map((row) => ({
      ...row,
      deterministicTotalRp: deterministicTotals.get(row.teamKey) ?? Number(row.totalRp ?? 0),
      deterministicRank: 0,
    }))
    .sort(
      (a, b) => safeNumber(b.deterministicTotalRp, -999) - safeNumber(a.deterministicTotalRp, -999),
    )
    .map((row, index) => ({ ...row, deterministicRank: index + 1 }));

  const simRuns = Math.max(1, Math.floor(Number(params.simRuns ?? DEFAULT_BUNDLE_SIM_RUNS) || 1));
  const monteCarloDepth = Math.max(
    1,
    Math.floor(Number(params.monteCarloDepth ?? DEFAULT_MONTE_CARLO_SCENARIO_DEPTH) || 1),
  );
  const ourKey = params.teamNumber != null ? tbaTeamKey(params.teamNumber) : '';
  const futureQuals = sortedMatches.filter(
    (item) => item.comp_level === 'qm' && !matchIsCompleted(item),
  );

  const baseProjection = emptyMonteCarloProjection(eventRows);
  const monteCarloProjection =
    !eventRows.length || !futureQuals.length
      ? baseProjection
      : (() => {
          const rankCounts = new Map<string, number[]>();
          const avgTotals = new Map<string, number>();
          eventRows.forEach((row) => {
            rankCounts.set(row.teamKey, []);
            avgTotals.set(row.teamKey, 0);
          });
          const ourSeeds: number[] = [];
          const topSeedCounts = new Map<string, number>();

          for (let run = 0; run < simRuns; run += 1) {
            const totals = new Map(deterministicTotals);
            for (const match of futureQuals) {
              const pred = getSbPred(sbMatchMap.get(match.key));
              const redWin = pred?.red_win_prob != null ? Number(pred.red_win_prob) : 0.5;
              const redWon = Math.random() < redWin;
              const redExtra1 = Math.random() < Number(pred?.red_rp_1 ?? 0);
              const redExtra2 = Math.random() < Number(pred?.red_rp_2 ?? 0);
              const blueExtra1 = Math.random() < Number(pred?.blue_rp_1 ?? 0);
              const blueExtra2 = Math.random() < Number(pred?.blue_rp_2 ?? 0);
              const redRp = (redWon ? 2 : 0) + (redExtra1 ? 1 : 0) + (redExtra2 ? 1 : 0);
              const blueRp = (!redWon ? 2 : 0) + (blueExtra1 ? 1 : 0) + (blueExtra2 ? 1 : 0);
              for (const teamKey of match.alliances.red.team_keys) {
                totals.set(teamKey, (totals.get(teamKey) ?? 0) + redRp);
              }
              for (const teamKey of match.alliances.blue.team_keys) {
                totals.set(teamKey, (totals.get(teamKey) ?? 0) + blueRp);
              }
            }

            const ranked = eventRows
              .map((row) => ({
                teamKey: row.teamKey,
                total: totals.get(row.teamKey) ?? 0,
              }))
              .sort((a, b) => b.total - a.total);

            ranked.forEach((row, index) => {
              rankCounts.get(row.teamKey)?.push(index + 1);
              avgTotals.set(row.teamKey, (avgTotals.get(row.teamKey) ?? 0) + row.total);
              if (row.teamKey === ourKey) ourSeeds.push(index + 1);
            });

            const topSeedKey = ranked
              .slice(0, Math.min(monteCarloDepth, ranked.length))
              .map((row) => row.teamKey)
              .join(',');
            topSeedCounts.set(topSeedKey, (topSeedCounts.get(topSeedKey) ?? 0) + 1);
          }

          const rows = eventRows
            .map((row) => {
              const ranks = rankCounts.get(row.teamKey) ?? [];
              const sortedRanks = [...ranks].sort((a, b) => a - b);
              const p10 = sortedRanks.length
                ? sortedRanks[Math.floor(0.1 * (sortedRanks.length - 1))]
                : null;
              const p90 = sortedRanks.length
                ? sortedRanks[Math.floor(0.9 * (sortedRanks.length - 1))]
                : null;
              return {
                ...row,
                mcAvgRank: ranks.length ? mean(ranks) : null,
                mcTop1: ranks.filter((value) => value === 1).length / Math.max(1, ranks.length),
                mcTop4: ranks.filter((value) => value <= 4).length / Math.max(1, ranks.length),
                mcTop8: ranks.filter((value) => value <= 8).length / Math.max(1, ranks.length),
                mcLikelyBand: p10 != null && p90 != null ? `${p10}-${p90}` : '-',
                mcAvgTotalRp: (avgTotals.get(row.teamKey) ?? 0) / Math.max(1, simRuns),
              };
            })
            .sort((a, b) => safeNumber(a.mcAvgRank, 999) - safeNumber(b.mcAvgRank, 999));

          const ourSorted = [...ourSeeds].sort((a, b) => a - b);
          const ourCounts = new Map<number, number>();
          ourSeeds.forEach((seed) => ourCounts.set(seed, (ourCounts.get(seed) ?? 0) + 1));
          const ourMostLikelySeed =
            [...ourCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;

          return {
            rows,
            ourAvgSeed: ourSeeds.length ? mean(ourSeeds) : null,
            ourMostLikelySeed,
            ourTop1: ourSeeds.filter((value) => value === 1).length / Math.max(1, ourSeeds.length),
            ourTop4: ourSeeds.filter((value) => value <= 4).length / Math.max(1, ourSeeds.length),
            ourTop8: ourSeeds.filter((value) => value <= 8).length / Math.max(1, ourSeeds.length),
            ourLikelyBand: ourSorted.length
              ? `${ourSorted[Math.floor(0.1 * (ourSorted.length - 1))]}-${ourSorted[Math.floor(0.9 * (ourSorted.length - 1))]}`
              : '-',
            ourObservedHighest: ourSorted[0] ?? null,
            ourObservedLowest: ourSorted[ourSorted.length - 1] ?? null,
            ourTheoreticalHighest: 1,
            ourTheoreticalLowest: eventRows.length || null,
            uniqueScenarioCount: topSeedCounts.size,
            top16Scenarios: Array.from(topSeedCounts.entries())
              .map(([key, count]) => ({
                id: `mc_${key}`,
                teams: key.split(',').filter(Boolean),
                count,
                probability: count / Math.max(1, simRuns),
              }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 25),
          };
        })();

  const defaultImpactMatchKey =
    params.teamNumber != null
      ? (sortedMatches.find(
          (match) =>
            match.comp_level === 'qm' && matchHasTeam(match, ourKey) && !matchIsCompleted(match),
        )?.key ?? null)
      : null;

  return {
    generatedAtMs: Date.now(),
    eventKey: params.eventKey,
    teamNumber: params.teamNumber,
    simRuns,
    predictOverrides: overrides,
    projectedRows,
    deterministicRows,
    monteCarloProjection,
    defaultImpactMatchKey,
    completedQualCount: sortedMatches.filter(
      (item) => item.comp_level === 'qm' && matchIsCompleted(item),
    ).length,
  };
}

export function freshAllianceStateFromSource(sourceRows: ScenarioRow[]): AllianceRuntimeState {
  const captains = sourceRows.slice(0, 8).map((row) => row.teamKey);
  return {
    sourceRows,
    captainSlots: captains.map((teamKey, index) => ({
      seed: index + 1,
      captain: teamKey,
      picks: [],
    })),
    round: 1,
    currentIndex: 0,
    direction: 1,
    declined: [],
    chosen: [],
    complete: false,
  };
}

export function reseedCaptainSlots(slots: AllianceCaptainSlot[]): AllianceCaptainSlot[] {
  return slots.map((slot, index) => ({ ...slot, seed: index + 1 }));
}

export function advanceAllianceTurn(state: AllianceRuntimeState): AllianceRuntimeState {
  if (state.complete) return state;
  let currentIndex = state.currentIndex;
  let round = state.round;
  const length = state.captainSlots.length;
  if (round === 1) {
    if (currentIndex >= length - 1) {
      round = 2;
      currentIndex = length - 1;
    } else {
      currentIndex += 1;
    }
    return { ...state, currentIndex, round };
  }
  if (currentIndex <= 0) {
    return { ...state, currentIndex: 0, round: 2, complete: true };
  }
  return { ...state, currentIndex: currentIndex - 1, round: 2 };
}

function buildAllianceAvailableRows(
  runtime: AllianceRuntimeState,
  sortMode = 'composite',
): ScenarioRow[] {
  const sourceRows = runtime.sourceRows ?? [];
  const declined = new Set(runtime.declined ?? []);
  const captainSlots = runtime.captainSlots ?? [];
  const currentCaptain = captainSlots[runtime.currentIndex]?.captain ?? null;
  const currentIndex = runtime.currentIndex ?? 0;
  const pickedTeams = new Set(captainSlots.flatMap((slot) => slot.picks ?? []));
  const captainIndexMap = new Map(captainSlots.map((slot, index) => [slot.captain, index]));
  const rows = sourceRows.filter((row) => {
    const teamKey = row.teamKey;
    if (!teamKey) return false;
    if (declined.has(teamKey)) return false;
    if (teamKey === currentCaptain) return false;
    if (pickedTeams.has(teamKey)) return false;
    const captainIndex = captainIndexMap.get(teamKey);
    if (captainIndex != null) {
      if ((runtime.round ?? 1) !== 1) return false;
      return captainIndex > currentIndex && (captainSlots[captainIndex]?.picks?.length ?? 0) === 0;
    }
    return true;
  });
  const sorter =
    {
      composite: (row: ScenarioRow) => -Number(row.composite ?? -999),
      epa: (row: ScenarioRow) => -Number(row.overallEpa ?? -999),
      rank: (row: ScenarioRow) => Number(row.realRank ?? row.simRank ?? 9999),
      opr: (row: ScenarioRow) => -Number(row.opr ?? -999),
    }[sortMode] ?? ((row: ScenarioRow) => -Number(row.composite ?? -999));
  return [...rows].sort((a, b) => sorter(a) - sorter(b));
}

function buildAllianceRecommendationRows(
  candidateInsights: ReturnType<typeof buildAllianceCandidateInsights>,
) {
  return [
    {
      label: 'Build Us',
      key: 'pickValueScore',
      row: topInsightRows(candidateInsights, 'pickValueScore')[0] ?? null,
    },
    {
      label: 'Best Fit',
      key: 'chemistryScore',
      row: topInsightRows(candidateInsights, 'chemistryScore')[0] ?? null,
    },
    {
      label: 'Deny Rival',
      key: 'denialValueScore',
      row: topInsightRows(candidateInsights, 'denialValueScore')[0] ?? null,
    },
    {
      label: 'Playoff Ready',
      key: 'playoffReadyScore',
      row: topInsightRows(candidateInsights, 'playoffReadyScore')[0] ?? null,
    },
    {
      label: 'Highest Ceiling',
      key: 'ceilingScore',
      row: topInsightRows(candidateInsights, 'ceilingScore')[0] ?? null,
    },
  ];
}

export function buildAllianceBundle(eventRows: CompareTeamEventRow[]): AllianceBundlePayload {
  const sourceRows = [...eventRows]
    .sort((a, b) => Number(a.rank ?? 9999) - Number(b.rank ?? 9999))
    .map((row) => mapEventRowToScenarioRow(row));
  const eventRowMap = new Map(sourceRows.map((row) => [row.teamKey, row]));
  const allianceState = freshAllianceStateFromSource(sourceRows);
  const availableRows = buildAllianceAvailableRows(allianceState);
  const currentCaptainKey = allianceState.captainSlots[allianceState.currentIndex]?.captain ?? null;
  const candidateInsights = buildAllianceCandidateInsights({
    availableRows,
    captainSlots: allianceState.captainSlots,
    currentCaptainKey,
    eventRowMap,
  });
  return {
    generatedAtMs: Date.now(),
    sourceRows,
    allianceState,
    availableRows,
    candidateInsights,
    recommendationRows: buildAllianceRecommendationRows(candidateInsights),
  };
}

function strengthForAllianceTeams(
  teams: string[],
  model: string,
  eventRowMap: Map<string, CompareTeamEventRow>,
): number {
  const values = teams
    .map((teamKey) => {
      const row = eventRowMap.get(teamKey);
      return Number(
        model === 'epa'
          ? (row?.overallEpa ?? row?.opr ?? 0)
          : (row?.composite ?? row?.overallEpa ?? 0),
      );
    })
    .filter((value) => Number.isFinite(value));
  return values.length ? mean(values) : 0;
}

export function buildPlayoffLabBracket(
  alliances: PlayoffBracketAlliance[],
  winners: Record<string, 'red' | 'blue'>,
): Record<string, PlayoffBracketMatch> {
  const getAlliance = (seed: number): PlayoffBracketAlliance =>
    alliances.find((row) => row.seed === seed) ?? { seed, teams: [] };
  const createMatch = (
    key: string,
    title: string,
    red: PlayoffBracketAlliance,
    blue: PlayoffBracketAlliance,
  ): PlayoffBracketMatch => ({ key, title, red, blue });
  const pickWinnerAlliance = (match: PlayoffBracketMatch): PlayoffBracketAlliance | null => {
    const winner = winners[match.key];
    if (winner === 'red') return match.red;
    if (winner === 'blue') return match.blue;
    return null;
  };
  const pickLoserAlliance = (match: PlayoffBracketMatch): PlayoffBracketAlliance | null => {
    const winner = winners[match.key];
    if (winner === 'red') return match.blue;
    if (winner === 'blue') return match.red;
    return null;
  };

  const U1 = createMatch('U1', 'Upper 1', getAlliance(1), getAlliance(8));
  const U2 = createMatch('U2', 'Upper 2', getAlliance(4), getAlliance(5));
  const U3 = createMatch('U3', 'Upper 3', getAlliance(2), getAlliance(7));
  const U4 = createMatch('U4', 'Upper 4', getAlliance(3), getAlliance(6));
  const L1 = createMatch(
    'L1',
    'Lower 1',
    pickLoserAlliance(U1) ?? { seed: 'TBD', teams: [] },
    pickLoserAlliance(U2) ?? { seed: 'TBD', teams: [] },
  );
  const L2 = createMatch(
    'L2',
    'Lower 2',
    pickLoserAlliance(U3) ?? { seed: 'TBD', teams: [] },
    pickLoserAlliance(U4) ?? { seed: 'TBD', teams: [] },
  );
  const U5 = createMatch(
    'U5',
    'Upper 5',
    pickWinnerAlliance(U1) ?? { seed: 'TBD', teams: [] },
    pickWinnerAlliance(U2) ?? { seed: 'TBD', teams: [] },
  );
  const U6 = createMatch(
    'U6',
    'Upper 6',
    pickWinnerAlliance(U3) ?? { seed: 'TBD', teams: [] },
    pickWinnerAlliance(U4) ?? { seed: 'TBD', teams: [] },
  );
  const L3 = createMatch(
    'L3',
    'Lower 3',
    pickLoserAlliance(U5) ?? { seed: 'TBD', teams: [] },
    winners.L1
      ? (pickWinnerAlliance(L1) ?? { seed: 'TBD', teams: [] })
      : { seed: 'TBD', teams: [] },
  );
  const L4 = createMatch(
    'L4',
    'Lower 4',
    pickLoserAlliance(U6) ?? { seed: 'TBD', teams: [] },
    winners.L2
      ? (pickWinnerAlliance(L2) ?? { seed: 'TBD', teams: [] })
      : { seed: 'TBD', teams: [] },
  );
  const U7 = createMatch(
    'U7',
    'Upper Final',
    winners.U5
      ? (pickWinnerAlliance(U5) ?? { seed: 'TBD', teams: [] })
      : { seed: 'TBD', teams: [] },
    winners.U6
      ? (pickWinnerAlliance(U6) ?? { seed: 'TBD', teams: [] })
      : { seed: 'TBD', teams: [] },
  );
  const L5 = createMatch(
    'L5',
    'Lower 5',
    winners.L3
      ? (pickWinnerAlliance(L3) ?? { seed: 'TBD', teams: [] })
      : { seed: 'TBD', teams: [] },
    winners.L4
      ? (pickWinnerAlliance(L4) ?? { seed: 'TBD', teams: [] })
      : { seed: 'TBD', teams: [] },
  );
  const L6 = createMatch(
    'L6',
    'Lower Final',
    pickLoserAlliance(U7) ?? { seed: 'TBD', teams: [] },
    winners.L5
      ? (pickWinnerAlliance(L5) ?? { seed: 'TBD', teams: [] })
      : { seed: 'TBD', teams: [] },
  );
  const F1 = createMatch(
    'F1',
    'Final',
    winners.U7
      ? (pickWinnerAlliance(U7) ?? { seed: 'TBD', teams: [] })
      : { seed: 'TBD', teams: [] },
    winners.L6
      ? (pickWinnerAlliance(L6) ?? { seed: 'TBD', teams: [] })
      : { seed: 'TBD', teams: [] },
  );
  return { U1, U2, U3, U4, L1, L2, U5, U6, L3, L4, U7, L5, L6, F1 };
}

export function playoffWinProb(
  match: PlayoffBracketMatch,
  model: string,
  eventRowMap: Map<string, CompareTeamEventRow>,
): number {
  const redStrength = strengthForAllianceTeams(match.red?.teams ?? [], model, eventRowMap);
  const blueStrength = strengthForAllianceTeams(match.blue?.teams ?? [], model, eventRowMap);
  if (redStrength + blueStrength <= 0) return 0.5;
  const logistic = 1 / (1 + Math.exp(-(redStrength - blueStrength) / 8));
  return Math.min(0.97, Math.max(0.03, logistic));
}

function playoffStageLabel(key: string): string {
  return (
    {
      U1: 'Upper R1',
      U2: 'Upper R1',
      U3: 'Upper R1',
      U4: 'Upper R1',
      L1: 'Lower R1',
      L2: 'Lower R1',
      U5: 'Upper SF',
      U6: 'Upper SF',
      L3: 'Lower SF',
      L4: 'Lower SF',
      U7: 'Upper Final',
      L5: 'Lower Bracket',
      L6: 'Lower Final',
      F1: 'Final',
    }[key] ?? key
  );
}

function playoffStageIndex(key: string): number {
  return (
    {
      U1: 1,
      U2: 1,
      U3: 1,
      U4: 1,
      L1: 2,
      L2: 2,
      U5: 3,
      U6: 3,
      L3: 4,
      L4: 4,
      U7: 5,
      L5: 6,
      L6: 7,
      F1: 8,
    }[key] ?? 0
  );
}

const PLAYOFF_MATCH_KEYS = [
  'U1',
  'U2',
  'U3',
  'U4',
  'L1',
  'L2',
  'U5',
  'U6',
  'L3',
  'L4',
  'U7',
  'L5',
  'L6',
  'F1',
];

export function simulatePlayoffScenario(params: {
  allianceState: AllianceRuntimeState;
  teamNumber: number | null;
  runs: number;
  model: string;
  eventRowMap: Map<string, CompareTeamEventRow>;
}) {
  const alliances = (params.allianceState?.captainSlots ?? []).map((slot) => ({
    seed: slot.seed,
    teams: [slot.captain, ...slot.picks],
  }));
  const ourKey = params.teamNumber != null ? tbaTeamKey(params.teamNumber) : '';
  const ourAlliance = alliances.find((row) => row.teams.includes(ourKey));
  let champ = 0;
  let finals = 0;
  let upperFinal = 0;
  const furthest: Record<string, number> = {
    'Upper R1': 0,
    'Lower R1': 0,
    'Upper SF': 0,
    'Lower SF': 0,
    'Upper Final': 0,
    'Lower Final': 0,
    Final: 0,
    Champion: 0,
  };

  for (let index = 0; index < Math.max(1, params.runs); index += 1) {
    const winners: Record<string, 'red' | 'blue'> = {};
    let lastRound = 'Upper R1';
    for (const key of PLAYOFF_MATCH_KEYS) {
      const match = buildPlayoffLabBracket(alliances, winners)[key];
      if (!match?.red?.teams?.length || !match?.blue?.teams?.length) continue;
      const redProb = playoffWinProb(match, params.model, params.eventRowMap);
      winners[key] = Math.random() < redProb ? 'red' : 'blue';
      if (
        ourAlliance &&
        (match.red.seed === ourAlliance.seed || match.blue.seed === ourAlliance.seed)
      ) {
        lastRound =
          {
            U1: 'Upper R1',
            U2: 'Upper R1',
            U3: 'Upper R1',
            U4: 'Upper R1',
            L1: 'Lower R1',
            L2: 'Lower R1',
            U5: 'Upper SF',
            U6: 'Upper SF',
            L3: 'Lower SF',
            L4: 'Lower SF',
            U7: 'Upper Final',
            L5: 'Lower Final',
            L6: 'Final',
            F1: 'Champion',
          }[key] ?? key;
      }
    }
    if (ourAlliance) {
      const bracket = buildPlayoffLabBracket(alliances, winners);
      const final = bracket.F1 ?? {
        key: 'F1',
        title: 'Final',
        red: { seed: 'TBD', teams: [] },
        blue: { seed: 'TBD', teams: [] },
      };
      const upper = bracket.U7 ?? {
        key: 'U7',
        title: 'Upper Final',
        red: { seed: 'TBD', teams: [] },
        blue: { seed: 'TBD', teams: [] },
      };
      const finalWinner = winners.F1;
      const inFinal = final.red.seed === ourAlliance.seed || final.blue.seed === ourAlliance.seed;
      if (inFinal) finals += 1;
      if (
        inFinal &&
        ((finalWinner === 'red' && final.red.seed === ourAlliance.seed) ||
          (finalWinner === 'blue' && final.blue.seed === ourAlliance.seed))
      ) {
        champ += 1;
      }
      if (upper.red.seed === ourAlliance.seed || upper.blue.seed === ourAlliance.seed) {
        upperFinal += 1;
      }
    }
    furthest[lastRound] = (furthest[lastRound] ?? 0) + 1;
  }

  const bestRound = Object.entries(furthest).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';
  return {
    champ: champ / Math.max(1, params.runs),
    finals: finals / Math.max(1, params.runs),
    upperFinal: upperFinal / Math.max(1, params.runs),
    bestRound,
    furthest,
  };
}

export function summarizeManualPlayoffOutcome(params: {
  allianceState: AllianceRuntimeState;
  teamNumber: number | null;
  winners: Record<string, 'red' | 'blue'>;
}) {
  const alliances = (params.allianceState?.captainSlots ?? []).map((slot) => ({
    seed: slot.seed,
    teams: [slot.captain, ...slot.picks],
  }));
  const ourKey = params.teamNumber != null ? tbaTeamKey(params.teamNumber) : '';
  const ourAlliance = alliances.find((row) => row.teams.includes(ourKey));
  if (!ourAlliance) {
    return { bestRound: '-', champ: false, finals: false, upperFinal: false };
  }
  let bestIndex = 0;
  let bestRound = 'Not Qualified';
  for (const key of PLAYOFF_MATCH_KEYS) {
    const bracket = buildPlayoffLabBracket(alliances, params.winners);
    const match = bracket[key];
    if (!match?.red?.teams?.length || !match?.blue?.teams?.length) continue;
    if (match.red.seed === ourAlliance.seed || match.blue.seed === ourAlliance.seed) {
      const index = playoffStageIndex(key);
      if (index > bestIndex) {
        bestIndex = index;
        bestRound = playoffStageLabel(key);
      }
    }
  }
  const bracket = buildPlayoffLabBracket(alliances, params.winners);
  const final = bracket.F1 ?? {
    key: 'F1',
    title: 'Final',
    red: { seed: 'TBD', teams: [] },
    blue: { seed: 'TBD', teams: [] },
  };
  const upper = bracket.U7 ?? {
    key: 'U7',
    title: 'Upper Final',
    red: { seed: 'TBD', teams: [] },
    blue: { seed: 'TBD', teams: [] },
  };
  const finals = final.red.seed === ourAlliance.seed || final.blue.seed === ourAlliance.seed;
  const upperFinal = upper.red.seed === ourAlliance.seed || upper.blue.seed === ourAlliance.seed;
  const finalWinner = params.winners.F1;
  const champ =
    finals &&
    ((finalWinner === 'red' && final.red.seed === ourAlliance.seed) ||
      (finalWinner === 'blue' && final.blue.seed === ourAlliance.seed));
  return {
    bestRound: champ ? 'Champion' : finals ? 'Final' : bestRound,
    champ,
    finals,
    upperFinal,
  };
}

export function simulatePlayoffAlliancesSummary(params: {
  allianceState: AllianceRuntimeState;
  teamNumber: number | null;
  runs: number;
  model: string;
  eventRowMap: Map<string, CompareTeamEventRow>;
}) {
  const alliances = (params.allianceState?.captainSlots ?? []).map((slot) => ({
    seed: slot.seed,
    teams: [slot.captain, ...slot.picks],
  }));
  const ourKey = params.teamNumber != null ? tbaTeamKey(params.teamNumber) : '';
  const initialRows = alliances.map((alliance) => ({
    seed: alliance.seed,
    teams: alliance.teams,
    isUs: alliance.teams.includes(ourKey),
    champ: 0,
    finals: 0,
    upperFinal: 0,
    furthestCounts: {
      'Upper R1': 0,
      'Lower R1': 0,
      'Upper SF': 0,
      'Lower SF': 0,
      'Upper Final': 0,
      'Lower Bracket': 0,
      'Lower Final': 0,
      Final: 0,
      Champion: 0,
    } as Record<string, number>,
    epaStrength: strengthForAllianceTeams(alliance.teams, 'epa', params.eventRowMap),
    compositeStrength: strengthForAllianceTeams(alliance.teams, 'composite', params.eventRowMap),
  }));
  const seedMap = new Map(initialRows.map((row) => [row.seed, row]));
  const labelRank = [
    'Upper R1',
    'Lower R1',
    'Upper SF',
    'Lower SF',
    'Upper Final',
    'Lower Bracket',
    'Lower Final',
    'Final',
    'Champion',
  ];

  for (let index = 0; index < Math.max(1, params.runs); index += 1) {
    const winners: Record<string, 'red' | 'blue'> = {};
    const bestIndexBySeed = new Map<number, number>();

    for (const key of PLAYOFF_MATCH_KEYS) {
      const bracket = buildPlayoffLabBracket(alliances, winners);
      const match = bracket[key];
      if (!match?.red?.teams?.length || !match?.blue?.teams?.length) continue;
      for (const side of [match.red, match.blue]) {
        if (typeof side?.seed === 'number') {
          bestIndexBySeed.set(
            side.seed,
            Math.max(bestIndexBySeed.get(side.seed) ?? 0, playoffStageIndex(key)),
          );
        }
      }
      const redProb = playoffWinProb(match, params.model, params.eventRowMap);
      winners[key] = Math.random() < redProb ? 'red' : 'blue';
    }

    const bracket = buildPlayoffLabBracket(alliances, winners);
    const final = bracket.F1 ?? {
      key: 'F1',
      title: 'Final',
      red: { seed: 'TBD', teams: [] },
      blue: { seed: 'TBD', teams: [] },
    };
    const upper = bracket.U7 ?? {
      key: 'U7',
      title: 'Upper Final',
      red: { seed: 'TBD', teams: [] },
      blue: { seed: 'TBD', teams: [] },
    };
    if (typeof upper.red.seed === 'number' && seedMap.has(upper.red.seed)) {
      seedMap.get(upper.red.seed)!.upperFinal += 1;
    }
    if (typeof upper.blue.seed === 'number' && seedMap.has(upper.blue.seed)) {
      seedMap.get(upper.blue.seed)!.upperFinal += 1;
    }
    if (typeof final.red.seed === 'number' && seedMap.has(final.red.seed)) {
      seedMap.get(final.red.seed)!.finals += 1;
    }
    if (typeof final.blue.seed === 'number' && seedMap.has(final.blue.seed)) {
      seedMap.get(final.blue.seed)!.finals += 1;
    }
    const finalWinner = winners.F1;
    const champSeed =
      finalWinner === 'red' ? final.red.seed : finalWinner === 'blue' ? final.blue.seed : null;
    if (typeof champSeed === 'number' && seedMap.has(champSeed)) {
      seedMap.get(champSeed)!.champ += 1;
    }

    initialRows.forEach((row) => {
      let label = 'Upper R1';
      const bestIndex = bestIndexBySeed.get(row.seed) ?? 0;
      if (champSeed === row.seed) label = 'Champion';
      else if (final.red.seed === row.seed || final.blue.seed === row.seed) label = 'Final';
      else if (bestIndex > 0) {
        label = playoffStageLabel(
          PLAYOFF_MATCH_KEYS.find((key) => playoffStageIndex(key) === bestIndex) ?? 'U1',
        );
      }
      row.furthestCounts[label] = (row.furthestCounts[label] ?? 0) + 1;
    });
  }

  return initialRows
    .map((row) => ({
      ...row,
      champ: row.champ / Math.max(1, params.runs),
      finals: row.finals / Math.max(1, params.runs),
      upperFinal: row.upperFinal / Math.max(1, params.runs),
      bestRound:
        Object.entries(row.furthestCounts).sort(
          (a, b) =>
            b[1] - a[1] || labelRank.indexOf(String(b[0])) - labelRank.indexOf(String(a[0])),
        )[0]?.[0] ?? '-',
    }))
    .sort((a, b) => Number(a.seed) - Number(b.seed));
}

export function buildPlayoffBundle(params: {
  eventRows: CompareTeamEventRow[];
  allianceState?: AllianceRuntimeState | null;
  teamNumber: number | null;
  model?: string;
  simRuns?: number;
}): PlayoffBundlePayload {
  const eventRowMap = new Map(params.eventRows.map((row) => [row.teamKey, row]));
  const allianceState = params.allianceState?.captainSlots?.length
    ? params.allianceState
    : buildAllianceBundle(params.eventRows).allianceState;
  const alliances = (allianceState.captainSlots ?? []).map((slot) => ({
    seed: slot.seed,
    teams: [slot.captain, ...slot.picks],
  }));
  const model = params.model ?? DEFAULT_PLAYOFF_SIM_MODEL;
  const simRuns = Math.max(1, Math.floor(Number(params.simRuns ?? DEFAULT_BUNDLE_SIM_RUNS) || 1));
  return {
    generatedAtMs: Date.now(),
    model,
    simRuns,
    allianceState,
    bracket: buildPlayoffLabBracket(alliances, {}),
    simSummary: simulatePlayoffScenario({
      allianceState,
      teamNumber: params.teamNumber,
      runs: simRuns,
      model,
      eventRowMap,
    }),
    allAllianceRows: simulatePlayoffAlliancesSummary({
      allianceState,
      teamNumber: params.teamNumber,
      runs: simRuns,
      model,
      eventRowMap,
    }),
    manualSummary: summarizeManualPlayoffOutcome({
      allianceState,
      teamNumber: params.teamNumber,
      winners: {},
    }),
  };
}

export function buildImpactBundle(params: {
  eventRows: CompareTeamEventRow[];
  matches: MatchSimple[];
  teamNumber: number | null;
}): ImpactBundlePayload {
  const ourKey = params.teamNumber != null ? tbaTeamKey(params.teamNumber) : '';
  const sortedMatches = sortMatches(Array.isArray(params.matches) ? params.matches : []);
  const selectedMatch =
    sortedMatches.find(
      (match) =>
        match.comp_level === 'qm' && matchHasTeam(match, ourKey) && !matchIsCompleted(match),
    ) ??
    sortedMatches.find((match) => match.comp_level === 'qm' && matchHasTeam(match, ourKey)) ??
    null;
  if (!selectedMatch || !ourKey) {
    return {
      generatedAtMs: Date.now(),
      selectedMatchKey: null,
      scenarios: [],
    };
  }

  const totalsMap = currentTotalsMap(params.eventRows);
  const baseMap = defaultPredictOverrideMap(sortedMatches);
  const eventRowMap = new Map(params.eventRows.map((row) => [row.teamKey, row]));
  const currentRow = eventRowMap.get(ourKey) ?? null;
  const currentRank = currentRow?.rank ?? null;
  const currentTotal = currentRow?.totalRp ?? null;
  const isRed = selectedMatch.alliances.red.team_keys.includes(ourKey);

  const scenarios: ImpactScenarioRow[] = [];
  for (let rp = 0; rp <= 6; rp += 1) {
    const local: PredictOverrideMap = {
      [selectedMatch.key]: {
        redRp: isRed ? rp : 0,
        blueRp: isRed ? 0 : rp,
      },
    };
    const totals = new Map(totalsMap);
    for (const match of sortedMatches.filter((item) => item.comp_level === 'qm')) {
      const base = baseMap[match.key] ?? { redRp: 0, blueRp: 0 };
      const override = local[match.key] ?? {
        redRp: base.redRp,
        blueRp: base.blueRp,
      };
      const redDelta = Number(override.redRp ?? 0) - Number(base.redRp ?? 0);
      const blueDelta = Number(override.blueRp ?? 0) - Number(base.blueRp ?? 0);
      for (const teamKey of match.alliances.red.team_keys) {
        totals.set(teamKey, (totals.get(teamKey) ?? 0) + redDelta);
      }
      for (const teamKey of match.alliances.blue.team_keys) {
        totals.set(teamKey, (totals.get(teamKey) ?? 0) + blueDelta);
      }
    }
    const ranked = params.eventRows
      .map((row) => ({
        teamKey: row.teamKey,
        total: totals.get(row.teamKey) ?? 0,
      }))
      .sort((a, b) => b.total - a.total);
    const ourRank = ranked.findIndex((row) => row.teamKey === ourKey) + 1;
    const aboveKey = ourRank > 1 ? ranked[ourRank - 2]?.teamKey : null;
    const belowKey = ourRank > 0 && ourRank < ranked.length ? ranked[ourRank]?.teamKey : null;
    scenarios.push({
      rp,
      ourRank,
      total: totals.get(ourKey) ?? 0,
      rankDelta: currentRank != null && ourRank ? currentRank - ourRank : null,
      totalDelta: currentTotal != null ? (totals.get(ourKey) ?? 0) - currentTotal : null,
      top1: ourRank === 1,
      top4: ourRank > 0 && ourRank <= 4,
      top8: ourRank > 0 && ourRank <= 8,
      aboveTeam: aboveKey ? (eventRowMap.get(aboveKey) ?? null) : null,
      belowTeam: belowKey ? (eventRowMap.get(belowKey) ?? null) : null,
    });
  }

  return {
    generatedAtMs: Date.now(),
    selectedMatchKey: selectedMatch.key,
    scenarios,
  };
}

export function buildPickListBundle(eventRows: CompareTeamEventRow[]): PickListBundlePayload {
  const sourceRows = [...eventRows]
    .sort((a, b) => Number(a.rank ?? 9999) - Number(b.rank ?? 9999))
    .map((row) => mapEventRowToScenarioRow(row));
  const eventRowMap = new Map(sourceRows.map((row) => [row.teamKey, row]));
  const pickDeskRuntime = freshAllianceStateFromSource(sourceRows);
  const takenTeams = new Set<string>();
  (pickDeskRuntime.captainSlots ?? []).forEach((slot) =>
    [slot.captain, ...(slot.picks ?? [])].forEach((teamKey) => takenTeams.add(teamKey)),
  );
  const currentCaptainKey =
    pickDeskRuntime.captainSlots?.[pickDeskRuntime.currentIndex ?? 0]?.captain ?? null;
  const candidateInsights = buildAllianceCandidateInsights({
    availableRows: sourceRows.filter((row) => !takenTeams.has(row.teamKey)),
    captainSlots: pickDeskRuntime.captainSlots ?? [],
    currentCaptainKey,
    eventRowMap,
  });
  return {
    generatedAtMs: Date.now(),
    pickDeskRuntime,
    candidateInsights,
    recommendationRows: buildAllianceRecommendationRows(candidateInsights),
  };
}
