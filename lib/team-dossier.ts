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
    rankTrajectory,
  };
}
