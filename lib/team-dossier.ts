import type { TeamProfileRouteResponse, TeamProfileMatch } from './strategy-types';
import type { TeamDossierResponse, TeamDossierRoleMetric } from './types';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

function nestedNumber(source: unknown, ...path: string[]): number | null {
  let current: unknown = source;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return null;
    current = record[key];
  }
  const parsed = Number(current);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringField(source: unknown, key: string, fallback = ''): string {
  const record = asRecord(source);
  if (!record) return fallback;
  const value = record[key];
  return typeof value === 'string' ? value : fallback;
}

function numericValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[]): number | null {
  if (!values.length) return null;
  const avg = mean(values);
  if (avg == null) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function topMatches(matches: TeamProfileMatch[]): TeamProfileMatch[] {
  return [...matches]
    .sort((left, right) => {
      const rightScore = Math.abs(Number(right.margin ?? 0)) + Number(right.epaTotal ?? 0);
      const leftScore = Math.abs(Number(left.margin ?? 0)) + Number(left.epaTotal ?? 0);
      return rightScore - leftScore;
    })
    .slice(0, 5);
}

type HistoricalEventSummaryRow = {
  eventKey: string;
  eventName: string;
  totalMatches: number;
  winRate: number | null;
  avgMargin: number | null;
  avgEpa: number | null;
  rank: number | null;
  lastMatchTimeMs: number | null;
  insight: string;
};

function eventInsight(row: { winRate: number | null; avgMargin: number | null }): string {
  if (row.winRate == null) return 'No complete previous-event summary yet.';
  if (row.winRate >= 0.7) return 'Strong previous-event signal worth carrying forward.';
  if (row.winRate <= 0.35)
    return 'Bounce-back candidate; scout what changed from this rougher event.';
  if ((row.avgMargin ?? 0) >= 12) return 'Positive event margin suggests sturdy match control.';
  if ((row.avgMargin ?? 0) <= -12) return 'Margins stayed under pressure; matchup details matter.';
  return 'Mixed event results; scout the exact matchups that drove the swing.';
}

function buildHistoricalEventRows(profile: TeamProfileRouteResponse): HistoricalEventSummaryRow[] {
  const historicalMatches = (profile.historical2026?.matches ?? []).filter((match) => match.played);
  const playedEventRows = profile.historical2026?.playedEvents ?? [];
  const byEvent = new Map<string, TeamProfileMatch[]>();
  for (const match of historicalMatches) {
    if (!match.eventKey) continue;
    const existing = byEvent.get(match.eventKey) ?? [];
    existing.push(match);
    byEvent.set(match.eventKey, existing);
  }
  if (!byEvent.size && !playedEventRows.length) return [];

  const rowsFromMatches = [...byEvent.entries()].map(([eventKey, matches]) => ({
    eventKey,
    matches,
    lastTime: Math.max(...matches.map((match) => numericValue(match.time) ?? 0)),
  }));
  const seededEvents = playedEventRows
    .map((row) => ({
      eventKey: stringField(row, 'event'),
      eventName: stringField(row, 'event_name'),
      rank:
        numericValue(nestedNumber(row, 'record', 'qual', 'rank')) ??
        numericValue(nestedNumber(row, 'rank')) ??
        null,
    }))
    .filter((row) => row.eventKey);

  const eventMap = new Map<string, HistoricalEventSummaryRow>();

  for (const eventRow of rowsFromMatches) {
    const playedEventRow =
      playedEventRows.find((row) => stringField(row, 'event') === eventRow.eventKey) ?? null;
    const totalMatches = eventRow.matches.length;
    const wins = eventRow.matches.filter((match) => match.result === 'win').length;
    const winRate = totalMatches > 0 ? wins / totalMatches : null;
    const avgMargin = mean(
      eventRow.matches
        .map((match) => numericValue(match.margin))
        .filter((value): value is number => value != null),
    );
    const avgEpa = mean(
      eventRow.matches
        .map((match) => numericValue(match.epaTotal))
        .filter((value): value is number => value != null),
    );
    const rank =
      numericValue(nestedNumber(playedEventRow, 'record', 'qual', 'rank')) ??
      numericValue(nestedNumber(playedEventRow, 'rank')) ??
      null;
    const eventNameFromPlayed = stringField(playedEventRow, 'event_name');
    const eventName = eventNameFromPlayed.trim()
      ? eventNameFromPlayed
      : (eventRow.matches[0]?.eventName ?? eventRow.eventKey);
    eventMap.set(eventRow.eventKey, {
      eventKey: eventRow.eventKey,
      eventName,
      totalMatches,
      winRate,
      avgMargin,
      avgEpa,
      rank,
      lastMatchTimeMs: eventRow.lastTime > 0 ? eventRow.lastTime : null,
      insight: eventInsight({ winRate, avgMargin }),
    });
  }

  for (const seededEvent of seededEvents) {
    if (eventMap.has(seededEvent.eventKey)) continue;
    eventMap.set(seededEvent.eventKey, {
      eventKey: seededEvent.eventKey,
      eventName: seededEvent.eventName || seededEvent.eventKey,
      totalMatches: 0,
      winRate: null,
      avgMargin: null,
      avgEpa: null,
      rank: seededEvent.rank,
      lastMatchTimeMs: null,
      insight: 'Historical event listed without match-level detail yet.',
    });
  }

  return [...eventMap.values()].sort(
    (left, right) => Number(right.lastMatchTimeMs ?? 0) - Number(left.lastMatchTimeMs ?? 0),
  );
}

function buildRecentTrendFlags(params: {
  currentVsSeason: {
    label: string;
    current: number | null;
    season: number | null;
    delta: number | null;
  }[];
  roleMetrics: TeamDossierRoleMetric[];
  volatilityLabel: string;
  previousEventSummary: HistoricalEventSummaryRow | null;
}) {
  const flags: string[] = [];
  const epaGap = params.currentVsSeason.find((row) => row.label === 'EPA') ?? null;
  const winRateGap = params.currentVsSeason.find((row) => row.label === 'Win rate') ?? null;
  if ((epaGap?.delta ?? 0) >= 3) {
    flags.push('Current-event EPA is running above the season baseline.');
  } else if ((epaGap?.delta ?? 0) <= -3) {
    flags.push('Current-event EPA is running below the season baseline.');
  }
  if ((winRateGap?.delta ?? 0) >= 0.15) {
    flags.push('Current event results are outperforming the season win-rate pace.');
  }
  if (params.volatilityLabel === 'Swingy') {
    flags.push('Treat ceiling and floor separately; match-to-match variance is high.');
  }
  const strongestRole = [...params.roleMetrics].sort(
    (left, right) => Number(right.delta ?? -999) - Number(left.delta ?? -999),
  )[0];
  if (strongestRole && (strongestRole.delta ?? 0) >= 2) {
    flags.push(`${strongestRole.label} is the clearest current-event edge.`);
  }
  if (params.previousEventSummary?.winRate != null) {
    flags.push(
      `Previous event (${params.previousEventSummary.eventName}) finished at ${Math.round(
        params.previousEventSummary.winRate * 100,
      )}% win rate.`,
    );
  }
  return flags.slice(0, 4);
}

function buildRoleMetrics(profile: TeamProfileRouteResponse): TeamDossierRoleMetric[] {
  const currentRow = profile.currentEvent?.eventRow ?? null;
  const fieldAverages = asRecord(profile.currentEvent?.fieldAverages ?? null);
  const metrics = [
    {
      label: 'Auto pressure',
      value: numericValue(
        nestedNumber(currentRow, 'autoEpa') ??
          nestedNumber(currentRow, 'epa', 'breakdown', 'auto_points'),
      ),
      baseline: numericValue(fieldAverages?.auto),
    },
    {
      label: 'Teleop pace',
      value: numericValue(
        nestedNumber(currentRow, 'teleopEpa') ??
          nestedNumber(currentRow, 'epa', 'breakdown', 'teleop_points'),
      ),
      baseline: numericValue(fieldAverages?.teleop),
    },
    {
      label: 'Endgame swing',
      value: numericValue(
        nestedNumber(currentRow, 'endgameEpa') ??
          nestedNumber(currentRow, 'epa', 'breakdown', 'endgame_points'),
      ),
      baseline: numericValue(fieldAverages?.endgame),
    },
    {
      label: 'Overall strength',
      value: numericValue(
        nestedNumber(currentRow, 'overallEpa') ??
          nestedNumber(currentRow, 'epa', 'total_points', 'mean'),
      ),
      baseline: numericValue(fieldAverages?.overall),
    },
  ];

  return metrics.map((metric) => {
    const delta =
      metric.value != null && metric.baseline != null ? metric.value - metric.baseline : null;
    const insight =
      delta == null
        ? 'Not enough event data yet.'
        : delta >= 4
          ? 'Clear event advantage.'
          : delta >= 1
            ? 'Above field average.'
            : delta <= -4
              ? 'Below current event baseline.'
              : 'Close to field average.';
    return {
      ...metric,
      delta,
      insight,
    };
  });
}

export function buildTeamDossier(profile: TeamProfileRouteResponse): TeamDossierResponse {
  const currentMatches = (profile.currentEvent?.eventMatches ?? [])
    .map((match) => ({
      label: stringField(match, 'matchLabel', stringField(match, 'key', 'Match')),
      value: numericValue(asRecord(match)?.rp),
    }))
    .filter((match) => match.label);
  const historicalMatches = profile.historical2026?.matches ?? [];
  const combinedMargins = [
    ...historicalMatches
      .map((match) => numericValue(match.margin))
      .filter((value): value is number => value != null),
    ...(profile.currentEvent?.eventMatches ?? [])
      .map((match) => numericValue(asRecord(match)?.margin))
      .filter((value): value is number => value != null),
  ];
  const volatilityScore = stddev(combinedMargins);
  const volatilityLabel =
    volatilityScore == null
      ? 'Unknown'
      : volatilityScore <= 8
        ? 'Stable'
        : volatilityScore <= 15
          ? 'Moderate'
          : 'Swingy';

  const roleMetrics = buildRoleMetrics(profile);
  const roleSummary = roleMetrics
    .filter((metric) => (metric.delta ?? 0) >= 1.5)
    .map((metric) => metric.label);
  if (!roleSummary.length) {
    roleSummary.push('Balanced contributor');
  }

  const currentEventRow = profile.currentEvent?.eventRow ?? null;
  const seasonSummary = profile.seasonSummary ?? null;
  const bestEvidenceMatches = topMatches(historicalMatches).map((match) => ({
    key: match.key,
    label: match.matchLabel,
    eventKey: match.eventKey,
    result: match.result,
    margin: match.margin ?? null,
    score: match.myScore ?? null,
    epa: match.epaTotal ?? null,
    reason:
      match.result === 'win'
        ? 'High-leverage winning sample'
        : match.margin != null && match.margin > -10
          ? 'Tight loss worth scouting'
          : 'Representative event sample',
  }));

  const currentVsSeason = [
    {
      label: 'EPA',
      current: numericValue(
        nestedNumber(currentEventRow, 'overallEpa') ??
          nestedNumber(currentEventRow, 'epa', 'total_points', 'mean'),
      ),
      season: numericValue(
        nestedNumber(seasonSummary, 'epa', 'norm') ??
          nestedNumber(seasonSummary, 'epa', 'total_points', 'mean'),
      ),
    },
    {
      label: 'Qual rank',
      current: numericValue(
        nestedNumber(currentEventRow, 'rank') ??
          nestedNumber(currentEventRow, 'record', 'qual', 'rank'),
      ),
      season: numericValue(nestedNumber(seasonSummary, 'record', 'qual', 'rank')),
    },
    {
      label: 'Win rate',
      current: numericValue(nestedNumber(currentEventRow, 'record', 'qual', 'winrate')),
      season: numericValue(nestedNumber(seasonSummary, 'record', 'qual', 'winrate')),
    },
  ].map((row) => ({
    ...row,
    delta: row.current != null && row.season != null ? row.current - row.season : null,
  }));
  const recentEvents = buildHistoricalEventRows(profile);
  const previousEventSummary = recentEvents[0] ?? null;

  const winConditionFlags = roleMetrics
    .filter((metric) => (metric.delta ?? 0) >= 1.5)
    .map((metric) => `${metric.label} is above the field average`);
  if (!winConditionFlags.length) {
    winConditionFlags.push('Project as a balanced contributor; no single phase is dominating.');
  }

  const rpPressure = currentMatches.length
    ? [`Current-event RP trend based on ${currentMatches.length} observed matches.`]
    : ['No current-event RP trend yet.'];

  const rankTrajectory =
    currentMatches.length > 0
      ? currentMatches
      : (profile.historical2026?.seasonEvents ?? []).map((eventRow, index) => ({
          label:
            stringField(eventRow, 'event_name') ||
            stringField(eventRow, 'event') ||
            `Event ${index + 1}`,
          value: numericValue(
            nestedNumber(eventRow, 'record', 'qual', 'rank') ?? nestedNumber(eventRow, 'rank'),
          ),
        }));
  const recentTrendFlags = buildRecentTrendFlags({
    currentVsSeason,
    roleMetrics,
    volatilityLabel,
    previousEventSummary,
  });
  const recentEventTrend = recentEvents
    .slice(0, 6)
    .reverse()
    .map((row) => ({
      label: row.eventName,
      avgEpa: row.avgEpa,
      winRatePercent: row.winRate != null ? row.winRate * 100 : null,
      rank: row.rank,
      matches: row.totalMatches,
    }));

  return {
    generatedAtMs: Date.now(),
    teamNumber: profile.team,
    loadedEventKey: profile.loadedEventKey ?? null,
    roleSummary,
    volatility: {
      score: volatilityScore,
      label: volatilityLabel,
      insight:
        volatilityLabel === 'Stable'
          ? 'Results are clustering tightly; this is easier to trust in alliance construction.'
          : volatilityLabel === 'Swingy'
            ? 'High variance; scout ceiling and floor separately.'
            : 'Some match-to-match variance is present.',
    },
    leverage: {
      winConditionFlags,
      rpPressure,
    },
    currentVsSeason,
    roleMetrics,
    bestEvidenceMatches,
    previousEventSummary,
    recentEvents,
    recentEventTrend,
    recentTrendFlags,
    rankTrajectory,
  };
}
