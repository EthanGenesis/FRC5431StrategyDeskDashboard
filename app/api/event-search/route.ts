import type { NextResponse } from 'next/server';

import { getAppEnv } from '../../../lib/env';
import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { tbaGet } from '../../../lib/tba';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TbaEventSearchRow = {
  key?: unknown;
  name?: unknown;
  short_name?: unknown;
  city?: unknown;
  state_prov?: unknown;
  country?: unknown;
};

type EventSearchOption = {
  key: string;
  name: string;
  shortName: string;
  location: string;
};

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSearchToken(value: string): string {
  return readString(value).toLowerCase();
}

function eventSearchText(row: EventSearchOption): string {
  return [row.key, row.name, row.shortName, row.location]
    .map(normalizeSearchToken)
    .filter(Boolean)
    .join(' ');
}

function eventLocation(row: TbaEventSearchRow): string {
  const city = readString(row.city);
  const state = readString(row.state_prov);
  const country = readString(row.country);
  return [city, state, country].filter(Boolean).join(', ');
}

export async function GET(
  req: Request,
): Promise<
  NextResponse<
    | { error: string }
    | { generatedAtMs: number; year: number; query: string; events: EventSearchOption[] }
  >
> {
  const routeContext = beginRouteRequest('/api/event-search', req);

  try {
    const { searchParams } = new URL(req.url);
    const query = readString(searchParams.get('query'));
    const teamNumber = Number(searchParams.get('team') ?? '');
    const year = 2026;
    const limit = 24;
    const { TBA_AUTH_KEY } = getAppEnv();

    const hasTeamScope = Number.isFinite(teamNumber) && teamNumber > 0;

    if (!query && !hasTeamScope) {
      return routeJson(routeContext, {
        generatedAtMs: Date.now(),
        year,
        query: '',
        events: [],
      });
    }

    const rows = await tbaGet<TbaEventSearchRow[]>(
      hasTeamScope
        ? `/team/frc${Math.floor(teamNumber)}/events/${year}/simple`
        : `/events/${year}/simple`,
      TBA_AUTH_KEY,
    );
    const normalizedQuery = normalizeSearchToken(query);
    const events = (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const key = readString(row.key);
        const name = readString(row.name);
        const shortName = readString(row.short_name) || name;
        const location = eventLocation(row);
        if (!key || !name) return null;
        return {
          key,
          name,
          shortName,
          location,
        };
      })
      .filter((row): row is EventSearchOption => row != null)
      .filter((row) => !normalizedQuery || eventSearchText(row).includes(normalizedQuery))
      .sort((a, b) => {
        const aStarts =
          a.key.startsWith(normalizedQuery) ||
          normalizeSearchToken(a.name).startsWith(normalizedQuery);
        const bStarts =
          b.key.startsWith(normalizedQuery) ||
          normalizeSearchToken(b.name).startsWith(normalizedQuery);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.key.localeCompare(b.key);
      })
      .slice(0, limit);

    return routeJson(routeContext, {
      generatedAtMs: Date.now(),
      year,
      query,
      events,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown event search error';
    const status = message === 'Missing TBA_AUTH_KEY in .env.local' ? 500 : 400;
    return routeErrorJson(routeContext, message, status);
  }
}
