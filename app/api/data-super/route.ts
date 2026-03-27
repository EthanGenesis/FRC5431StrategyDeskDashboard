import type { NextResponse } from 'next/server';
import type {
  CompareTeamRow,
  DataSuperSnapshot,
  ExternalArray,
  ExternalRecord,
  TeamCompareSnapshot,
} from '../../../lib/types';
import type { LoadedEventContext } from '../../../lib/server-data';
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
import { tbaTeamKey } from '../../../lib/logic';
import { loadEventContext, parseCompareTeams, safeResolve } from '../../../lib/server-data';

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

async function buildCompareTeams(
  teamNumbers: number[],
  eventKey: string,
  eventContext: LoadedEventContext | null,
  fieldAverages: Record<string, number | null> | null,
): Promise<CompareTeamRow[]> {
  const eventRows = eventContext ? buildEventTeamRowsFromContext(eventContext) : [];
  const eventRowMap = new Map<string, (typeof eventRows)[number]>();
  for (const row of eventRows) {
    eventRowMap.set(String(row.teamKey), row);
  }

  return Promise.all(
    teamNumbers.map(async (teamNumber) => {
      const [summary, seasonSummaryRaw, teamEventsRaw, teamMatchesRaw] = await Promise.all([
        safeResolve(sbGet<ExternalRecord>(`/team/${teamNumber}`)),
        safeResolve(sbGet<ExternalRecord>(`/team_year/${teamNumber}/${TEAM_PROFILE_YEAR}`)),
        safeResolve(
          sbGet<ExternalArray>(
            `/team_events?team=${teamNumber}&year=${TEAM_PROFILE_YEAR}&limit=1000&offset=0`,
          ),
        ),
        safeResolve(
          sbGet<ExternalArray>(
            `/team_matches?team=${teamNumber}&year=${TEAM_PROFILE_YEAR}&limit=1000&offset=0`,
          ),
        ),
      ]);

      const { seasonRows, playedEvents, upcomingEvents, teamEventsByKey } = splitSeasonEvents(
        Array.isArray(teamEventsRaw) ? teamEventsRaw : [],
      );
      const seasonSummary = normalizeSeasonSummary(summary ?? null, seasonSummaryRaw ?? null);
      const seasonMatches = normalizeSeasonMatches(
        teamNumber,
        Array.isArray(teamMatchesRaw) ? teamMatchesRaw : [],
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
      const historicalSeasonEvents = seasonRows.filter(
        (row) => !eventKey || eventKeyValue(row?.event) !== eventKey,
      );
      const historicalPlayedEvents = playedEvents.filter(
        (row) => !eventKey || eventKeyValue(row?.event) !== eventKey,
      );
      const historicalUpcomingEvents = upcomingEvents.filter(
        (row) => !eventKey || eventKeyValue(row?.event) !== eventKey,
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
}

async function buildHistoricalTeam(
  teamNumber: number,
  eventKey: string,
  eventContext: LoadedEventContext | null,
  fieldAverages: Record<string, number | null> | null,
): Promise<CompareTeamRow | null> {
  const rows = await buildCompareTeams([teamNumber], eventKey, eventContext, fieldAverages);
  return rows[0] ?? null;
}

type DataSuperRequest = {
  eventKey?: unknown;
  loadedTeam?: unknown;
  compareTeams?: unknown;
};

async function buildResponse(
  routeContext: ReturnType<typeof beginRouteRequest>,
  body: DataSuperRequest,
): Promise<NextResponse<DataSuperSnapshot | { error: string }>> {
  const loadedEventKey = typeof body.eventKey === 'string' ? body.eventKey.trim() : '';
  const rawLoadedTeam = Number(body.loadedTeam ?? 0);
  const loadedTeam =
    Number.isFinite(rawLoadedTeam) && rawLoadedTeam > 0 ? Math.floor(rawLoadedTeam) : null;
  const compareTeams = parseCompareTeams(body.compareTeams ?? []);

  const eventContext = loadedEventKey ? await loadEventContext(loadedEventKey) : null;
  const eventRows = eventContext ? buildEventTeamRowsFromContext(eventContext) : [];
  const fieldAverages = eventContext ? buildEventFieldAverages(eventRows) : null;
  const historicalTeam =
    loadedTeam != null
      ? await buildHistoricalTeam(loadedTeam, loadedEventKey, eventContext, fieldAverages)
      : null;
  const compare: TeamCompareSnapshot | null = compareTeams.length
    ? {
        generatedAtMs: Date.now(),
        eventKey: loadedEventKey || null,
        event: eventContext?.tba.event ?? null,
        fieldAverages,
        teams: await buildCompareTeams(compareTeams, loadedEventKey, eventContext, fieldAverages),
      }
    : null;

  return routeJson(
    routeContext,
    {
      generatedAtMs: Date.now(),
      loadedEventKey: loadedEventKey || null,
      loadedTeam,
      currentEvent: eventContext
        ? {
            event: eventContext.tba.event ?? null,
            eventRows,
            fieldAverages,
            matches: eventContext.tba.matches ?? [],
            insights: eventContext.tba.insights ?? null,
            rankings: eventContext.tba.rankings ?? null,
            alliances: eventContext.tba.alliances ?? null,
            status: eventContext.tba.status ?? null,
            awards: eventContext.tba.awards ?? null,
          }
        : null,
      historicalTeam,
      compare,
      diagnostics: {
        eventTeamCount: eventRows.length,
        tbaMatchCount: eventContext?.tba.matches?.length ?? 0,
        sbMatchCount: eventContext?.sb.matches?.length ?? 0,
        sbTeamEventCount: eventContext?.sb.teamEvents?.length ?? 0,
        compareTeamCount: compare?.teams?.length ?? 0,
        generatedAtMs: Date.now(),
      },
      rawPayloads: {
        tba: eventContext?.tba ?? null,
        sb: eventContext?.sb ?? null,
        historicalTeam,
      },
    },
    undefined,
    {
      loadedEventKey: loadedEventKey || null,
      loadedTeam,
      compareTeamCount: compare?.teams.length ?? 0,
    },
  );
}

export async function POST(
  req: Request,
): Promise<NextResponse<DataSuperSnapshot | { error: string }>> {
  const routeContext = beginRouteRequest('/api/data-super:POST', req);
  try {
    const body = (await req.json().catch(() => ({}))) as DataSuperRequest;
    return await buildResponse(routeContext, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown data-super error';
    const status = message === 'Missing TBA_AUTH_KEY in .env.local' ? 500 : 400;
    return routeErrorJson(routeContext, message, status);
  }
}

export async function GET(
  req: Request,
): Promise<NextResponse<DataSuperSnapshot | { error: string }>> {
  const routeContext = beginRouteRequest('/api/data-super:GET', req);
  try {
    const { searchParams } = new URL(req.url);
    return await buildResponse(routeContext, {
      eventKey: searchParams.get('eventKey') ?? '',
      loadedTeam: searchParams.get('loadedTeam') ?? '',
      compareTeams: searchParams.get('compareTeams') ?? '',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown data-super error';
    const status = message === 'Missing TBA_AUTH_KEY in .env.local' ? 500 : 400;
    return routeErrorJson(routeContext, message, status);
  }
}
