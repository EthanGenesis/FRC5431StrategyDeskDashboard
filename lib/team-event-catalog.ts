import { getAppEnv } from './env';
import {
  ACTIVE_TARGET_SEASON_YEAR,
  normalizeTeamEventCatalog,
  type TeamEventCatalogEntry,
} from './shared-target';
import { tbaGet } from './tba';

type TbaEventSearchRow = {
  key?: unknown;
  name?: unknown;
  short_name?: unknown;
  city?: unknown;
  state_prov?: unknown;
  country?: unknown;
  start_date?: unknown;
  end_date?: unknown;
};

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSearchToken(value: string): string {
  return readString(value).toLowerCase();
}

function eventLocation(row: TbaEventSearchRow): string {
  const city = readString(row.city);
  const state = readString(row.state_prov);
  const country = readString(row.country);
  return [city, state, country].filter(Boolean).join(', ');
}

function eventSearchText(row: TeamEventCatalogEntry): string {
  return [row.key, row.name, row.shortName, row.location]
    .map(normalizeSearchToken)
    .filter(Boolean)
    .join(' ');
}

export async function fetchTeamEventCatalog(
  teamNumber: number,
  year: number = ACTIVE_TARGET_SEASON_YEAR,
): Promise<TeamEventCatalogEntry[]> {
  const normalizedTeam = Math.floor(Number(teamNumber));
  if (!Number.isFinite(normalizedTeam) || normalizedTeam <= 0) {
    return [];
  }

  const { TBA_AUTH_KEY } = getAppEnv();
  const rows = await tbaGet<TbaEventSearchRow[]>(
    `/team/frc${normalizedTeam}/events/${year}/simple`,
    TBA_AUTH_KEY,
  );

  return normalizeTeamEventCatalog(
    (Array.isArray(rows) ? rows : []).map((row) => ({
      key: readString(row.key),
      name: readString(row.name),
      shortName: readString(row.short_name) || readString(row.name),
      location: eventLocation(row),
      startDate: readString(row.start_date) || null,
      endDate: readString(row.end_date) || null,
    })),
  ).sort((a, b) => {
    const aDate = a.startDate ?? '9999-99-99';
    const bDate = b.startDate ?? '9999-99-99';
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    return a.key.localeCompare(b.key);
  });
}

export function filterTeamEventCatalog(
  events: TeamEventCatalogEntry[],
  query: string,
  limit = 24,
): TeamEventCatalogEntry[] {
  const normalizedQuery = normalizeSearchToken(query);
  return events
    .filter((row) => !normalizedQuery || eventSearchText(row).includes(normalizedQuery))
    .sort((a, b) => {
      const aStarts =
        a.key.startsWith(normalizedQuery) ||
        normalizeSearchToken(a.name).startsWith(normalizedQuery);
      const bStarts =
        b.key.startsWith(normalizedQuery) ||
        normalizeSearchToken(b.name).startsWith(normalizedQuery);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      if ((a.startDate ?? '') !== (b.startDate ?? '')) {
        return (a.startDate ?? '').localeCompare(b.startDate ?? '');
      }
      return a.key.localeCompare(b.key);
    })
    .slice(0, limit);
}
