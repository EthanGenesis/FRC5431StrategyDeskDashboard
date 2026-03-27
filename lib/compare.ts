import { teamNumberFromKey } from './logic';
import type { ExternalRecord } from './types';
export {
  buildCompareDerivedMetrics,
  buildEventFieldAverages,
  buildEventTeamRowsFromContext,
  collectCompareBreakdownKeys,
  compareMatchPlayed,
  compareResultForTeam,
  eventStatusSummary,
  extractSbMatchKey,
  extractSbTeamNumber,
  getSbAutoEpa,
  getSbEndgameEpa,
  getSbOverallEpa,
  getSbTeleopEpa,
  humanizeCompareKey,
  humanizeMatchKey,
  normalizeEventMatches,
  normalizeSeasonMatches,
  rollingAverage,
  seasonBreakdown,
  seasonCurrentEpa,
  seasonMeanTotal,
  seasonPercentileValue,
  seasonRankValue,
} from './analytics';

type CompareRowLike = {
  teamNumber?: number | string | null;
  teamKey?: string | null;
};

/**
 * Safely coerces dynamic numeric inputs used throughout compare analytics.
 */
export function compareSafeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Calculates the arithmetic mean for a clean numeric array.
 */
export function compareMean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Calculates population standard deviation for a clean numeric array.
 */
export function compareStddev(values: number[]): number | null {
  if (!values.length) return null;
  const mean = compareMean(values);
  if (mean == null) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
  return Math.sqrt(Math.max(variance, 0));
}

/**
 * Computes the average for a nullable/dynamic numeric series.
 */
export function compareAverageNullable(values: unknown[]): number | null {
  const cleaned = values
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map(Number);
  return compareMean(cleaned);
}

/**
 * Resolves a numeric team number from a compare row-like record.
 */
export function teamNumberForCompareRow(
  row: CompareRowLike | ExternalRecord | null | undefined,
): number | null {
  const teamNumber = compareSafeNumber((row as CompareRowLike | null | undefined)?.teamNumber);
  if (teamNumber != null) return teamNumber;
  return teamNumberFromKey(String((row as CompareRowLike | null | undefined)?.teamKey ?? ''));
}
