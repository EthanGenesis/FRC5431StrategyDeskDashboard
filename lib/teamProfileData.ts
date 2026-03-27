import type { ExternalArray, ExternalRecord } from './types';

export const TEAM_PROFILE_YEAR = 2026;

type SeasonSummary = {
  team: number | null;
  year: number;
  name: string;
  country: string;
  state: string;
  district: unknown;
  rookie_year: number | null;
  active: boolean;
  last_active_year: number;
  record: ExternalRecord | null;
  epa: ExternalRecord | null;
  norm_epa: ExternalRecord | null;
  district_points: number | null;
  district_rank: number | null;
  competing: unknown;
};

type TeamEventRow = ExternalRecord & {
  event?: string;
  year?: number;
  status?: string;
  time?: number;
  epa?: {
    norm?: number;
  };
  record?: {
    qual?: {
      count?: number;
      wins?: number;
      losses?: number;
      ties?: number;
    };
    elim?: {
      count?: number;
      wins?: number;
      losses?: number;
      ties?: number;
    };
  };
};

type MatchBreakdown = {
  auto_points?: number;
  teleop_points?: number;
  endgame_points?: number;
};

type TeamMatchRow = ExternalRecord & {
  played?: boolean;
  epaTotal?: number | null;
  breakdown?: MatchBreakdown | null;
};

function safeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asExternalRecord(value: unknown): ExternalRecord | null {
  return typeof value === 'object' && value !== null ? (value as ExternalRecord) : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function mean(values: number[]): number | null {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function normalizeSeasonSummary(
  baseSummary: ExternalRecord | null,
  seasonSummary: ExternalRecord | null,
): SeasonSummary {
  return {
    team: safeNumber(seasonSummary?.team ?? baseSummary?.team),
    year: TEAM_PROFILE_YEAR,
    name: asString(seasonSummary?.name ?? baseSummary?.name),
    country: asString(seasonSummary?.country ?? baseSummary?.country),
    state: asString(seasonSummary?.state ?? baseSummary?.state),
    district: seasonSummary?.district ?? baseSummary?.district ?? null,
    rookie_year: safeNumber(seasonSummary?.rookie_year ?? baseSummary?.rookie_year),
    active: Boolean(baseSummary?.active ?? true),
    last_active_year: safeNumber(baseSummary?.last_active_year) ?? TEAM_PROFILE_YEAR,
    record: asExternalRecord(seasonSummary?.record ?? baseSummary?.record),
    epa: asExternalRecord(seasonSummary?.epa),
    norm_epa: asExternalRecord(baseSummary?.norm_epa),
    district_points: safeNumber(seasonSummary?.district_points),
    district_rank: safeNumber(seasonSummary?.district_rank),
    competing: seasonSummary?.competing ?? null,
  };
}

export function splitSeasonEvents(rows: ExternalArray) {
  const seasonRows = rows
    .filter((row): row is TeamEventRow => Number(row?.year) === TEAM_PROFILE_YEAR)
    .sort((a, b) => Number(a?.time ?? 0) - Number(b?.time ?? 0));

  const playedEvents = seasonRows
    .filter((row) => String(row?.status ?? '').toLowerCase() !== 'upcoming')
    .sort((a, b) => Number(b?.time ?? 0) - Number(a?.time ?? 0));

  const upcomingEvents = seasonRows
    .filter((row) => String(row?.status ?? '').toLowerCase() === 'upcoming')
    .sort((a, b) => Number(a?.time ?? 0) - Number(b?.time ?? 0));

  const teamEventsByKey = Object.fromEntries(
    seasonRows.map((row) => [String(row?.event ?? ''), row]),
  ) as Record<string, TeamEventRow>;

  return {
    seasonRows,
    playedEvents,
    upcomingEvents,
    teamEventsByKey,
  };
}

export function buildSeasonRollups(
  playedEvents: TeamEventRow[],
  upcomingEvents: TeamEventRow[],
  matches: TeamMatchRow[] = [],
  seasonSummary: SeasonSummary | null = null,
) {
  let qualMatchCount = 0;
  let playoffMatchCount = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const eventRow of playedEvents) {
    const qual = eventRow?.record?.qual ?? {};
    const elim = eventRow?.record?.elim ?? {};
    qualMatchCount += Number(qual?.count ?? 0);
    playoffMatchCount += Number(elim?.count ?? 0);
    wins += Number(qual?.wins ?? 0) + Number(elim?.wins ?? 0);
    losses += Number(qual?.losses ?? 0) + Number(elim?.losses ?? 0);
    ties += Number(qual?.ties ?? 0) + Number(elim?.ties ?? 0);
  }

  const totalMatchCount =
    qualMatchCount + playoffMatchCount || Number(seasonSummary?.record?.count ?? 0);
  const winRate =
    totalMatchCount > 0 ? wins / totalMatchCount : safeNumber(seasonSummary?.record?.winrate);
  const playedMatchRows = matches.filter((row) => row?.played !== false);

  return {
    playedEventCount: playedEvents.length,
    upcomingEventCount: upcomingEvents.length,
    totalMatchCount,
    qualMatchCount,
    playoffMatchCount,
    wins,
    losses,
    ties,
    winRate,
    avgEventEpa: mean(
      playedEvents
        .map((row) => safeNumber(row?.epa?.norm))
        .filter((value): value is number => value != null),
    ),
    avgMatchEpa: mean(
      playedMatchRows
        .map((row) => safeNumber(row?.epaTotal))
        .filter((value): value is number => value != null),
    ),
    avgAutoPoints: mean(
      playedMatchRows
        .map((row) => safeNumber(row?.breakdown?.auto_points))
        .filter((value): value is number => value != null),
    ),
    avgTeleopPoints: mean(
      playedMatchRows
        .map((row) => safeNumber(row?.breakdown?.teleop_points))
        .filter((value): value is number => value != null),
    ),
    avgEndgamePoints: mean(
      playedMatchRows
        .map((row) => safeNumber(row?.breakdown?.endgame_points))
        .filter((value): value is number => value != null),
    ),
  };
}
