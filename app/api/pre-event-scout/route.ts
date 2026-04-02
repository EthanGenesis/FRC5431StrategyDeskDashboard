import type { NextResponse } from 'next/server';
import type { ExternalRecord } from '../../../lib/types';
import type { PreEventScoutResponse } from '../../../lib/strategy-types';
import { getAppEnv } from '../../../lib/env';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { loadSnapshotCacheRecord, saveSnapshotCacheRecord } from '../../../lib/source-cache-server';
import { safeResolve, parseRequiredEventKey } from '../../../lib/server-data';
import {
  buildSeasonRollups,
  normalizeSeasonSummary,
  splitSeasonEvents,
  TEAM_PROFILE_YEAR,
} from '../../../lib/teamProfileData';
import { sbGet } from '../../../lib/statbotics';
import { tbaGet } from '../../../lib/tba';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const WARM_PRE_EVENT_SCOUT_MAX_AGE_SECONDS = 300;

type TbaTeamSimple = {
  team_number?: number;
  nickname?: string;
  name?: string;
};

export async function GET(
  req: Request,
): Promise<NextResponse<PreEventScoutResponse | { error: string }>> {
  const routeContext = beginRouteRequest('/api/pre-event-scout', req);
  const { searchParams } = new URL(req.url);

  try {
    const eventKey = parseRequiredEventKey(searchParams.get('eventKey') ?? '');
    const cachedPayload = await loadSnapshotCacheRecord<PreEventScoutResponse>(
      'pre_event_scout',
      eventKey,
      null,
      WARM_PRE_EVENT_SCOUT_MAX_AGE_SECONDS,
    );
    if (cachedPayload) {
      return routeJson(routeContext, cachedPayload, undefined, {
        eventKey,
        cacheState: 'warm',
        source: 'warm_cache',
      });
    }
    const { TBA_AUTH_KEY } = getAppEnv();

    const [event, tbaTeams] = await Promise.all([
      safeResolve(tbaGet(`/event/${eventKey}`, TBA_AUTH_KEY)),
      safeResolve(tbaGet(`/event/${eventKey}/teams/simple`, TBA_AUTH_KEY)),
    ]);

    const teams = Array.isArray(tbaTeams) ? (tbaTeams as TbaTeamSimple[]) : [];
    const seasonTeams = await Promise.all(
      teams.map(async (team) => {
        const teamNumber = Number(team?.team_number ?? 0);
        const teamKey = `frc${teamNumber}`;
        const [summary, seasonSummaryRaw, teamEventsRaw] = await Promise.all([
          safeResolve(sbGet(`/team/${teamNumber}`)),
          safeResolve(sbGet(`/team_year/${teamNumber}/${TEAM_PROFILE_YEAR}`)),
          safeResolve(
            sbGet(`/team_events?team=${teamNumber}&year=${TEAM_PROFILE_YEAR}&limit=1000&offset=0`),
          ),
        ]);

        const { playedEvents, upcomingEvents } = splitSeasonEvents(
          Array.isArray(teamEventsRaw) ? (teamEventsRaw as ExternalRecord[]) : [],
        );
        const seasonSummary = normalizeSeasonSummary(
          (summary as ExternalRecord | null) ?? null,
          (seasonSummaryRaw as ExternalRecord | null) ?? null,
        );
        const seasonRollups = buildSeasonRollups(playedEvents, upcomingEvents, [], seasonSummary);

        return {
          teamNumber,
          teamKey,
          nickname:
            typeof team?.nickname === 'string'
              ? team.nickname
              : typeof team?.name === 'string'
                ? team.name
                : (seasonSummary?.name ?? String(teamNumber)),
          seasonSummary,
          seasonRollups,
          playedEvents,
          upcomingEvents,
        };
      }),
    );

    const payload = {
      generatedAtMs: Date.now(),
      eventKey,
      event: (event as ExternalRecord | null) ?? null,
      teams: seasonTeams,
    } satisfies PreEventScoutResponse;

    void saveSnapshotCacheRecord({
      source: 'pre_event_scout',
      eventKey,
      teamNumber: null,
      generatedAt: payload.generatedAtMs,
      payload,
    });

    return routeJson(routeContext, payload, undefined, {
      eventKey,
      teamCount: seasonTeams.length,
      cacheState: 'cold',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown pre-event scout error';
    const status = message === 'Missing TBA_AUTH_KEY in .env.local' ? 500 : 400;
    return routeErrorJson(routeContext, message, status);
  }
}
