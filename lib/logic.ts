import type { AlertKind, MatchSimple, QueueState } from './types';

const compOrder: Record<MatchSimple['comp_level'], number> = {
  qm: 0,
  ef: 1,
  qf: 2,
  sf: 3,
  f: 4,
};

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function sortMatches(matches: MatchSimple[]): MatchSimple[] {
  return [...matches].sort((a, b) => {
    const c = compOrder[a.comp_level] - compOrder[b.comp_level];
    if (c !== 0) return c;
    const s = (a.set_number ?? 0) - (b.set_number ?? 0);
    if (s !== 0) return s;
    return (a.match_number ?? 0) - (b.match_number ?? 0);
  });
}

export function tbaTeamKey(teamNumber: number): string {
  return `frc${teamNumber}`;
}

export function teamNumberFromKey(teamKey: string): number | null {
  const m = /^frc(\d+)$/.exec(teamKey);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function matchHasTeam(match: MatchSimple, teamKey: string): boolean {
  return (
    match.alliances.red.team_keys.includes(teamKey) ||
    match.alliances.blue.team_keys.includes(teamKey)
  );
}

export function allianceForTeam(match: MatchSimple, teamKey: string): 'red' | 'blue' | null {
  if (match.alliances.red.team_keys.includes(teamKey)) return 'red';
  if (match.alliances.blue.team_keys.includes(teamKey)) return 'blue';
  return null;
}

export function isPlayed(match: MatchSimple): boolean {
  return match.actual_time != null || match.post_result_time != null;
}

export function realPointerIndex(sorted: MatchSimple[]): number {
  let idx = -1;
  for (let i = 0; i < sorted.length; i += 1) {
    const match = sorted[i];
    if (match && isPlayed(match)) idx = i;
  }
  return idx;
}

export function bestCountdownUnix(match: MatchSimple): number | null {
  return match.predicted_time ?? match.time ?? null;
}

export function formatMatchLabel(match: MatchSimple): string {
  if (match.comp_level === 'qm') return `QM${match.match_number}`;
  if (match.comp_level === 'ef') return `EF${match.set_number}-${match.match_number}`;
  if (match.comp_level === 'qf') return `QF${match.set_number}-${match.match_number}`;
  if (match.comp_level === 'sf') return `SF${match.set_number}-${match.match_number}`;
  return `F${match.set_number}-${match.match_number}`;
}

export function computeAlert(deltaMatches: number): AlertKind | null {
  if (deltaMatches === 5) return 'QUEUE_5';
  if (deltaMatches === 2) return 'QUEUE_2';
  if (deltaMatches === 1) return 'QUEUE_1';
  if (deltaMatches === 0) return 'PLAYING_NOW';
  return null;
}

export function computeQueueState(deltaMatches: number | null): QueueState {
  if (deltaMatches == null) return 'NONE';
  if (deltaMatches <= 0) return 'PLAYING_NOW';
  if (deltaMatches <= 1) return 'QUEUE_1';
  if (deltaMatches <= 2) return 'QUEUE_2';
  if (deltaMatches <= 5) return 'QUEUE_5';
  return 'NONE';
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function percentileRank(values: number[], value: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let count = 0;
  for (const v of sorted) {
    if (v <= value) count += 1;
  }
  return count / sorted.length;
}

export function safeNumber(x: unknown, fallback = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
