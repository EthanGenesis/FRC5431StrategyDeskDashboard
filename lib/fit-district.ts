import { z } from 'zod';

import {
  DISTRICT_TEAM_YEAR,
  FIT_DEFAULT_CMP_SLOTS,
  FIT_DEFAULT_DCMP_SLOTS,
  FIT_DISTRICT_KEY,
  FIT_DISTRICT_NAME,
  MAX_SINGLE_EVENT_DISTRICT_POINTS,
  bestTwoRegularEventTotal,
  buildHistogram,
  captainCountForTeamCount,
  eventPerformancePointsCeiling,
  quantile,
  simulateApproximateDistrictEvent,
  topTierAwardSummaryFromAwards,
  totalPointsFromBreakdown,
} from './district-points';
import { getAppEnv } from './env';
import { tbaTeamKey, teamNumberFromKey } from './logic';
import {
  loadEventContext,
  parsePositiveTeamNumber,
  parseRequiredEventKey,
  safeResolve,
} from './server-data';
import { sbGet } from './statbotics';
import { tbaGet } from './tba';
import { buildEventTeamRowsFromContext } from './analytics';
import type {
  CompareTeamEventRow,
  DistrictAdvancementFlags,
  DistrictCutlineDistribution,
  DistrictEventOfficialRow,
  DistrictEventProjection,
  DistrictEventProjectionRow,
  DistrictEventStatus,
  DistrictEventSummary,
  DistrictLockStatus,
  DistrictSeasonProjection,
  DistrictSeasonTeamRow,
  DistrictSnapshotResponse,
  DistrictStandingRow,
  ExternalArray,
  ExternalRecord,
} from './types';

type TbaDistrictRankingEventPoints = {
  event_key?: unknown;
  qual_points?: unknown;
  alliance_points?: unknown;
  elim_points?: unknown;
  award_points?: unknown;
  total?: unknown;
  district_cmp?: unknown;
};

type TbaDistrictRankingRow = {
  team_key?: unknown;
  rank?: unknown;
  point_total?: unknown;
  rookie_bonus?: unknown;
  adjustments?: unknown;
  event_points?: unknown;
};

type TbaDistrictTeamSimple = {
  key?: unknown;
  team_number?: unknown;
  nickname?: unknown;
  name?: unknown;
};

type TbaDistrictEvent = ExternalRecord & {
  key?: unknown;
  name?: unknown;
  short_name?: unknown;
  week?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  event_type?: unknown;
  event_type_string?: unknown;
  district?: {
    key?: unknown;
    official_advancement_counts?: {
      dcmp?: unknown;
      cmp?: unknown;
    };
  } | null;
};

type TbaDistrictAdvancementMap = Record<string, { dcmp?: boolean; cmp?: boolean }>;

type TbaEventDistrictPointMap = Record<
  string,
  {
    qual_points?: unknown;
    alliance_points?: unknown;
    elim_points?: unknown;
    award_points?: unknown;
    total?: unknown;
  }
>;

type TbaEventDistrictPointsResponse = {
  points?: TbaEventDistrictPointMap;
};

type StatboticsTeamYear = ExternalRecord & {
  team?: unknown;
  name?: unknown;
  district?: unknown;
  rookie_year?: unknown;
  district_rank?: unknown;
  epa?: {
    norm?: unknown;
    total_points?: {
      mean?: unknown;
    };
    breakdown?: {
      auto_points?: unknown;
      teleop_points?: unknown;
      endgame_points?: unknown;
    };
  } | null;
};

type FitDistrictContext = {
  snapshot: DistrictSnapshotResponse;
  standings: DistrictStandingRow[];
  loadedTeamStanding: DistrictStandingRow | null;
  eventContext: Awaited<ReturnType<typeof loadEventContext>> | null;
  eventRosterMap: Map<string, string[]>;
  teamMetaMap: Map<string, { teamNumber: number; nickname: string; name: string }>;
  statboticsYearMap: Map<string, StatboticsTeamYear>;
  currentEventOfficialMap: Map<string, DistrictEventOfficialRow>;
  currentEventRows: CompareTeamEventRow[];
  dcmpEventKey: string | null;
};

const simulateRouteSchema = z.object({
  eventKey: z.string().trim().min(1),
  team: z.number().int().positive().nullable().optional(),
  runs: z.number().int().min(50).max(5000).optional(),
  mode: z.enum(['event', 'season']),
});

function safeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeInteger(value: unknown, fallback = 0): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function recordValue(value: unknown): ExternalRecord | null {
  return typeof value === 'object' && value !== null ? (value as ExternalRecord) : null;
}

function arrayValue(value: unknown): ExternalArray {
  return Array.isArray(value) ? (value as ExternalArray) : [];
}

function districtKeyForEvent(event: ExternalRecord | null | undefined): string | null {
  const district = recordValue(event?.district);
  const key = stringValue(district?.key);
  return key || null;
}

function isFitDistrictEvent(event: ExternalRecord | null | undefined): boolean {
  return districtKeyForEvent(event) === FIT_DISTRICT_KEY;
}

function isFitDistrictSeasonRow(row: StatboticsTeamYear): boolean {
  const district = row?.district;
  if (typeof district === 'string') {
    return district.trim().toLowerCase() === 'fit';
  }

  if (district && typeof district === 'object') {
    const key = stringValue((district as Record<string, unknown>).key).toLowerCase();
    const abbreviation = stringValue(
      (district as Record<string, unknown>).abbreviation,
    ).toLowerCase();
    return key === 'fit' || abbreviation === 'fit' || key === FIT_DISTRICT_KEY;
  }

  return false;
}

function isDistrictCmpEvent(
  event: TbaDistrictEvent | DistrictEventSummary | ExternalRecord | null | undefined,
): boolean {
  const eventRecord = recordValue(event);
  const eventTypeString = stringValue(
    eventRecord?.event_type_string ?? eventRecord?.eventTypeString,
  ).toLowerCase();
  if (eventTypeString.includes('district championship')) {
    return true;
  }

  const eventType = safeNumber((event as ExternalRecord | null | undefined)?.event_type);
  return eventType === 2;
}

function aggregateCompletedEventPoints(standings: DistrictStandingRow[]): Map<
  string,
  {
    total: number;
    qual: number;
    alliance: number;
    elim: number;
    award: number;
    districtCmp: boolean;
  }
> {
  const totals = new Map<
    string,
    {
      total: number;
      qual: number;
      alliance: number;
      elim: number;
      award: number;
      districtCmp: boolean;
    }
  >();

  for (const standing of standings) {
    for (const eventPoints of standing.eventPoints) {
      const existing = totals.get(eventPoints.eventKey) ?? {
        total: 0,
        qual: 0,
        alliance: 0,
        elim: 0,
        award: 0,
        districtCmp: eventPoints.districtCmp,
      };
      existing.total += safeInteger(eventPoints.total);
      existing.qual += safeInteger(eventPoints.qualPoints);
      existing.alliance += safeInteger(eventPoints.alliancePoints);
      existing.elim += safeInteger(eventPoints.elimPoints);
      existing.award += safeInteger(eventPoints.awardPoints);
      existing.districtCmp = existing.districtCmp || eventPoints.districtCmp;
      totals.set(eventPoints.eventKey, existing);
    }
  }

  return totals;
}

function inferEventStatus(
  event: TbaDistrictEvent,
  loadedEventKey: string,
  eventContext: Awaited<ReturnType<typeof loadEventContext>> | null,
): DistrictEventStatus {
  const eventKey = stringValue(event?.key);
  const now = new Date();
  const startDate = stringValue(event?.start_date);
  const endDate = stringValue(event?.end_date);
  const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
  const end = endDate ? new Date(`${endDate}T23:59:59`) : null;

  if (eventKey && loadedEventKey && eventKey === loadedEventKey && eventContext) {
    const matches = eventContext.tba.matches ?? [];
    const playedCount = matches.filter((match) => {
      const redScore = match?.alliances?.red?.score;
      const blueScore = match?.alliances?.blue?.score;
      return (
        (typeof redScore === 'number' && redScore >= 0) ||
        (typeof blueScore === 'number' && blueScore >= 0) ||
        match?.actual_time != null ||
        match?.post_result_time != null
      );
    }).length;
    if (matches.length > 0 && playedCount >= matches.length) return 'complete';
    if (playedCount > 0) return 'live';
  }

  if (end && end.getTime() < now.getTime()) return 'complete';
  if (start && end && start.getTime() <= now.getTime() && now.getTime() <= end.getTime()) {
    return 'live';
  }
  return 'future';
}

async function loadStatboticsFitTeamYears(): Promise<Map<string, StatboticsTeamYear>> {
  const pageSize = 1000;
  const results = new Map<string, StatboticsTeamYear>();

  for (let offset = 0; offset < 5000; offset += pageSize) {
    const page = await safeResolve(
      sbGet<ExternalArray>(
        `/team_years?year=${DISTRICT_TEAM_YEAR}&limit=${pageSize}&offset=${offset}`,
      ),
    );
    const rows = Array.isArray(page) ? (page as StatboticsTeamYear[]) : [];
    for (const row of rows) {
      if (!isFitDistrictSeasonRow(row)) continue;
      const teamNumber = safeInteger(row?.team ?? row?.team_number, 0);
      if (teamNumber <= 0) continue;
      results.set(tbaTeamKey(teamNumber), row);
    }
    if (rows.length < pageSize) break;
  }

  return results;
}

async function loadEventRosters(
  eventKeys: string[],
  authKey: string,
): Promise<Map<string, string[]>> {
  const rosterEntries = await Promise.all(
    eventKeys.map(async (eventKey) => {
      const roster = await safeResolve(tbaGet<string[]>(`/event/${eventKey}/teams/keys`, authKey));
      return [eventKey, Array.isArray(roster) ? roster.map(String) : []] as const;
    }),
  );
  return new Map(rosterEntries);
}

function teamMetaForKey(
  teamKey: string,
  teamMetaMap: Map<string, { teamNumber: number; nickname: string; name: string }>,
): { teamNumber: number; nickname: string; name: string } {
  return (
    teamMetaMap.get(teamKey) ?? {
      teamNumber: teamNumberFromKey(teamKey) ?? 0,
      nickname: String(teamNumberFromKey(teamKey) ?? teamKey),
      name: String(teamNumberFromKey(teamKey) ?? teamKey),
    }
  );
}

function currentEventOfficialRowsFromStandings(
  eventKey: string,
  standings: DistrictStandingRow[],
  teamMetaMap: Map<string, { teamNumber: number; nickname: string; name: string }>,
): DistrictEventOfficialRow[] {
  return standings
    .map((standing) => {
      const eventPoints = standing.eventPoints.find((entry) => entry.eventKey === eventKey);
      if (!eventPoints) return null;
      const teamMeta = teamMetaForKey(standing.teamKey, teamMetaMap);
      const multiplier = eventPoints.districtCmp ? 3 : 1;
      return {
        teamKey: standing.teamKey,
        teamNumber: teamMeta.teamNumber,
        nickname: teamMeta.nickname || teamMeta.name,
        officialPoints: {
          qualPoints: eventPoints.qualPoints,
          alliancePoints: eventPoints.alliancePoints,
          elimPoints: eventPoints.elimPoints,
          awardPoints: eventPoints.awardPoints,
          ageBonusPoints: 0,
          eventPoints: eventPoints.total,
          multiplier,
          seasonContribution: eventPoints.total * multiplier,
        },
      } satisfies DistrictEventOfficialRow;
    })
    .filter((row): row is DistrictEventOfficialRow => row != null)
    .sort((left, right) => right.officialPoints.eventPoints - left.officialPoints.eventPoints);
}

function teamSkillForSimulation(
  teamKey: string,
  standing: DistrictStandingRow | null,
  eventRow: CompareTeamEventRow | null,
  statboticsYear: StatboticsTeamYear | null,
): number {
  return (
    safeNumber(eventRow?.overallEpa) ??
    safeNumber(statboticsYear?.epa?.total_points?.mean) ??
    safeNumber(standing?.seasonEpa) ??
    0
  );
}

function teamSecondarySkillForSimulation(
  teamKey: string,
  standing: DistrictStandingRow | null,
  eventRow: CompareTeamEventRow | null,
  statboticsYear: StatboticsTeamYear | null,
): number {
  return (
    safeNumber(eventRow?.composite) ??
    safeNumber(statboticsYear?.epa?.norm) ??
    safeNumber(standing?.seasonEpa) ??
    teamNumberFromKey(teamKey) ??
    0
  );
}

function buildSimTeamList(
  teamKeys: string[],
  standingsMap: Map<string, DistrictStandingRow>,
  teamMetaMap: Map<string, { teamNumber: number; nickname: string; name: string }>,
  statboticsYearMap: Map<string, StatboticsTeamYear>,
  eventRowMap: Map<string, CompareTeamEventRow>,
  officialAwardMap: Map<string, number> = new Map<string, number>(),
) {
  return teamKeys
    .map((teamKey) => {
      const standing = standingsMap.get(teamKey) ?? null;
      const teamMeta = teamMetaForKey(teamKey, teamMetaMap);
      const eventRow = eventRowMap.get(teamKey) ?? null;
      const statboticsYear = statboticsYearMap.get(teamKey) ?? null;
      return {
        teamKey,
        teamNumber: teamMeta.teamNumber,
        nickname: teamMeta.nickname || teamMeta.name,
        skill: teamSkillForSimulation(teamKey, standing, eventRow, statboticsYear),
        secondarySkill: teamSecondarySkillForSimulation(
          teamKey,
          standing,
          eventRow,
          statboticsYear,
        ),
        currentRank: safeNumber(eventRow?.rank) ?? standing?.currentDistrictRank ?? null,
        currentTotalRp: safeNumber(eventRow?.totalRp),
        officialAwardPoints: officialAwardMap.get(teamKey) ?? 0,
      };
    })
    .filter((team) => team.teamNumber > 0);
}

function summarizeCutoff(values: number[]): DistrictCutlineDistribution {
  if (!values.length) {
    return {
      min: null,
      p5: null,
      p50: null,
      p95: null,
      max: null,
    };
  }

  return {
    min: Math.min(...values),
    p5: quantile(values, 0.05),
    p50: quantile(values, 0.5),
    p95: quantile(values, 0.95),
    max: Math.max(...values),
  };
}

type DistrictStatusBoundsInput = {
  teamKey: string;
  slotCount: number;
  floorsByTeam: Map<string, number>;
  ceilingsByTeam: Map<string, number>;
  automatic?: boolean;
};

export function districtStatusFromBounds({
  teamKey,
  slotCount,
  floorsByTeam,
  ceilingsByTeam,
  automatic = false,
}: DistrictStatusBoundsInput): DistrictLockStatus {
  if (automatic) return 'AUTO';

  const floor = floorsByTeam.get(teamKey) ?? 0;
  const ceiling = ceilingsByTeam.get(teamKey) ?? floor;
  const guaranteedAhead = Array.from(floorsByTeam.entries()).filter(
    ([otherTeamKey, otherFloor]) => otherTeamKey !== teamKey && otherFloor > ceiling,
  ).length;
  if (guaranteedAhead >= slotCount) {
    return 'ELIMINATED';
  }

  const possibleAheadOrTied = Array.from(ceilingsByTeam.entries()).filter(
    ([otherTeamKey, otherCeiling]) => otherTeamKey !== teamKey && otherCeiling >= floor,
  ).length;
  if (possibleAheadOrTied < slotCount) {
    return 'LOCKED';
  }

  return 'BUBBLE';
}

async function buildFitDistrictContext(
  eventKey: string,
  loadedTeam: number | null,
): Promise<FitDistrictContext> {
  const loadedEventKey = parseRequiredEventKey(eventKey);
  const parsedLoadedTeam = loadedTeam != null ? parsePositiveTeamNumber(loadedTeam) : null;
  const eventContext = loadedEventKey ? await loadEventContext(loadedEventKey) : null;
  const loadedEvent = eventContext?.tba.event ?? null;
  const loadedEventIsFitDistrict = isFitDistrictEvent(loadedEvent);

  if (!loadedEventIsFitDistrict) {
    return {
      snapshot: {
        generatedAtMs: Date.now(),
        applicable: false,
        reason: 'District points are only available for FIT district events in this view.',
        districtKey: FIT_DISTRICT_KEY,
        districtName: FIT_DISTRICT_NAME,
        loadedEventKey,
        loadedTeam: parsedLoadedTeam,
        loadedEventIsFitDistrict: false,
        advancementCounts: {
          dcmp: FIT_DEFAULT_DCMP_SLOTS,
          cmp: FIT_DEFAULT_CMP_SLOTS,
        },
        standings: [],
        loadedTeamStanding: null,
        advancement: {},
        season: {
          currentDcmpLinePoints: null,
          currentWorldsLinePoints: null,
          pointsRemainingDistrictCeiling: 0,
          remainingTopTierAwards: {
            impact: 0,
            engineeringInspiration: 0,
            rookieAllStar: 0,
          },
          events: [],
        },
        loadedTeamSeason: null,
        currentEvent: null,
      },
      standings: [],
      loadedTeamStanding: null,
      eventContext,
      eventRosterMap: new Map(),
      teamMetaMap: new Map(),
      statboticsYearMap: new Map(),
      currentEventOfficialMap: new Map(),
      currentEventRows: [],
      dcmpEventKey: null,
    };
  }

  if (!eventContext) {
    throw new Error('Missing loaded FIT event context.');
  }

  const { TBA_AUTH_KEY } = getAppEnv();
  const [
    districtRankings,
    districtAdvancement,
    districtEvents,
    districtTeams,
    currentEventDistrictPoints,
    statboticsYearMap,
  ] = await Promise.all([
    tbaGet<TbaDistrictRankingRow[]>(`/district/${FIT_DISTRICT_KEY}/rankings`, TBA_AUTH_KEY),
    tbaGet<TbaDistrictAdvancementMap>(`/district/${FIT_DISTRICT_KEY}/advancement`, TBA_AUTH_KEY),
    tbaGet<TbaDistrictEvent[]>(`/district/${FIT_DISTRICT_KEY}/events`, TBA_AUTH_KEY),
    tbaGet<TbaDistrictTeamSimple[]>(`/district/${FIT_DISTRICT_KEY}/teams/simple`, TBA_AUTH_KEY),
    safeResolve(
      tbaGet<TbaEventDistrictPointsResponse>(
        `/event/${loadedEventKey}/district_points`,
        TBA_AUTH_KEY,
      ),
    ),
    loadStatboticsFitTeamYears(),
  ]);

  const districtEventKeys = districtEvents.map((event) => stringValue(event?.key)).filter(Boolean);
  const eventRosterMap = await loadEventRosters(districtEventKeys, TBA_AUTH_KEY);

  const teamMetaMap = new Map<string, { teamNumber: number; nickname: string; name: string }>();
  for (const team of districtTeams) {
    const teamNumber = safeInteger(team?.team_number, 0);
    if (teamNumber <= 0) continue;
    const teamKey = stringValue(team?.key) || tbaTeamKey(teamNumber);
    teamMetaMap.set(teamKey, {
      teamNumber,
      nickname: stringValue(team?.nickname) || stringValue(team?.name) || String(teamNumber),
      name: stringValue(team?.name) || stringValue(team?.nickname) || String(teamNumber),
    });
  }
  for (const [teamKey, row] of statboticsYearMap.entries()) {
    if (teamMetaMap.has(teamKey)) continue;
    const teamNumber = safeInteger(row?.team, teamNumberFromKey(teamKey) ?? 0);
    teamMetaMap.set(teamKey, {
      teamNumber,
      nickname: stringValue(row?.name) || String(teamNumber),
      name: stringValue(row?.name) || String(teamNumber),
    });
  }

  const advancement: Record<string, DistrictAdvancementFlags> = {};
  for (const [teamKey, flags] of Object.entries(districtAdvancement ?? {})) {
    advancement[teamKey] = {
      dcmp: Boolean(flags?.dcmp),
      cmp: Boolean(flags?.cmp),
    };
  }

  const eventRows = buildEventTeamRowsFromContext(eventContext);
  const rawStandings = (districtRankings ?? []).map((row) => {
    const teamKey = stringValue(row?.team_key);
    if (!teamKey) return null;
    const teamMeta = teamMetaForKey(teamKey, teamMetaMap);
    const statboticsYear = statboticsYearMap.get(teamKey) ?? null;
    const rawEventPoints = Array.isArray(row?.event_points)
      ? (row.event_points as TbaDistrictRankingEventPoints[])
      : [];
    const eventPoints = rawEventPoints
      .map((eventPointsRow) => ({
        eventKey: stringValue(eventPointsRow?.event_key),
        qualPoints: safeInteger(eventPointsRow?.qual_points),
        alliancePoints: safeInteger(eventPointsRow?.alliance_points),
        elimPoints: safeInteger(eventPointsRow?.elim_points),
        awardPoints: safeInteger(eventPointsRow?.award_points),
        total: safeInteger(eventPointsRow?.total),
        districtCmp: Boolean(eventPointsRow?.district_cmp),
      }))
      .filter((eventPointsRow) => eventPointsRow.eventKey);
    const playedRegularEvents = eventPoints
      .filter((eventPointsRow) => !eventPointsRow.districtCmp)
      .map((eventPointsRow) => eventPointsRow.eventKey);
    const remainingRegularEvents = districtEvents
      .filter((event) => !isDistrictCmpEvent(event))
      .map((event) => stringValue(event?.key))
      .filter((districtEventKey) => {
        const roster = eventRosterMap.get(districtEventKey) ?? [];
        return roster.includes(teamKey) && !playedRegularEvents.includes(districtEventKey);
      });

    return {
      teamKey,
      teamNumber: teamMeta.teamNumber,
      nickname: teamMeta.nickname,
      name: teamMeta.name,
      rank: safeInteger(row?.rank),
      pointTotal: safeInteger(row?.point_total),
      rookieBonus: safeInteger(row?.rookie_bonus),
      adjustments: safeInteger(row?.adjustments),
      officialDcmpQualified: Boolean(advancement[teamKey]?.dcmp),
      officialCmpQualified: Boolean(advancement[teamKey]?.cmp),
      rookieYear: safeInteger(statboticsYear?.rookie_year, 0) || null,
      districtKey: FIT_DISTRICT_KEY,
      seasonEpa: safeNumber(statboticsYear?.epa?.total_points?.mean),
      seasonAutoEpa: safeNumber(statboticsYear?.epa?.breakdown?.auto_points),
      seasonTeleopEpa: safeNumber(statboticsYear?.epa?.breakdown?.teleop_points),
      seasonEndgameEpa: safeNumber(statboticsYear?.epa?.breakdown?.endgame_points),
      currentDistrictRank: safeNumber(statboticsYear?.district_rank),
      eventPoints,
      playedRegularEvents,
      remainingRegularEvents,
      hasOfficialDcmpResult: eventPoints.some((eventPointsRow) => eventPointsRow.districtCmp),
    } satisfies DistrictStandingRow;
  });
  const standings: DistrictStandingRow[] = rawStandings
    .filter((row): row is NonNullable<(typeof rawStandings)[number]> => row != null)
    .sort((left, right) => left.rank - right.rank);

  const standingsMap = new Map(standings.map((row) => [row.teamKey, row]));
  const completedEventPointTotals = aggregateCompletedEventPoints(standings);
  const dcmpEvent = districtEvents.find((event) => isDistrictCmpEvent(event)) ?? null;
  const dcmpEventKey = dcmpEvent ? stringValue(dcmpEvent.key) : null;
  const loadedEventAwardSummary = topTierAwardSummaryFromAwards(
    arrayValue(eventContext?.tba.awards) as Record<string, unknown>[],
  );

  const advancementCounts = {
    dcmp:
      safeInteger(
        districtEvents[0]?.district?.official_advancement_counts?.dcmp,
        FIT_DEFAULT_DCMP_SLOTS,
      ) || FIT_DEFAULT_DCMP_SLOTS,
    cmp:
      safeInteger(
        districtEvents[0]?.district?.official_advancement_counts?.cmp,
        FIT_DEFAULT_CMP_SLOTS,
      ) || FIT_DEFAULT_CMP_SLOTS,
  };

  const seasonEvents: DistrictEventSummary[] = districtEvents
    .map((event) => {
      const districtEventKey = stringValue(event?.key);
      const rawWeek = safeNumber(event?.week);
      const completedTotals = completedEventPointTotals.get(districtEventKey) ?? {
        total: 0,
        qual: 0,
        alliance: 0,
        elim: 0,
        award: 0,
        districtCmp: isDistrictCmpEvent(event),
      };
      const status = inferEventStatus(event, loadedEventKey, eventContext);
      const teamCount = (eventRosterMap.get(districtEventKey) ?? []).length;
      const topTierSummary =
        districtEventKey === loadedEventKey
          ? loadedEventAwardSummary
          : {
              awardedPoints: 0,
              remainingCounts: {
                impact: 0,
                engineeringInspiration: 0,
                rookieAllStar: 0,
              },
            };
      const remainingTopTierAwards =
        status === 'complete'
          ? {
              impact: 0,
              engineeringInspiration: 0,
              rookieAllStar: 0,
            }
          : districtEventKey === loadedEventKey
            ? topTierSummary.remainingCounts
            : {
                impact: 1,
                engineeringInspiration: 1,
                rookieAllStar: 1,
              };
      const awardedTopTierPoints =
        districtEventKey === loadedEventKey
          ? topTierSummary.awardedPoints
          : status === 'complete'
            ? Math.min(completedTotals.award, 26)
            : 0;
      const remainingTopTierAwardPoints =
        remainingTopTierAwards.impact * 10 +
        remainingTopTierAwards.engineeringInspiration * 8 +
        remainingTopTierAwards.rookieAllStar * 8;

      return {
        eventKey: districtEventKey,
        name: stringValue(event?.name),
        shortName: stringValue(event?.short_name) || stringValue(event?.name),
        week: rawWeek != null ? rawWeek + 1 : null,
        startDate: stringValue(event?.start_date) || null,
        endDate: stringValue(event?.end_date) || null,
        districtCmp: isDistrictCmpEvent(event),
        teamCount,
        awardedOfficialPoints: completedTotals.total,
        awardedPerformancePoints:
          completedTotals.qual + completedTotals.alliance + completedTotals.elim,
        remainingPerformanceCeiling:
          status === 'complete'
            ? 0
            : Math.max(
                0,
                eventPerformancePointsCeiling(teamCount, captainCountForTeamCount(teamCount)) -
                  (completedTotals.qual + completedTotals.alliance + completedTotals.elim),
              ),
        awardedTopTierPoints,
        remainingTopTierAwardPoints,
        remainingTopTierAwards,
        status,
      } satisfies DistrictEventSummary;
    })
    .sort((left, right) => {
      const weekDelta = safeInteger(left.week) - safeInteger(right.week);
      if (weekDelta !== 0) return weekDelta;
      return left.eventKey.localeCompare(right.eventKey);
    });

  const loadedTeamStanding =
    parsedLoadedTeam != null ? (standingsMap.get(tbaTeamKey(parsedLoadedTeam)) ?? null) : null;

  const currentEventOfficialRowsFromApi = currentEventDistrictPoints?.points
    ? Object.entries(currentEventDistrictPoints.points)
        .map(([teamKey, points]) => {
          const teamMeta = teamMetaForKey(teamKey, teamMetaMap);
          const multiplier = seasonEvents.find((event) => event.eventKey === loadedEventKey)
            ?.districtCmp
            ? 3
            : 1;
          return {
            teamKey,
            teamNumber: teamMeta.teamNumber,
            nickname: teamMeta.nickname || teamMeta.name,
            officialPoints: {
              qualPoints: safeInteger(points?.qual_points),
              alliancePoints: safeInteger(points?.alliance_points),
              elimPoints: safeInteger(points?.elim_points),
              awardPoints: safeInteger(points?.award_points),
              ageBonusPoints: 0,
              eventPoints: safeInteger(points?.total),
              multiplier,
              seasonContribution: safeInteger(points?.total) * multiplier,
            },
          } satisfies DistrictEventOfficialRow;
        })
        .sort((left, right) => right.officialPoints.eventPoints - left.officialPoints.eventPoints)
    : [];
  const currentEventOfficialRows =
    currentEventOfficialRowsFromApi.length > 0
      ? currentEventOfficialRowsFromApi
      : currentEventOfficialRowsFromStandings(loadedEventKey, standings, teamMetaMap);
  const currentEventOfficialMap = new Map(
    currentEventOfficialRows.map((row) => [row.teamKey, row]),
  );

  const currentDcmpLinePoints =
    standings.length >= advancementCounts.dcmp
      ? (standings[advancementCounts.dcmp - 1]?.pointTotal ?? null)
      : (standings[standings.length - 1]?.pointTotal ?? null);
  const currentWorldsLinePoints =
    standings.length >= advancementCounts.cmp
      ? (standings[advancementCounts.cmp - 1]?.pointTotal ?? null)
      : (standings[standings.length - 1]?.pointTotal ?? null);

  const seasonRemainingTopTierAwards = seasonEvents.reduce(
    (totals, event) => ({
      impact: totals.impact + event.remainingTopTierAwards.impact,
      engineeringInspiration:
        totals.engineeringInspiration + event.remainingTopTierAwards.engineeringInspiration,
      rookieAllStar: totals.rookieAllStar + event.remainingTopTierAwards.rookieAllStar,
    }),
    {
      impact: 0,
      engineeringInspiration: 0,
      rookieAllStar: 0,
    },
  );

  const currentEventSummary =
    seasonEvents.find((event) => event.eventKey === loadedEventKey) ?? null;
  const currentEventOfficialTotal = loadedTeamStanding?.eventPoints.find(
    (eventPoints) => eventPoints.eventKey === loadedEventKey,
  );
  const loadedEventMultiplier =
    currentEventOfficialTotal?.districtCmp || currentEventSummary?.districtCmp ? 3 : 1;
  const loadedTeamSeason = loadedTeamStanding
    ? {
        rookieBonus: loadedTeamStanding.rookieBonus,
        currentOfficialTotal: loadedTeamStanding.pointTotal,
        totalExcludingLoadedEvent: Math.max(
          0,
          loadedTeamStanding.pointTotal -
            safeInteger(currentEventOfficialTotal?.total) * loadedEventMultiplier,
        ),
        currentRank: loadedTeamStanding.rank,
        officialDcmpQualified: loadedTeamStanding.officialDcmpQualified,
        officialCmpQualified: loadedTeamStanding.officialCmpQualified,
      }
    : null;

  const currentEventAggregate =
    currentEventSummary ??
    ({
      awardedOfficialPoints: currentEventOfficialRows.reduce(
        (total, row) => total + totalPointsFromBreakdown(row.officialPoints),
        0,
      ),
      awardedPerformancePoints: currentEventOfficialRows.reduce(
        (total, row) =>
          total +
          safeInteger(row.officialPoints.qualPoints) +
          safeInteger(row.officialPoints.alliancePoints) +
          safeInteger(row.officialPoints.elimPoints),
        0,
      ),
      remainingPerformanceCeiling: Math.max(
        0,
        eventPerformancePointsCeiling(
          eventRows.length,
          captainCountForTeamCount(eventRows.length),
        ) -
          currentEventOfficialRows.reduce(
            (total, row) =>
              total +
              safeInteger(row.officialPoints.qualPoints) +
              safeInteger(row.officialPoints.alliancePoints) +
              safeInteger(row.officialPoints.elimPoints),
            0,
          ),
      ),
      remainingTopTierAwardPoints:
        loadedEventAwardSummary.remainingCounts.impact * 10 +
        loadedEventAwardSummary.remainingCounts.engineeringInspiration * 8 +
        loadedEventAwardSummary.remainingCounts.rookieAllStar * 8,
      remainingTopTierAwards: loadedEventAwardSummary.remainingCounts,
    } as Pick<
      DistrictEventSummary,
      | 'awardedOfficialPoints'
      | 'awardedPerformancePoints'
      | 'remainingPerformanceCeiling'
      | 'remainingTopTierAwardPoints'
      | 'remainingTopTierAwards'
    >);

  return {
    snapshot: {
      generatedAtMs: Date.now(),
      applicable: true,
      reason: null,
      districtKey: FIT_DISTRICT_KEY,
      districtName: FIT_DISTRICT_NAME,
      loadedEventKey,
      loadedTeam: parsedLoadedTeam,
      loadedEventIsFitDistrict: true,
      advancementCounts,
      standings,
      loadedTeamStanding,
      advancement,
      season: {
        currentDcmpLinePoints,
        currentWorldsLinePoints,
        pointsRemainingDistrictCeiling: seasonEvents.reduce(
          (total, event) =>
            total + event.remainingPerformanceCeiling + event.remainingTopTierAwardPoints,
          0,
        ),
        remainingTopTierAwards: seasonRemainingTopTierAwards,
        events: seasonEvents,
      },
      loadedTeamSeason,
      currentEvent: {
        event: eventContext?.tba.event ?? null,
        teamCount: eventRows.length,
        districtCmp: currentEventSummary?.districtCmp ?? false,
        eventRows,
        officialRows: currentEventOfficialRows,
        awardedOfficialPoints: currentEventAggregate.awardedOfficialPoints,
        awardedPerformancePoints: currentEventAggregate.awardedPerformancePoints,
        remainingPerformanceCeiling: currentEventAggregate.remainingPerformanceCeiling,
        remainingTopTierAwardPoints: currentEventAggregate.remainingTopTierAwardPoints,
        remainingTopTierAwards: currentEventAggregate.remainingTopTierAwards,
      },
    },
    standings,
    loadedTeamStanding,
    eventContext,
    eventRosterMap,
    teamMetaMap,
    statboticsYearMap,
    currentEventOfficialMap,
    currentEventRows: eventRows,
    dcmpEventKey,
  };
}

export async function loadFitDistrictSnapshot(
  eventKey: string,
  loadedTeam: number | null,
): Promise<DistrictSnapshotResponse> {
  const context = await buildFitDistrictContext(eventKey, loadedTeam);
  return context.snapshot;
}

export async function simulateFitDistrictEvent(
  eventKey: string,
  loadedTeam: number | null,
  runs = 800,
): Promise<DistrictEventProjection> {
  const context = await buildFitDistrictContext(eventKey, loadedTeam);
  const snapshot = context.snapshot;
  if (!snapshot.applicable || !snapshot.currentEvent) {
    throw new Error(snapshot.reason ?? 'District points are not available for this event.');
  }
  const currentEvent = snapshot.currentEvent;

  const runCount = Math.max(50, Math.min(5000, Math.floor(Number(runs) || 800)));
  const standingsMap = new Map(context.standings.map((row) => [row.teamKey, row]));
  const eventRowMap = new Map(snapshot.currentEvent.eventRows.map((row) => [row.teamKey, row]));
  const officialAwardMap = new Map(
    snapshot.currentEvent.officialRows.map((row) => [row.teamKey, row.officialPoints.awardPoints]),
  );
  const teamKeys = snapshot.currentEvent.eventRows.map((row) => row.teamKey);
  const simTeams = buildSimTeamList(
    teamKeys,
    standingsMap,
    context.teamMetaMap,
    context.statboticsYearMap,
    eventRowMap,
    officialAwardMap,
  );

  const perTeam = new Map<
    string,
    { qual: number[]; alliance: number[]; elim: number[]; performance: number[]; total: number[] }
  >();
  for (const team of simTeams) {
    perTeam.set(team.teamKey, {
      qual: [],
      alliance: [],
      elim: [],
      performance: [],
      total: [],
    });
  }

  const eventStatus =
    snapshot.season.events.find((event) => event.eventKey === snapshot.loadedEventKey)?.status ??
    'future';
  const officialOnly =
    eventStatus === 'complete' &&
    currentEvent.officialRows.length >= currentEvent.teamCount &&
    currentEvent.teamCount > 0;

  for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
    const results = officialOnly
      ? new Map(
          snapshot.currentEvent.officialRows.map((row) => [
            row.teamKey,
            {
              teamKey: row.teamKey,
              qualPoints: row.officialPoints.qualPoints,
              alliancePoints: row.officialPoints.alliancePoints,
              elimPoints: row.officialPoints.elimPoints,
            },
          ]),
        )
      : simulateApproximateDistrictEvent(simTeams);

    for (const team of simTeams) {
      const existing = perTeam.get(team.teamKey);
      if (!existing) continue;
      const result = results.get(team.teamKey);
      const qualPoints = safeInteger(result?.qualPoints);
      const alliancePoints = safeInteger(result?.alliancePoints);
      const elimPoints = safeInteger(result?.elimPoints);
      const awardPoints = officialAwardMap.get(team.teamKey) ?? 0;
      const performancePoints = qualPoints + alliancePoints + elimPoints;
      existing.qual.push(qualPoints);
      existing.alliance.push(alliancePoints);
      existing.elim.push(elimPoints);
      existing.performance.push(performancePoints);
      existing.total.push(performancePoints + awardPoints);
    }
  }

  const rows: DistrictEventProjectionRow[] = simTeams
    .map((team) => {
      const sample = perTeam.get(team.teamKey);
      const officialRow = context.currentEventOfficialMap.get(team.teamKey) ?? null;
      const qual = sample?.qual ?? [];
      const alliance = sample?.alliance ?? [];
      const elim = sample?.elim ?? [];
      const performance = sample?.performance ?? [];
      const total = sample?.total ?? [];
      return {
        teamKey: team.teamKey,
        teamNumber: team.teamNumber,
        nickname: team.nickname,
        officialEventPoints: officialRow?.officialPoints.eventPoints ?? null,
        officialAwardPoints: officialAwardMap.get(team.teamKey) ?? 0,
        qualP5: quantile(qual, 0.05) ?? 0,
        qualP50: quantile(qual, 0.5) ?? 0,
        qualP95: quantile(qual, 0.95) ?? 0,
        allianceP5: quantile(alliance, 0.05) ?? 0,
        allianceP50: quantile(alliance, 0.5) ?? 0,
        allianceP95: quantile(alliance, 0.95) ?? 0,
        elimP5: quantile(elim, 0.05) ?? 0,
        elimP50: quantile(elim, 0.5) ?? 0,
        elimP95: quantile(elim, 0.95) ?? 0,
        performanceMin: performance.length ? Math.min(...performance) : 0,
        performanceMedian: quantile(performance, 0.5) ?? 0,
        performanceMax: performance.length ? Math.max(...performance) : 0,
        totalP5: quantile(total, 0.05) ?? 0,
        totalP50: quantile(total, 0.5) ?? 0,
        totalP95: quantile(total, 0.95) ?? 0,
        maxWithRemainingTopTier:
          (total.length ? Math.max(...total) : 0) + currentEvent.remainingTopTierAwardPoints,
      } satisfies DistrictEventProjectionRow;
    })
    .sort((left, right) => right.totalP50 - left.totalP50);

  const loadedTeamKey = loadedTeam != null ? tbaTeamKey(loadedTeam) : '';
  const loadedTeamValues = loadedTeamKey ? (perTeam.get(loadedTeamKey)?.total ?? []) : [];
  const multiplier = currentEvent.districtCmp ? 3 : 1;
  const loadedTeamMedian = quantile(loadedTeamValues, 0.5);
  const loadedTeamBest = loadedTeamValues.length ? Math.max(...loadedTeamValues) : null;
  const seasonBase = snapshot.loadedTeamSeason?.totalExcludingLoadedEvent ?? null;

  return {
    generatedAtMs: Date.now(),
    mode: 'event',
    runs: officialOnly ? 1 : runCount,
    rows,
    loadedTeamHistogram: buildHistogram(loadedTeamValues, 12),
    loadedTeamSummary:
      loadedTeam != null && loadedTeamValues.length
        ? {
            teamNumber: loadedTeam,
            min: Math.min(...loadedTeamValues),
            median: loadedTeamMedian ?? 0,
            max: Math.max(...loadedTeamValues),
            p5: quantile(loadedTeamValues, 0.05) ?? 0,
            p95: quantile(loadedTeamValues, 0.95) ?? 0,
            seasonIfMedianApplied:
              seasonBase != null && loadedTeamMedian != null
                ? seasonBase + loadedTeamMedian * multiplier
                : null,
            seasonIfBestApplied:
              seasonBase != null && loadedTeamBest != null
                ? seasonBase + loadedTeamBest * multiplier
                : null,
            dcmpGapAtMedian:
              seasonBase != null &&
              loadedTeamMedian != null &&
              snapshot.season.currentDcmpLinePoints != null
                ? seasonBase + loadedTeamMedian * multiplier - snapshot.season.currentDcmpLinePoints
                : null,
            worldsGapAtMedian:
              seasonBase != null &&
              loadedTeamMedian != null &&
              snapshot.season.currentWorldsLinePoints != null
                ? seasonBase +
                  loadedTeamMedian * multiplier -
                  snapshot.season.currentWorldsLinePoints
                : null,
          }
        : null,
  };
}

export async function simulateFitDistrictSeason(
  eventKey: string,
  loadedTeam: number | null,
  runs = 800,
): Promise<DistrictSeasonProjection> {
  const context = await buildFitDistrictContext(eventKey, loadedTeam);
  const snapshot = context.snapshot;
  if (!snapshot.applicable) {
    throw new Error(snapshot.reason ?? 'District points are not available for this event.');
  }

  const runCount = Math.max(50, Math.min(5000, Math.floor(Number(runs) || 800)));
  const standings = context.standings;
  const standingsMap = new Map(standings.map((row) => [row.teamKey, row]));
  const eventRowMap = new Map(context.currentEventRows.map((row) => [row.teamKey, row]));
  const regularEvents = snapshot.season.events.filter((event) => !event.districtCmp);
  const dcmpEvent = snapshot.season.events.find((event) => event.districtCmp) ?? null;
  const currentDcmpLinePoints = snapshot.season.currentDcmpLinePoints;
  const currentWorldsLinePoints = snapshot.season.currentWorldsLinePoints;

  const finalTotalsByTeam = new Map<string, number[]>();
  const dcmpQualifiedByTeam = new Map<string, number>();
  const worldsQualifiedByTeam = new Map<string, number>();
  const regularCutoffs: number[] = [];
  const worldsCutoffs: number[] = [];
  for (const standing of standings) {
    finalTotalsByTeam.set(standing.teamKey, []);
    dcmpQualifiedByTeam.set(standing.teamKey, 0);
    worldsQualifiedByTeam.set(standing.teamKey, 0);
  }

  for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
    const simulatedRegularEventResults = new Map<string, number[]>();

    for (const event of regularEvents) {
      if (event.status === 'complete') continue;
      const roster = context.eventRosterMap.get(event.eventKey) ?? [];
      const eventSpecificAwardMap =
        event.eventKey === snapshot.loadedEventKey
          ? new Map(
              snapshot.currentEvent?.officialRows.map((row) => [
                row.teamKey,
                row.officialPoints.awardPoints,
              ]) ?? [],
            )
          : new Map<string, number>();
      const simTeams = buildSimTeamList(
        roster,
        standingsMap,
        context.teamMetaMap,
        context.statboticsYearMap,
        eventRowMap,
        eventSpecificAwardMap,
      );
      if (!simTeams.length) continue;
      const results = simulateApproximateDistrictEvent(simTeams);
      for (const team of simTeams) {
        const result = results.get(team.teamKey);
        if (!result) continue;
        const eventPoints =
          safeInteger(result.qualPoints) +
          safeInteger(result.alliancePoints) +
          safeInteger(result.elimPoints) +
          safeInteger(team.officialAwardPoints);
        const existing = simulatedRegularEventResults.get(team.teamKey) ?? [];
        existing.push(eventPoints);
        simulatedRegularEventResults.set(team.teamKey, existing);
      }
    }

    const regularTotalsByTeam = new Map<string, number>();
    for (const standing of standings) {
      const totals = [
        ...standing.eventPoints
          .filter((eventPoints) => !eventPoints.districtCmp)
          .map((eventPoints) => eventPoints.total),
        ...(simulatedRegularEventResults.get(standing.teamKey) ?? []),
      ];
      const regularTotal =
        bestTwoRegularEventTotal(totals) +
        safeInteger(standing.rookieBonus) +
        safeInteger(standing.adjustments);
      regularTotalsByTeam.set(standing.teamKey, regularTotal);
    }

    const autoDcmpTeams = new Set(
      standings
        .filter((standing) => standing.officialDcmpQualified || standing.hasOfficialDcmpResult)
        .map((standing) => standing.teamKey),
    );
    const dcmpSlotsRemaining = Math.max(0, snapshot.advancementCounts.dcmp - autoDcmpTeams.size);
    const dcmpCandidates = standings
      .filter((standing) => !autoDcmpTeams.has(standing.teamKey))
      .sort((left, right) => {
        const totalDelta =
          safeInteger(regularTotalsByTeam.get(right.teamKey)) -
          safeInteger(regularTotalsByTeam.get(left.teamKey));
        if (totalDelta !== 0) return totalDelta;
        return safeInteger(right.teamNumber) - safeInteger(left.teamNumber);
      });
    const selectedDcmpTeams = new Set([
      ...autoDcmpTeams,
      ...dcmpCandidates.slice(0, dcmpSlotsRemaining).map((standing) => standing.teamKey),
    ]);
    const dcmpQualifiedTotals = Array.from(selectedDcmpTeams.values()).map(
      (teamKey) => regularTotalsByTeam.get(teamKey) ?? 0,
    );
    if (dcmpQualifiedTotals.length) {
      regularCutoffs.push(Math.min(...dcmpQualifiedTotals));
    }
    for (const teamKey of selectedDcmpTeams) {
      dcmpQualifiedByTeam.set(teamKey, (dcmpQualifiedByTeam.get(teamKey) ?? 0) + 1);
    }

    let simulatedDcmpResults = new Map<string, number>();
    const dcmpNeedsSimulation =
      dcmpEvent &&
      dcmpEvent.status !== 'complete' &&
      selectedDcmpTeams.size > 0 &&
      Array.from(selectedDcmpTeams.values()).some(
        (teamKey) => !standingsMap.get(teamKey)?.hasOfficialDcmpResult,
      );

    if (dcmpNeedsSimulation) {
      const dcmpTeamList = buildSimTeamList(
        Array.from(selectedDcmpTeams.values()),
        standingsMap,
        context.teamMetaMap,
        context.statboticsYearMap,
        eventRowMap,
      );
      const dcmpResults = simulateApproximateDistrictEvent(dcmpTeamList);
      simulatedDcmpResults = new Map(
        Array.from(dcmpResults.entries()).map(([teamKey, result]) => [
          teamKey,
          safeInteger(result.qualPoints) +
            safeInteger(result.alliancePoints) +
            safeInteger(result.elimPoints),
        ]),
      );
    }

    const finalTotals = new Map<string, number>();
    for (const standing of standings) {
      const regularTotal = regularTotalsByTeam.get(standing.teamKey) ?? 0;
      const officialDcmpRaw =
        standing.eventPoints.find((eventPoints) => eventPoints.districtCmp)?.total ?? null;
      let finalTotal = regularTotal;
      if (officialDcmpRaw != null) {
        finalTotal += officialDcmpRaw * 3;
      } else if (selectedDcmpTeams.has(standing.teamKey)) {
        finalTotal += (simulatedDcmpResults.get(standing.teamKey) ?? 0) * 3;
      }
      finalTotals.set(standing.teamKey, finalTotal);
      finalTotalsByTeam.get(standing.teamKey)?.push(finalTotal);
    }

    const autoWorldsTeams = new Set(
      standings
        .filter((standing) => standing.officialCmpQualified)
        .map((standing) => standing.teamKey),
    );
    const worldsSlotsRemaining = Math.max(0, snapshot.advancementCounts.cmp - autoWorldsTeams.size);
    const worldsCandidates = standings
      .filter((standing) => !autoWorldsTeams.has(standing.teamKey))
      .sort((left, right) => {
        const totalDelta =
          safeInteger(finalTotals.get(right.teamKey)) - safeInteger(finalTotals.get(left.teamKey));
        if (totalDelta !== 0) return totalDelta;
        return safeInteger(right.teamNumber) - safeInteger(left.teamNumber);
      });
    const selectedWorldsTeams = new Set([
      ...autoWorldsTeams,
      ...worldsCandidates.slice(0, worldsSlotsRemaining).map((standing) => standing.teamKey),
    ]);
    const worldsQualifiedTotals = Array.from(selectedWorldsTeams.values()).map(
      (teamKey) => finalTotals.get(teamKey) ?? 0,
    );
    if (worldsQualifiedTotals.length) {
      worldsCutoffs.push(Math.min(...worldsQualifiedTotals));
    }
    for (const teamKey of selectedWorldsTeams) {
      worldsQualifiedByTeam.set(teamKey, (worldsQualifiedByTeam.get(teamKey) ?? 0) + 1);
    }
  }

  const regularFloorByTeam = new Map<string, number>();
  const regularCeilingByTeam = new Map<string, number>();
  for (const standing of standings) {
    const completedRegularTotals = standing.eventPoints
      .filter((eventPoints) => !eventPoints.districtCmp)
      .map((eventPoints) => eventPoints.total);
    const regularFloor =
      bestTwoRegularEventTotal(completedRegularTotals) +
      safeInteger(standing.rookieBonus) +
      safeInteger(standing.adjustments);
    const regularCeiling =
      bestTwoRegularEventTotal([
        ...completedRegularTotals,
        ...standing.remainingRegularEvents.map(() => MAX_SINGLE_EVENT_DISTRICT_POINTS),
      ]) +
      safeInteger(standing.rookieBonus) +
      safeInteger(standing.adjustments);

    regularFloorByTeam.set(standing.teamKey, regularFloor);
    regularCeilingByTeam.set(standing.teamKey, regularCeiling);
  }

  const dcmpStatusByTeam = new Map<string, DistrictLockStatus>();
  for (const standing of standings) {
    const regularCeiling = regularCeilingByTeam.get(standing.teamKey) ?? standing.pointTotal;
    dcmpStatusByTeam.set(
      standing.teamKey,
      standing.hasOfficialDcmpResult
        ? 'LOCKED'
        : !standing.officialDcmpQualified &&
            currentDcmpLinePoints != null &&
            regularCeiling < currentDcmpLinePoints
          ? 'ELIMINATED'
          : districtStatusFromBounds({
              teamKey: standing.teamKey,
              slotCount: snapshot.advancementCounts.dcmp,
              floorsByTeam: regularFloorByTeam,
              ceilingsByTeam: regularCeilingByTeam,
              automatic: standing.officialDcmpQualified,
            }),
    );
  }

  const finalFloorByTeam = new Map<string, number>();
  const finalCeilingByTeam = new Map<string, number>();
  for (const standing of standings) {
    const officialDcmpRaw =
      standing.eventPoints.find((eventPoints) => eventPoints.districtCmp)?.total ?? null;
    const regularCeiling = regularCeilingByTeam.get(standing.teamKey) ?? standing.pointTotal;
    const canStillReachDcmp =
      standing.officialDcmpQualified ||
      standing.hasOfficialDcmpResult ||
      dcmpStatusByTeam.get(standing.teamKey) !== 'ELIMINATED';
    const lineReachable =
      currentDcmpLinePoints == null ? true : regularCeiling >= currentDcmpLinePoints;

    finalFloorByTeam.set(standing.teamKey, standing.pointTotal);
    finalCeilingByTeam.set(
      standing.teamKey,
      officialDcmpRaw != null
        ? regularCeiling + officialDcmpRaw * 3
        : canStillReachDcmp && lineReachable
          ? regularCeiling + MAX_SINGLE_EVENT_DISTRICT_POINTS * 3
          : regularCeiling,
    );
  }

  const worldsStatusByTeam = new Map<string, DistrictLockStatus>();
  for (const standing of standings) {
    const finalCeiling = finalCeilingByTeam.get(standing.teamKey) ?? standing.pointTotal;
    worldsStatusByTeam.set(
      standing.teamKey,
      !standing.officialCmpQualified &&
        currentWorldsLinePoints != null &&
        finalCeiling < currentWorldsLinePoints
        ? 'ELIMINATED'
        : districtStatusFromBounds({
            teamKey: standing.teamKey,
            slotCount: snapshot.advancementCounts.cmp,
            floorsByTeam: finalFloorByTeam,
            ceilingsByTeam: finalCeilingByTeam,
            automatic: standing.officialCmpQualified,
          }),
    );
  }

  const rows: DistrictSeasonTeamRow[] = standings
    .map((standing) => {
      const totals = finalTotalsByTeam.get(standing.teamKey) ?? [];
      const dcmpProbability =
        (dcmpQualifiedByTeam.get(standing.teamKey) ?? 0) / Math.max(1, runCount);
      const worldsProbability =
        (worldsQualifiedByTeam.get(standing.teamKey) ?? 0) / Math.max(1, runCount);
      const autoReason = standing.officialCmpQualified
        ? 'Official Worlds advancement'
        : standing.officialDcmpQualified
          ? 'Official DCMP advancement'
          : standing.hasOfficialDcmpResult
            ? 'Official DCMP result already recorded'
            : null;

      return {
        teamKey: standing.teamKey,
        teamNumber: standing.teamNumber,
        nickname: standing.nickname,
        officialRank: standing.rank,
        currentTotal: standing.pointTotal,
        rookieBonus: standing.rookieBonus,
        playedEvents: standing.playedRegularEvents.length,
        remainingEvents: standing.remainingRegularEvents.length,
        p5Total: quantile(totals, 0.05) ?? standing.pointTotal,
        p50Total: quantile(totals, 0.5) ?? standing.pointTotal,
        p95Total: quantile(totals, 0.95) ?? standing.pointTotal,
        minTotal: totals.length ? Math.min(...totals) : standing.pointTotal,
        maxTotal: totals.length ? Math.max(...totals) : standing.pointTotal,
        dcmpProbability,
        worldsProbability,
        dcmpStatus: dcmpStatusByTeam.get(standing.teamKey) ?? 'BUBBLE',
        worldsStatus: worldsStatusByTeam.get(standing.teamKey) ?? 'BUBBLE',
        autoReason,
      } satisfies DistrictSeasonTeamRow;
    })
    .sort((left, right) => {
      const worldsDelta = right.worldsProbability - left.worldsProbability;
      if (worldsDelta !== 0) return worldsDelta;
      const dcmpDelta = right.dcmpProbability - left.dcmpProbability;
      if (dcmpDelta !== 0) return dcmpDelta;
      return right.p50Total - left.p50Total;
    });

  const loadedTeamKey = loadedTeam != null ? tbaTeamKey(loadedTeam) : '';
  const loadedTeamValues = loadedTeamKey ? (finalTotalsByTeam.get(loadedTeamKey) ?? []) : [];
  const loadedRow = rows.find((row) => row.teamKey === loadedTeamKey) ?? null;
  const dcmpCutoff = summarizeCutoff(regularCutoffs);
  const worldsCutoff = summarizeCutoff(worldsCutoffs);

  return {
    generatedAtMs: Date.now(),
    mode: 'season',
    runs: runCount,
    rows,
    dcmpCutoff,
    worldsCutoff,
    loadedTeamHistogram: buildHistogram(loadedTeamValues, 12),
    loadedTeamSummary:
      loadedRow && loadedTeam != null
        ? {
            teamNumber: loadedTeam,
            currentTotal: loadedRow.currentTotal,
            p5Total: loadedRow.p5Total,
            p50Total: loadedRow.p50Total,
            p95Total: loadedRow.p95Total,
            dcmpProbability: loadedRow.dcmpProbability,
            worldsProbability: loadedRow.worldsProbability,
            dcmpGapToMedianCutoff:
              dcmpCutoff.p50 != null ? loadedRow.p50Total - dcmpCutoff.p50 : null,
            worldsGapToMedianCutoff:
              worldsCutoff.p50 != null ? loadedRow.p50Total - worldsCutoff.p50 : null,
            dcmpStatus: loadedRow.dcmpStatus,
            worldsStatus: loadedRow.worldsStatus,
          }
        : null,
  };
}

export function parseDistrictSimulationRequest(body: unknown): z.infer<typeof simulateRouteSchema> {
  return simulateRouteSchema.parse(body);
}
