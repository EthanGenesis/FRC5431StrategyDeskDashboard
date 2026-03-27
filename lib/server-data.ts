import { z } from 'zod';
import type { AppSnapshot, ExternalArray, ExternalRecord, MatchSimple } from './types';
import { getAppEnv } from './env';
import { sbGet } from './statbotics';
import { tbaGet } from './tba';

export type LoadedEventContext = {
  tba: AppSnapshot['tba'];
  sb: AppSnapshot['sb'];
};

const teamParamSchema = z.coerce.number().int().positive();
const eventKeySchema = z.string().trim().min(1);

const compareTeamsSchema = z
  .union([z.array(z.coerce.number().int().positive()), z.string(), z.null(), z.undefined()])
  .transform((value) => normalizeTeamList(value));

export function safeResolve<T>(promise: Promise<T>): Promise<T | null> {
  return promise.catch(() => null);
}

export function parsePositiveTeamNumber(value: unknown): number {
  return teamParamSchema.parse(value);
}

export function parseRequiredEventKey(value: unknown): string {
  return eventKeySchema.parse(value);
}

export function normalizeTeamList(rawTeams: unknown): number[] {
  const list = Array.isArray(rawTeams)
    ? rawTeams
    : typeof rawTeams === 'string'
      ? rawTeams.split(/[,\s]+/).filter(Boolean)
      : [];

  return Array.from(
    new Set(
      list
        .map((value) => Math.floor(Number(value)))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  );
}

export function parseCompareTeams(value: unknown): number[] {
  return compareTeamsSchema.parse(value);
}

export async function loadEventContext(eventKey: string): Promise<LoadedEventContext> {
  const { TBA_AUTH_KEY } = getAppEnv();

  const [
    event,
    matches,
    rankings,
    oprs,
    alliances,
    status,
    insights,
    awards,
    teams,
    teamStatuses,
    sbMatches,
    sbTeamEvents,
    sbTeamMatches,
  ] = await Promise.all([
    safeResolve(tbaGet<ExternalRecord>(`/event/${eventKey}`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<MatchSimple[]>(`/event/${eventKey}/matches`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalRecord>(`/event/${eventKey}/rankings`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalRecord>(`/event/${eventKey}/oprs`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalRecord>(`/event/${eventKey}/alliances`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalRecord>(`/event/${eventKey}/status`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalRecord>(`/event/${eventKey}/insights`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalRecord>(`/event/${eventKey}/awards`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalArray>(`/event/${eventKey}/teams/simple`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalRecord>(`/event/${eventKey}/teams/statuses`, TBA_AUTH_KEY)),
    safeResolve(
      sbGet<ExternalArray>(`/matches?event=${encodeURIComponent(eventKey)}&limit=1000&offset=0`),
    ),
    safeResolve(
      sbGet<ExternalArray>(
        `/team_events?event=${encodeURIComponent(eventKey)}&limit=1000&offset=0`,
      ),
    ),
    safeResolve(
      sbGet<ExternalArray>(
        `/team_matches?event=${encodeURIComponent(eventKey)}&limit=1000&offset=0`,
      ),
    ),
  ]);

  return {
    tba: {
      event: event ?? null,
      matches: matches ?? [],
      rankings: rankings ?? null,
      oprs: oprs ?? null,
      alliances: alliances ?? null,
      status: status ?? null,
      insights: insights ?? null,
      awards: awards ?? null,
      teams: teams ?? [],
      teamStatuses: teamStatuses ?? null,
    },
    sb: {
      matches: sbMatches ?? [],
      teamEvents: sbTeamEvents ?? [],
      teamMatches: sbTeamMatches ?? [],
    },
  };
}
