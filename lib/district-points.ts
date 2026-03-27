import type {
  DistrictAllianceRole,
  DistrictAwardKey,
  DistrictCalculatorInput,
  DistrictHistogramBucket,
  DistrictPlayoffFinish,
  DistrictPointsBreakdown,
} from './types';

export const FIT_DISTRICT_KEY = '2026fit';
export const FIT_DISTRICT_NAME = 'FIRST in Texas';
export const FIT_DEFAULT_DCMP_SLOTS = 90;
export const FIT_DEFAULT_CMP_SLOTS = 28;
export const DISTRICT_TEAM_YEAR = 2026;
export const MAX_SINGLE_EVENT_DISTRICT_POINTS = 78;

const DISTRICT_ALPHA = 1.07;
const TOP_TIER_AWARD_POINTS = {
  impact: 10,
  engineering_inspiration: 8,
  rookie_all_star: 8,
} as const;

const FIVE_POINT_AWARDS: DistrictAwardKey[] = [
  'creativity',
  'quality',
  'judges',
  'industrial_design',
  'entrepreneurship',
  'excellence_in_design',
  'engineering_excellence',
  'innovation_in_control',
  'autonomous',
  'imagery',
  'other_team_judged_award',
];

export const DISTRICT_AWARD_OPTIONS: {
  key: DistrictAwardKey;
  label: string;
  points: number;
}[] = [
  { key: 'impact', label: 'FIRST Impact', points: 10 },
  { key: 'engineering_inspiration', label: 'Engineering Inspiration', points: 8 },
  { key: 'rookie_all_star', label: 'Rookie All-Star', points: 8 },
  { key: 'creativity', label: 'Creativity', points: 5 },
  { key: 'quality', label: 'Quality', points: 5 },
  { key: 'judges', label: 'Judges', points: 5 },
  { key: 'industrial_design', label: 'Industrial Design', points: 5 },
  { key: 'entrepreneurship', label: 'Entrepreneurship', points: 5 },
  { key: 'excellence_in_design', label: 'Excellence in Design', points: 5 },
  { key: 'engineering_excellence', label: 'Engineering Excellence', points: 5 },
  { key: 'innovation_in_control', label: 'Innovation in Control', points: 5 },
  { key: 'autonomous', label: 'Autonomous', points: 5 },
  { key: 'imagery', label: 'Imagery', points: 5 },
  { key: 'other_team_judged_award', label: 'Other Team-Judged Award', points: 5 },
];

export type SimAlliance = {
  seed: number;
  teams: string[];
};

export type SimDistrictTeam = {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  skill: number;
  secondarySkill: number;
  currentRank?: number | null;
  currentTotalRp?: number | null;
  officialAwardPoints?: number;
};

export type SimDistrictEventTeamResult = {
  teamKey: string;
  qualPoints: number;
  alliancePoints: number;
  elimPoints: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

// Good enough for district-point rank calculations; results are clamped to the official 4-22 range.
export function erfInv(value: number): number {
  const clamped = clamp(value, -0.999999, 0.999999);
  const sign = clamped < 0 ? -1 : 1;
  const x = Math.abs(clamped);
  const a = 0.147;
  const log = Math.log(1 - x * x);
  const first = 2 / (Math.PI * a) + log / 2;
  const second = log / a;
  return sign * Math.sqrt(Math.sqrt(first * first - second) - first);
}

export function districtQualificationPoints(rank: number, teamCount: number): number {
  const normalizedRank = Math.floor(Number(rank));
  const normalizedTeamCount = Math.floor(Number(teamCount));
  if (!Number.isFinite(normalizedRank) || !Number.isFinite(normalizedTeamCount)) return 0;
  if (normalizedRank <= 0 || normalizedTeamCount <= 0 || normalizedRank > normalizedTeamCount) {
    return 0;
  }

  const numerator = normalizedTeamCount + 1 - 2 * normalizedRank;
  const ratio = numerator / (DISTRICT_ALPHA * normalizedTeamCount);
  const scale = 10 / erfInv(1 / DISTRICT_ALPHA);
  const raw = Math.ceil(erfInv(ratio) * scale + 12);
  return clamp(raw, 4, 22);
}

export function districtCaptainPoints(allianceNumber: number): number {
  const normalizedAllianceNumber = Math.floor(Number(allianceNumber));
  if (!Number.isFinite(normalizedAllianceNumber) || normalizedAllianceNumber <= 0) return 0;
  return Math.max(0, 17 - normalizedAllianceNumber);
}

export function districtAcceptancePoints(acceptanceNumber: number): number {
  const normalizedAcceptanceNumber = Math.floor(Number(acceptanceNumber));
  if (!Number.isFinite(normalizedAcceptanceNumber) || normalizedAcceptanceNumber <= 0) return 0;
  return Math.max(0, 17 - normalizedAcceptanceNumber);
}

export function districtAlliancePointsForRole(
  role: DistrictAllianceRole,
  allianceNumber: number | null,
  captainCount = 8,
): number {
  if (allianceNumber == null) return 0;
  const normalizedAllianceNumber = Math.floor(Number(allianceNumber));
  const normalizedCaptainCount = clamp(Math.floor(Number(captainCount)), 1, 8);
  if (!Number.isFinite(normalizedAllianceNumber) || normalizedAllianceNumber <= 0) return 0;

  if (role === 'captain') {
    return districtCaptainPoints(normalizedAllianceNumber);
  }

  if (role === 'first_pick') {
    return districtAcceptancePoints(normalizedAllianceNumber);
  }

  if (role === 'second_pick') {
    const acceptanceNumber = normalizedCaptainCount * 2 + 1 - normalizedAllianceNumber;
    return districtAcceptancePoints(acceptanceNumber);
  }

  return 0;
}

export function districtPlayoffPoints(finish: DistrictPlayoffFinish, finalsWins = 0): number {
  const normalizedFinalsWins = clamp(Math.floor(Number(finalsWins)), 0, 2);
  if (finish === 'winner') return 20 + normalizedFinalsWins * 5;
  if (finish === 'finalist') return 20 + normalizedFinalsWins * 5;
  if (finish === 'third') return 13;
  if (finish === 'fourth') return 7;
  return 0;
}

export function districtAwardPoints(awardKeys: DistrictAwardKey[]): number {
  return (awardKeys ?? []).reduce((total, awardKey) => {
    if (awardKey in TOP_TIER_AWARD_POINTS) {
      return total + TOP_TIER_AWARD_POINTS[awardKey as keyof typeof TOP_TIER_AWARD_POINTS];
    }

    if (FIVE_POINT_AWARDS.includes(awardKey)) {
      return total + 5;
    }

    return total;
  }, 0);
}

export function rookieBonusPoints(
  rookieYear: number | null,
  currentYear = DISTRICT_TEAM_YEAR,
): number {
  if (rookieYear == null) return 0;
  if (rookieYear === currentYear) return 10;
  if (rookieYear === currentYear - 1) return 5;
  return 0;
}

export function calculateDistrictPointsBreakdown(
  input: DistrictCalculatorInput,
): DistrictPointsBreakdown {
  const qualPoints = districtQualificationPoints(input.qualificationRank, input.teamCount);
  const alliancePoints = districtAlliancePointsForRole(input.allianceRole, input.allianceNumber);
  const elimPoints = districtPlayoffPoints(input.playoffFinish, input.finalsWins);
  const awardPoints = districtAwardPoints(input.awardKeys);
  const ageBonusPoints = Math.max(0, Math.floor(Number(input.rookieBonusPoints ?? 0)));
  const eventPoints = qualPoints + alliancePoints + elimPoints + awardPoints;
  const multiplier = input.dcmpMultiplier ? 3 : 1;
  return {
    qualPoints,
    alliancePoints,
    elimPoints,
    awardPoints,
    ageBonusPoints,
    eventPoints,
    multiplier,
    seasonContribution: eventPoints * multiplier + ageBonusPoints,
  };
}

export function eventPerformancePointsCeiling(teamCount: number, captainCount = 8): number {
  const normalizedTeamCount = Math.max(0, Math.floor(Number(teamCount)));
  const normalizedCaptainCount = clamp(Math.floor(Number(captainCount)), 1, 8);
  const qualTotal = sum(
    Array.from({ length: normalizedTeamCount }, (_, index) =>
      districtQualificationPoints(index + 1, normalizedTeamCount),
    ),
  );
  const captainTotal = sum(
    Array.from({ length: normalizedCaptainCount }, (_, index) => districtCaptainPoints(index + 1)),
  );
  const firstPickTotal = sum(
    Array.from({ length: normalizedCaptainCount }, (_, index) =>
      districtAcceptancePoints(index + 1),
    ),
  );
  const secondPickTotal = sum(
    Array.from({ length: normalizedCaptainCount }, (_, index) =>
      districtAcceptancePoints(normalizedCaptainCount * 2 - index),
    ),
  );
  const playoffTotal = normalizedCaptainCount >= 4 ? 225 : 0;
  return qualTotal + captainTotal + firstPickTotal + secondPickTotal + playoffTotal;
}

export function totalPointsFromBreakdown(
  breakdown: Pick<
    DistrictPointsBreakdown,
    'qualPoints' | 'alliancePoints' | 'elimPoints' | 'awardPoints'
  >,
): number {
  return (
    Number(breakdown.qualPoints ?? 0) +
    Number(breakdown.alliancePoints ?? 0) +
    Number(breakdown.elimPoints ?? 0) +
    Number(breakdown.awardPoints ?? 0)
  );
}

export function quantile(values: number[], percentile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = clamp(
    Math.floor(clamp(percentile, 0, 1) * Math.max(0, sorted.length - 1)),
    0,
    sorted.length - 1,
  );
  return sorted[index] ?? null;
}

export function buildHistogram(values: number[], bucketCount = 10): DistrictHistogramBucket[] {
  if (!values.length) return [];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) {
    return [{ label: `${minimum}`, value: values.length }];
  }

  const width = (maximum - minimum) / Math.max(1, bucketCount);
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    lower: minimum + width * index,
    upper: index === bucketCount - 1 ? maximum : minimum + width * (index + 1),
    value: 0,
  }));

  for (const value of values) {
    const rawIndex = Math.floor((value - minimum) / width);
    const index = clamp(rawIndex, 0, bucketCount - 1);
    const bucket = buckets[index];
    if (bucket) {
      bucket.value += 1;
    }
  }

  return buckets.map((bucket) => ({
    label: `${bucket.lower.toFixed(0)}-${bucket.upper.toFixed(0)}`,
    value: bucket.value,
  }));
}

export function topTierAwardSummaryFromAwards(awards: Record<string, unknown>[]): {
  awardedPoints: number;
  remainingCounts: {
    impact: number;
    engineeringInspiration: number;
    rookieAllStar: number;
  };
} {
  const names = awards
    .map((award) => (typeof award?.name === 'string' ? award.name : ''))
    .filter(Boolean);
  const impactAwarded = names.some((name) => /impact|chairman/i.test(name));
  const engineeringInspirationAwarded = names.some((name) => /engineering inspiration/i.test(name));
  const rookieAllStarAwarded = names.some((name) => /rookie all-star/i.test(name));
  const awardedPoints =
    (impactAwarded ? 10 : 0) +
    (engineeringInspirationAwarded ? 8 : 0) +
    (rookieAllStarAwarded ? 8 : 0);

  return {
    awardedPoints,
    remainingCounts: {
      impact: impactAwarded ? 0 : 1,
      engineeringInspiration: engineeringInspirationAwarded ? 0 : 1,
      rookieAllStar: rookieAllStarAwarded ? 0 : 1,
    },
  };
}

export function topTierAwardPointsFromOfficialValue(awardPoints: number): number {
  const normalizedAwardPoints = Math.max(0, Math.floor(Number(awardPoints)));
  return clamp(normalizedAwardPoints, 0, 26);
}

export function bestTwoRegularEventTotal(eventTotals: number[]): number {
  return sum([...eventTotals].sort((left, right) => right - left).slice(0, 2));
}

export function bestTwoRegularEventList(eventTotals: number[]): number[] {
  return [...eventTotals].sort((left, right) => right - left).slice(0, 2);
}

function teamStrength(team: SimDistrictTeam): number {
  return Number.isFinite(Number(team.skill))
    ? Number(team.skill)
    : Number(team.secondarySkill) || 0;
}

function allianceStrength(teamMap: Map<string, SimDistrictTeam>, teams: string[]): number {
  const strengths = teams
    .map((teamKey) => teamMap.get(teamKey))
    .filter((team): team is SimDistrictTeam => team != null)
    .map((team) => teamStrength(team));
  if (!strengths.length) return 0;
  return strengths.reduce((total, value) => total + value, 0) / strengths.length;
}

export function captainCountForTeamCount(teamCount: number): number {
  if (teamCount >= 24) return 8;
  return clamp(Math.floor(teamCount / 3), 1, 8);
}

export function simulateAllianceSelection(rankedTeams: SimDistrictTeam[]): {
  alliances: SimAlliance[];
  alliancePointsByTeam: Map<string, number>;
} {
  const captainCount = captainCountForTeamCount(rankedTeams.length);
  const captains = rankedTeams.slice(0, captainCount);
  const available = rankedTeams
    .slice(captainCount)
    .sort((left, right) => teamStrength(right) - teamStrength(left));
  const alliances = captains.map((captain, index) => ({
    seed: index + 1,
    teams: [captain.teamKey],
  }));
  const alliancePointsByTeam = new Map<string, number>();

  captains.forEach((captain, index) => {
    alliancePointsByTeam.set(captain.teamKey, districtCaptainPoints(index + 1));
  });

  for (const alliance of alliances) {
    const firstPick = available.shift();
    if (!firstPick) continue;
    alliance.teams.push(firstPick.teamKey);
    alliancePointsByTeam.set(firstPick.teamKey, districtAcceptancePoints(alliance.seed));
  }

  for (let index = alliances.length - 1; index >= 0; index -= 1) {
    const secondPick = available.shift();
    const alliance = alliances[index];
    if (!alliance) continue;
    if (!secondPick) continue;
    alliance.teams.push(secondPick.teamKey);
    const acceptanceNumber = alliances.length * 2 + 1 - alliance.seed;
    alliancePointsByTeam.set(secondPick.teamKey, districtAcceptancePoints(acceptanceNumber));
  }

  return { alliances, alliancePointsByTeam };
}

function matchWinProbability(
  redTeams: string[],
  blueTeams: string[],
  teamMap: Map<string, SimDistrictTeam>,
): number {
  const redStrength = allianceStrength(teamMap, redTeams);
  const blueStrength = allianceStrength(teamMap, blueTeams);
  const logistic = 1 / (1 + Math.exp(-(redStrength - blueStrength) / 8));
  return clamp(logistic, 0.03, 0.97);
}

function buildPlayoffBracket(alliances: SimAlliance[], winners: Record<string, 'red' | 'blue'>) {
  const getAlliance = (seed: number): SimAlliance =>
    alliances.find((alliance) => alliance.seed === seed) ?? { seed, teams: [] };
  const match = (key: string, red: SimAlliance | null, blue: SimAlliance | null) => ({
    key,
    red,
    blue,
  });
  const winner = (item: { key: string; red: SimAlliance | null; blue: SimAlliance | null }) => {
    const result = winners[item.key];
    if (result === 'red') return item.red;
    if (result === 'blue') return item.blue;
    return null;
  };
  const loser = (item: { key: string; red: SimAlliance | null; blue: SimAlliance | null }) => {
    const result = winners[item.key];
    if (result === 'red') return item.blue;
    if (result === 'blue') return item.red;
    return null;
  };

  const U1 = match('U1', getAlliance(1), getAlliance(8));
  const U2 = match('U2', getAlliance(4), getAlliance(5));
  const U3 = match('U3', getAlliance(2), getAlliance(7));
  const U4 = match('U4', getAlliance(3), getAlliance(6));
  const L1 = match('L1', loser(U1), loser(U2));
  const L2 = match('L2', loser(U3), loser(U4));
  const U5 = match('U5', winner(U1), winner(U2));
  const U6 = match('U6', winner(U3), winner(U4));
  const L3 = match('L3', loser(U5), winner(L1));
  const L4 = match('L4', loser(U6), winner(L2));
  const U7 = match('U7', winner(U5), winner(U6));
  const L5 = match('L5', winner(L3), winner(L4));
  const L6 = match('L6', loser(U7), winner(L5));
  return { U1, U2, U3, U4, L1, L2, U5, U6, L3, L4, U7, L5, L6 };
}

export function simulatePlayoffResults(
  alliances: SimAlliance[],
  teamMap: Map<string, SimDistrictTeam>,
): {
  winnerSeed: number | null;
  finalistSeed: number | null;
  thirdSeed: number | null;
  fourthSeed: number | null;
  winnerFinalWins: number;
  finalistFinalWins: number;
} {
  const winners: Record<string, 'red' | 'blue'> = {};
  const keys = ['U1', 'U2', 'U3', 'U4', 'L1', 'L2', 'U5', 'U6', 'L3', 'L4', 'U7', 'L5', 'L6'];

  for (const key of keys) {
    const bracket = buildPlayoffBracket(alliances, winners);
    const match = bracket[key as keyof typeof bracket];
    if (!match?.red?.teams?.length || !match?.blue?.teams?.length) continue;
    const redWinProbability = matchWinProbability(match.red.teams, match.blue.teams, teamMap);
    winners[key] = Math.random() < redWinProbability ? 'red' : 'blue';
  }

  const bracket = buildPlayoffBracket(alliances, winners);
  const finalistFromUpper = winners.U7 === 'red' ? bracket.U7.red : bracket.U7.blue;
  const challenger = winners.L6 === 'red' ? bracket.L6.red : bracket.L6.blue;
  const thirdPlace = winners.L6 === 'red' ? bracket.L6.blue : bracket.L6.red;
  const fourthPlace = winners.L5 === 'red' ? bracket.L5.blue : bracket.L5.red;

  let upperWins = 0;
  let lowerWins = 0;
  while (upperWins < 2 && lowerWins < 2) {
    const redWinProbability = matchWinProbability(
      finalistFromUpper?.teams ?? [],
      challenger?.teams ?? [],
      teamMap,
    );
    if (Math.random() < redWinProbability) {
      upperWins += 1;
    } else {
      lowerWins += 1;
    }
  }

  const upperWon = upperWins === 2;
  return {
    winnerSeed: upperWon ? (finalistFromUpper?.seed ?? null) : (challenger?.seed ?? null),
    finalistSeed: upperWon ? (challenger?.seed ?? null) : (finalistFromUpper?.seed ?? null),
    thirdSeed: thirdPlace?.seed ?? null,
    fourthSeed: fourthPlace?.seed ?? null,
    winnerFinalWins: upperWon ? upperWins : lowerWins,
    finalistFinalWins: upperWon ? lowerWins : upperWins,
  };
}

export function simulateDistrictEventFromRanking(
  ranked: SimDistrictTeam[],
): Map<string, SimDistrictEventTeamResult> {
  const teamMap = new Map(ranked.map((team) => [team.teamKey, team]));
  const allianceSelection = simulateAllianceSelection(ranked);
  const playoffResults = simulatePlayoffResults(allianceSelection.alliances, teamMap);
  const results = new Map<string, SimDistrictEventTeamResult>();

  ranked.forEach((team, index) => {
    results.set(team.teamKey, {
      teamKey: team.teamKey,
      qualPoints: districtQualificationPoints(index + 1, ranked.length),
      alliancePoints: allianceSelection.alliancePointsByTeam.get(team.teamKey) ?? 0,
      elimPoints: 0,
    });
  });

  const applySeedElimPoints = (
    seed: number | null,
    finish: DistrictPlayoffFinish,
    finalsWins = 0,
  ) => {
    if (seed == null) return;
    const alliance = allianceSelection.alliances.find((entry) => entry.seed === seed);
    if (!alliance) return;
    const elimPoints = districtPlayoffPoints(finish, finalsWins);
    alliance.teams.forEach((teamKey) => {
      const existing = results.get(teamKey);
      if (!existing) return;
      existing.elimPoints = elimPoints;
      results.set(teamKey, existing);
    });
  };

  applySeedElimPoints(playoffResults.winnerSeed, 'winner', playoffResults.winnerFinalWins);
  applySeedElimPoints(playoffResults.finalistSeed, 'finalist', playoffResults.finalistFinalWins);
  applySeedElimPoints(playoffResults.thirdSeed, 'third');
  applySeedElimPoints(playoffResults.fourthSeed, 'fourth');

  return results;
}

export function simulateApproximateDistrictEvent(
  teams: SimDistrictTeam[],
): Map<string, SimDistrictEventTeamResult> {
  const ranked = [...teams]
    .map((team) => ({
      team,
      score:
        teamStrength(team) +
        (Number.isFinite(Number(team.secondarySkill)) ? Number(team.secondarySkill) * 0.015 : 0) +
        (Math.random() - 0.5) * 16,
    }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.team);
  return simulateDistrictEventFromRanking(ranked);
}
