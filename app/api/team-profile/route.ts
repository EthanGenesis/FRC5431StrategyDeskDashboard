import type { NextResponse } from 'next/server';
import type { ExternalArray, ExternalRecord, MatchSimple } from '../../../lib/types';
import { ZodError } from 'zod';
import type {
  TeamProfileCurrentEvent,
  TeamProfileMatch,
  TeamProfileRouteResponse,
} from '../../../lib/strategy-types';
import {
  attachRollingEventMetrics,
  buildCompareDerivedMetrics,
  buildEventFieldAverages,
  buildEventTeamRowsFromContext,
  buildHistoricalEventRows,
  normalizeEventMatches,
} from '../../../lib/analytics';
import { getAppEnv } from '../../../lib/env';
import { formatMatchLabel, tbaTeamKey } from '../../../lib/logic';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import {
  loadEventContext,
  parsePositiveTeamNumber,
  parseRequiredEventKey,
  safeResolve,
} from '../../../lib/server-data';
import { sbGet } from '../../../lib/statbotics';
import {
  buildSeasonRollups,
  normalizeSeasonSummary,
  splitSeasonEvents,
  TEAM_PROFILE_YEAR,
} from '../../../lib/teamProfileData';
import { tbaGet } from '../../../lib/tba';
import { loadSnapshotCacheRecord, saveSnapshotCacheRecord } from '../../../lib/source-cache-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const WARM_TEAM_PROFILE_MAX_AGE_SECONDS = 90;

type SbMatchBreakdown = {
  auto_points?: unknown;
  teleop_points?: unknown;
  endgame_points?: unknown;
  [key: string]: unknown;
};

type SbTeamMatchRow = Record<string, unknown> & {
  match?: string;
  event?: string;
  year?: number;
  time?: number;
  elim?: boolean;
  alliance?: string;
  status?: string | null;
  dq?: boolean;
  surrogate?: boolean;
  week?: number;
  winner?: string;
  red_score?: unknown;
  blue_score?: unknown;
  epa?: {
    total_points?: unknown;
    post?: unknown;
    breakdown?: SbMatchBreakdown | null;
  } | null;
};

type TeamEventRow = Record<string, unknown> & {
  event?: string;
  event_name?: string;
  week?: number;
  time?: number;
};

function matchPlayed(match: MatchSimple): boolean {
  const red = match.alliances.red.score;
  const blue = match.alliances.blue.score;
  const hasScore = typeof red === 'number' && typeof blue === 'number' && red >= 0 && blue >= 0;
  return hasScore || match.actual_time != null || match.post_result_time != null;
}

function resultForTeam(match: MatchSimple, teamKey: string): TeamProfileMatch['result'] {
  const winningAlliance = match.winning_alliance ?? '';
  if (winningAlliance === '') {
    const redScore = match.alliances.red.score;
    const blueScore = match.alliances.blue.score;
    if (typeof redScore === 'number' && typeof blueScore === 'number') {
      if (redScore === blueScore) {
        return 'tie';
      }

      const teamOnRed = match.alliances.red.team_keys.includes(teamKey);
      if (teamOnRed) {
        return redScore > blueScore ? 'win' : 'loss';
      }

      return blueScore > redScore ? 'win' : 'loss';
    }

    return 'unknown';
  }

  const teamOnRed = match.alliances.red.team_keys.includes(teamKey);
  if (teamOnRed) {
    return winningAlliance === 'red' ? 'win' : 'loss';
  }

  return winningAlliance === 'blue' ? 'win' : 'loss';
}

function safeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asAlliance(value: unknown): 'red' | 'blue' | null {
  return value === 'red' || value === 'blue' ? value : null;
}

export async function GET(
  req: Request,
): Promise<NextResponse<TeamProfileRouteResponse | { error: string }>> {
  const routeContext = beginRouteRequest('/api/team-profile', req);
  const { searchParams } = new URL(req.url);

  try {
    const team = parsePositiveTeamNumber(searchParams.get('team') ?? '');
    const summaryOnly = searchParams.get('summaryOnly') === '1';
    const loadedEventKeyParam = searchParams.get('eventKey')?.trim() ?? '';
    const loadedEventKey = loadedEventKeyParam ? parseRequiredEventKey(loadedEventKeyParam) : '';
    const cacheSource = summaryOnly ? 'team_profile_summary' : 'team_profile';
    const cachedPayload = await loadSnapshotCacheRecord<TeamProfileRouteResponse>(
      cacheSource,
      loadedEventKey || null,
      team,
      WARM_TEAM_PROFILE_MAX_AGE_SECONDS,
    );
    if (cachedPayload) {
      return routeJson(routeContext, cachedPayload, undefined, {
        team,
        loadedEventKey: loadedEventKey || null,
        summaryOnly,
        cacheState: 'warm',
        source: 'warm_cache',
      });
    }
    const teamKey = tbaTeamKey(team);
    const { TBA_AUTH_KEY } = getAppEnv();

    const [summary, seasonSummaryRaw, teamEventsRaw, teamMatchesRaw, loadedEventContext] =
      await Promise.all([
        safeResolve(sbGet(`/team/${team}`)),
        safeResolve(sbGet(`/team_year/${team}/${TEAM_PROFILE_YEAR}`)),
        safeResolve(
          sbGet(`/team_events?team=${team}&year=${TEAM_PROFILE_YEAR}&limit=1000&offset=0`),
        ),
        summaryOnly
          ? Promise.resolve([])
          : safeResolve(
              sbGet(`/team_matches?team=${team}&year=${TEAM_PROFILE_YEAR}&limit=1000&offset=0`),
            ),
        summaryOnly || !loadedEventKey ? Promise.resolve(null) : loadEventContext(loadedEventKey),
      ]);
    const rawSummary = (summary ?? null) as ExternalRecord | null;
    const rawSeasonSummary = (seasonSummaryRaw ?? null) as ExternalRecord | null;
    const rawTeamEvents = (Array.isArray(teamEventsRaw) ? teamEventsRaw : []) as ExternalArray;
    const rawTeamMatches = (Array.isArray(teamMatchesRaw) ? teamMatchesRaw : []) as ExternalArray;

    const { seasonRows, playedEvents, upcomingEvents, teamEventsByKey } =
      splitSeasonEvents(rawTeamEvents);
    const seasonSummary = normalizeSeasonSummary(rawSummary, rawSeasonSummary);

    if (summaryOnly) {
      const seasonRollups = buildSeasonRollups(playedEvents, upcomingEvents, [], seasonSummary);
      const payload = {
        generatedAtMs: Date.now(),
        team,
        summary: rawSummary,
        seasonSummary,
        seasonRollups,
        playedEvents,
        upcomingEvents,
        teamEventsByKey,
        matches: [],
        loadedEventKey: loadedEventKey || null,
        seasonEvents: seasonRows,
        currentEvent: null,
        historical2026: {
          seasonEvents: seasonRows.filter(
            (row) => !loadedEventKey || String(row?.event ?? '') !== loadedEventKey,
          ),
          playedEvents: playedEvents.filter(
            (row) => !loadedEventKey || String(row?.event ?? '') !== loadedEventKey,
          ),
          upcomingEvents: upcomingEvents.filter(
            (row) => !loadedEventKey || String(row?.event ?? '') !== loadedEventKey,
          ),
          matches: [],
        },
      } satisfies TeamProfileRouteResponse;

      void saveSnapshotCacheRecord({
        source: cacheSource,
        eventKey: loadedEventKey || null,
        teamNumber: team,
        generatedAt: payload.generatedAtMs,
        payload,
      });

      return routeJson(routeContext, payload, undefined, {
        team,
        loadedEventKey: loadedEventKey || null,
        summaryOnly: true,
        cacheState: 'cold',
      });
    }

    const teamMatches2026 = rawTeamMatches
      .filter(
        (row): row is SbTeamMatchRow => Number((row as SbTeamMatchRow)?.year) === TEAM_PROFILE_YEAR,
      )
      .sort((a, b) => Number(b.time ?? 0) - Number(a.time ?? 0));
    const playedEventKeys = playedEvents.map((row) => String(row.event ?? '')).filter(Boolean);
    const tbaMatchesByEvent = new Map<string, MatchSimple[]>();

    await Promise.all(
      playedEventKeys.map(async (eventKey) => {
        const matches = await safeResolve(
          tbaGet<MatchSimple[]>(`/team/${teamKey}/event/${eventKey}/matches/simple`, TBA_AUTH_KEY),
        );
        if (Array.isArray(matches)) {
          tbaMatchesByEvent.set(eventKey, matches);
        }
      }),
    );

    const sbMatchMap = new Map<string, SbTeamMatchRow>();
    for (const item of teamMatches2026) {
      const key = typeof item.match === 'string' ? item.match : '';
      if (key) {
        sbMatchMap.set(key, item);
      }
    }

    const matchMap = new Map<string, TeamProfileMatch>();
    for (const eventKey of playedEventKeys) {
      const eventRow = (playedEvents.find((row) => String(row.event ?? '') === eventKey) ??
        null) as TeamEventRow | null;
      const eventMatches = tbaMatchesByEvent.get(eventKey) ?? [];

      for (const match of eventMatches) {
        if (!matchPlayed(match)) {
          continue;
        }

        const onRed = match.alliances.red.team_keys.includes(teamKey);
        const onBlue = match.alliances.blue.team_keys.includes(teamKey);
        if (!onRed && !onBlue) {
          continue;
        }

        const alliance: 'red' | 'blue' = onRed ? 'red' : 'blue';
        const partners =
          alliance === 'red'
            ? match.alliances.red.team_keys.filter((key) => key !== teamKey)
            : match.alliances.blue.team_keys.filter((key) => key !== teamKey);
        const opponents =
          alliance === 'red' ? match.alliances.blue.team_keys : match.alliances.red.team_keys;
        const sbMatch = sbMatchMap.get(match.key) ?? null;
        const myScore =
          alliance === 'red'
            ? safeNumber(match.alliances.red.score)
            : safeNumber(match.alliances.blue.score);
        const oppScore =
          alliance === 'red'
            ? safeNumber(match.alliances.blue.score)
            : safeNumber(match.alliances.red.score);

        matchMap.set(match.key, {
          key: match.key,
          eventKey,
          eventName: typeof eventRow?.event_name === 'string' ? eventRow.event_name : eventKey,
          matchLabel: formatMatchLabel(match),
          compLevel: match.comp_level ?? '',
          time: match.actual_time ?? match.post_result_time ?? match.predicted_time ?? match.time,
          played: true,
          elim: match.comp_level !== 'qm',
          alliance,
          partners,
          opponents,
          result: resultForTeam(match, teamKey),
          myScore,
          oppScore,
          margin: myScore != null && oppScore != null ? myScore - oppScore : null,
          redScore:
            typeof match.alliances.red.score === 'number' ? match.alliances.red.score : null,
          blueScore:
            typeof match.alliances.blue.score === 'number' ? match.alliances.blue.score : null,
          winningAlliance: match.winning_alliance ?? null,
          epaTotal: safeNumber(sbMatch?.epa?.total_points),
          epaPost: safeNumber(sbMatch?.epa?.post),
          breakdown: sbMatch?.epa?.breakdown ?? null,
          week: safeNumber(sbMatch?.week ?? eventRow?.week),
          status: asNullableString(sbMatch?.status) ?? 'Completed',
          dq: Boolean(sbMatch?.dq),
          surrogate: Boolean(sbMatch?.surrogate),
          sb: sbMatch,
          tba: match as unknown as Record<string, unknown>,
        });
      }
    }

    for (const row of teamMatches2026) {
      const matchKey = typeof row.match === 'string' ? row.match : '';
      const eventKey = typeof row.event === 'string' ? row.event : '';
      if (!matchKey || !eventKey || matchMap.has(matchKey) || !playedEventKeys.includes(eventKey)) {
        continue;
      }

      const eventRow = (playedEvents.find((event) => String(event.event ?? '') === eventKey) ??
        null) as TeamEventRow | null;

      matchMap.set(matchKey, {
        key: matchKey,
        eventKey,
        eventName: typeof eventRow?.event_name === 'string' ? eventRow.event_name : eventKey,
        matchLabel: matchKey,
        compLevel: row.elim ? 'playoff' : 'qm',
        time: typeof row.time === 'number' ? row.time : null,
        played: String(row.status ?? '').toLowerCase() !== 'upcoming',
        elim: Boolean(row.elim),
        alliance: asAlliance(row.alliance),
        partners: [],
        opponents: [],
        result: 'unknown',
        myScore: null,
        oppScore: null,
        margin: null,
        redScore: null,
        blueScore: null,
        winningAlliance: null,
        epaTotal: safeNumber(row.epa?.total_points),
        epaPost: safeNumber(row.epa?.post),
        breakdown: row.epa?.breakdown ?? null,
        week: safeNumber(row.week ?? eventRow?.week),
        status: asNullableString(row.status),
        dq: Boolean(row.dq),
        surrogate: Boolean(row.surrogate),
        sb: row,
        tba: null,
      });
    }

    const matches = [...matchMap.values()]
      .filter((row) => row.played)
      .sort((a, b) => Number(b.time ?? 0) - Number(a.time ?? 0));
    const seasonRollups = buildSeasonRollups(
      playedEvents,
      upcomingEvents,
      matches as unknown as ExternalRecord[],
      seasonSummary,
    );
    const historicalPlayedEvents = playedEvents.filter(
      (row) => !loadedEventKey || String(row.event ?? '') !== loadedEventKey,
    );
    const historicalUpcomingEvents = upcomingEvents.filter(
      (row) => !loadedEventKey || String(row.event ?? '') !== loadedEventKey,
    );
    const historicalMatches = matches.filter(
      (row) => !loadedEventKey || String(row.eventKey) !== loadedEventKey,
    );

    let currentEvent: TeamProfileCurrentEvent | null = null;
    if (loadedEventContext && loadedEventKey) {
      const eventRows = buildEventTeamRowsFromContext(loadedEventContext);
      const fieldAverages = buildEventFieldAverages(eventRows);
      const eventRow = eventRows.find((row) => row.teamKey === teamKey) ?? null;
      const rawEventMatches = normalizeEventMatches(
        loadedEventContext.tba.matches ?? [],
        loadedEventContext.sb.matches ?? [],
        teamKey,
      );
      const eventMatches = attachRollingEventMetrics(
        teamKey,
        rawEventMatches,
        loadedEventContext.tba.matches ?? [],
      );
      const derived = buildCompareDerivedMetrics({
        seasonSummary,
        seasonRollups,
        playedEvents,
        upcomingEvents,
        seasonMatches: matches,
        historicalEvents: buildHistoricalEventRows(playedEvents, upcomingEvents, loadedEventKey),
        historicalMatches,
        eventRow,
        eventMatches,
        fieldAverages,
      });

      currentEvent = {
        eventKey: loadedEventKey,
        event: loadedEventContext.tba.event ?? null,
        fieldAverages,
        eventRow: (eventRow as unknown as Record<string, unknown>) ?? null,
        eventMatches,
        eventStatusHtml: asNullableString(derived?.eventStatusHtml),
        eventStatusText: asNullableString(derived?.eventStatus),
        derived,
      };
    }

    const payload = {
      generatedAtMs: Date.now(),
      team,
      loadedEventKey: loadedEventKey || null,
      summary: rawSummary,
      seasonSummary,
      seasonRollups,
      playedEvents,
      upcomingEvents,
      teamEventsByKey,
      matches,
      seasonEvents: seasonRows,
      currentEvent,
      historical2026: {
        seasonEvents: seasonRows.filter(
          (row) => !loadedEventKey || String(row?.event ?? '') !== loadedEventKey,
        ),
        playedEvents: historicalPlayedEvents,
        upcomingEvents: historicalUpcomingEvents,
        matches: historicalMatches,
      },
    } satisfies TeamProfileRouteResponse;

    void saveSnapshotCacheRecord({
      source: cacheSource,
      eventKey: loadedEventKey || null,
      teamNumber: team,
      generatedAt: payload.generatedAtMs,
      payload,
    });

    return routeJson(routeContext, payload, undefined, {
      team,
      loadedEventKey: loadedEventKey || null,
      summaryOnly: false,
      matchCount: matches.length,
      cacheState: 'cold',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown team-profile error';
    const status =
      message === 'Missing TBA_AUTH_KEY in .env.local'
        ? 500
        : error instanceof ZodError || message.includes('invalid') || message.includes('Expected')
          ? 400
          : 500;
    return routeErrorJson(
      routeContext,
      status === 400 ? 'Missing or invalid team' : message,
      status,
    );
  }
}
