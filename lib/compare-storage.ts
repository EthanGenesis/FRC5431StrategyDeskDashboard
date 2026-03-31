import type { CompareDraft, CompareSet } from './types';

export type CompareDraftScope = 'current' | 'historical';

const COMPARE_DRAFT_KEYS: Record<CompareDraftScope, string> = {
  current: 'tbsb_compare_draft_current_v1',
  historical: 'tbsb_compare_draft_historical_v1',
};
const COMPARE_SETS_KEY = 'tbsb_compare_sets_v1';

export const DEFAULT_COMPARE_DRAFT: CompareDraft = {
  teamNumbers: [],
  baselineTeamNumber: null,
  note: '',
  chartMode: 'event_matches',
  metricKey: 'event_match_rolling_opr',
  smoothingWindow: 1,
  distributionSource: 'season',
  baselineOverlay: true,
};

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function loadJson<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures so compare tools still work with in-memory state.
  }
}

function normalizeDraft(draft: CompareDraft | null | undefined): CompareDraft {
  return {
    ...DEFAULT_COMPARE_DRAFT,
    ...(draft ?? {}),
    teamNumbers: Array.from(
      new Set(
        (draft?.teamNumbers ?? [])
          .map((teamNumber) => Math.floor(Number(teamNumber)))
          .filter((teamNumber) => Number.isFinite(teamNumber) && teamNumber > 0),
      ),
    ),
  };
}

export function loadCompareDraft(scope: CompareDraftScope = 'current'): CompareDraft {
  const scopedDraft = normalizeDraft(
    loadJson<CompareDraft>(COMPARE_DRAFT_KEYS[scope], DEFAULT_COMPARE_DRAFT),
  );
  if (scope === 'current') {
    const legacyDraft = normalizeDraft(
      loadJson<CompareDraft>('tbsb_compare_draft_v1', DEFAULT_COMPARE_DRAFT),
    );
    if (!scopedDraft.teamNumbers.length && legacyDraft.teamNumbers.length) {
      saveCompareDraft(legacyDraft, 'current');
      return legacyDraft;
    }
  }
  return scopedDraft;
}

export function saveCompareDraft(draft: CompareDraft, scope: CompareDraftScope = 'current') {
  saveJson(COMPARE_DRAFT_KEYS[scope], normalizeDraft(draft));
}

export function loadCompareSets(): CompareSet[] {
  return loadJson<CompareSet[]>(COMPARE_SETS_KEY, []);
}

export function saveCompareSets(sets: CompareSet[]) {
  saveJson(COMPARE_SETS_KEY, sets ?? []);
}

export function addTeamToCompareDraft(
  teamNumber: number,
  loadedTeam?: number | null,
  scope: CompareDraftScope = 'current',
) {
  const normalized = Math.floor(Number(teamNumber));
  if (!Number.isFinite(normalized) || normalized <= 0) return loadCompareDraft(scope);
  const current = loadCompareDraft(scope);
  const nextTeamNumbers = Array.from(new Set([...(current.teamNumbers ?? []), normalized]));
  const nextDraft: CompareDraft = {
    ...current,
    teamNumbers: nextTeamNumbers,
    baselineTeamNumber:
      loadedTeam != null && nextTeamNumbers.includes(Math.floor(Number(loadedTeam)))
        ? Math.floor(Number(loadedTeam))
        : current.baselineTeamNumber && nextTeamNumbers.includes(current.baselineTeamNumber)
          ? current.baselineTeamNumber
          : (nextTeamNumbers[0] ?? null),
  };
  saveCompareDraft(nextDraft, scope);
  return nextDraft;
}
