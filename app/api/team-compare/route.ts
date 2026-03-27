import { NextResponse } from 'next/server';
import type { ExternalArray, ExternalRecord, TeamCompareSnapshot } from '../../../lib/types';
import {
  attachRollingEventMetrics,
  buildCompareDerivedMetrics,
  buildEventFieldAverages,
  buildEventTeamRowsFromContext,
  buildHistoricalEventRows,
  normalizeEventMatches,
  normalizeSeasonMatches,
} from '../../../lib/analytics';
import {
  buildSeasonRollups,
  normalizeSeasonSummary,
  splitSeasonEvents,
  TEAM_PROFILE_YEAR,
} from '../../../lib/teamProfileData';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { sbGet } from '../../../lib/statbotics';
import { loadEventContext, parseCompareTeams } from '../../../lib/server-data';
import { tbaTeamKey } from '../../../lib/logic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function extractName(value: unknown): string | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string'
  ) {
    return value.name;
  }

  return null;
}

function eventKeyValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function buildResponse(
  routeContext: ReturnType<typeof beginRouteRequest>,
  rawTeams: unknown,
  eventKey: string,
): Promise<NextResponse<TeamCompareSnapshot | { error: string }>> {
  const teams = parseCompareTeams(rawTeams);
  if (!teams.length) {
    return NextResponse.json({ error: 'Missing teams' }, { status: 400 });
  }

  const eventContext = eventKey ? await loadEventContext(eventKey) : null;
  const eventRows = eventContext ? buildEventTeamRowsFromContext(eventContext) : [];
  const fieldAverages = eventContext ? buildEventFieldAverages(eventRows) : null;
  const eventRowMap = new Map<string, (typeof eventRows)[number]>();
  for (const row of eventRows) {
    eventRowMap.set(String(row.teamKey), row);
  }

  const compareTeams = await Promise.all(
    teams.map(async (teamNumber) => {
      const [summary, seasonSummaryRaw, teamEventsRaw, teamMatchesRaw] = await Promise.all([
        sbGet(`/team/${teamNumber}`).catch(() => null),
        sbGet(`/team_year/${teamNumber}/${TEAM_PROFILE_YEAR}`).catch(() => null),
        sbGet(
          `/team_events?team=${teamNumber}&year=${TEAM_PROFILE_YEAR}&limit=1000&offset=0`,
        ).catch(() => []),
        sbGet(
          `/team_matches?team=${teamNumber}&year=${TEAM_PROFILE_YEAR}&limit=1000&offset=0`,
        ).catch(() => []),
      ]);

      const { seasonRows, playedEvents, upcomingEvents, teamEventsByKey } = splitSeasonEvents(
        Array.isArray(teamEventsRaw) ? (teamEventsRaw as ExternalArray) : [],
      );
      const seasonSummary = normalizeSeasonSummary(
        (summary as ExternalRecord | null) ?? null,
        (seasonSummaryRaw as ExternalRecord | null) ?? null,
      );
      const seasonMatches = normalizeSeasonMatches(
        teamNumber,
        Array.isArray(teamMatchesRaw) ? (teamMatchesRaw as ExternalArray) : [],
        teamEventsByKey,
        eventKey,
      );
      const teamKey = tbaTeamKey(teamNumber);
      const eventRow = eventRowMap.get(teamKey) ?? null;
      const rawEventMatches = eventContext
        ? normalizeEventMatches(
            eventContext.tba.matches ?? [],
            eventContext.sb.matches ?? [],
            teamKey,
          )
        : [];
      const eventMatches = eventContext
        ? attachRollingEventMetrics(teamKey, rawEventMatches, eventContext.tba.matches ?? [])
        : [];
      const seasonRollups = buildSeasonRollups(
        playedEvents,
        upcomingEvents,
        seasonMatches,
        seasonSummary,
      );
      const historicalPlayedEvents = playedEvents.filter(
        (row) => !eventKey || String(row?.event ?? '') !== eventKey,
      );
      const historicalUpcomingEvents = upcomingEvents.filter(
        (row) => !eventKey || String(row?.event ?? '') !== eventKey,
      );
      const historicalSeasonEvents = seasonRows.filter(
        (row) => !eventKey || String(row?.event ?? '') !== eventKey,
      );
      const historicalMatches = seasonMatches.filter(
        (row) => !eventKey || eventKeyValue(row?.eventKey) !== eventKey,
      );
      const derived = buildCompareDerivedMetrics({
        seasonSummary,
        seasonRollups,
        playedEvents,
        upcomingEvents,
        seasonMatches,
        historicalEvents: buildHistoricalEventRows(playedEvents, upcomingEvents, eventKey),
        historicalMatches,
        eventRow,
        eventMatches,
        fieldAverages,
      });

      return {
        teamNumber,
        teamKey,
        nickname:
          eventRow?.nickname ?? seasonSummary?.name ?? extractName(summary) ?? String(teamNumber),
        seasonSummary,
        seasonRollups,
        seasonEvents: seasonRows,
        playedEvents,
        upcomingEvents,
        seasonMatches,
        historicalSeasonEvents,
        historicalPlayedEvents,
        historicalUpcomingEvents,
        historicalMatches,
        eventRow,
        eventMatches,
        derived,
      };
    }),
  );

  return routeJson(
    routeContext,
    {
      generatedAtMs: Date.now(),
      eventKey: eventKey || null,
      event: eventContext?.tba.event ?? null,
      fieldAverages,
      teams: compareTeams,
    },
    undefined,
    {
      eventKey: eventKey || null,
      teamCount: compareTeams.length,
    },
  );
}

export async function GET(
  req: Request,
): Promise<NextResponse<TeamCompareSnapshot | { error: string }>> {
  const routeContext = beginRouteRequest('/api/team-compare:GET', req);
  const { searchParams } = new URL(req.url);

  try {
    return await buildResponse(
      routeContext,
      searchParams.get('teams') ?? '',
      searchParams.get('eventKey')?.trim() ?? '',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown compare error';
    return routeErrorJson(routeContext, message, 500);
  }
}

export async function POST(
  req: Request,
): Promise<NextResponse<TeamCompareSnapshot | { error: string }>> {
  const routeContext = beginRouteRequest('/api/team-compare:POST', req);
  try {
    const body = (await req.json().catch(() => ({}))) as {
      teams?: unknown;
      eventKey?: string;
    };

    return await buildResponse(routeContext, body.teams ?? [], String(body.eventKey ?? '').trim());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown compare error';
    return routeErrorJson(routeContext, message, 500);
  }
}
