import { formatMatchLabel, matchHasTeam, safeNumber, sortMatches } from './logic';
import type { CompareTeamEventRow, ExternalArray, MatchSimple } from './types';

type LooseRecord = Record<string, any>;

type NumericCandidate = {
  path: string;
  value: number;
};

type RollingMetrics = {
  rollingOpr: number | null;
  rollingDpr: number | null;
  rollingCcwm: number | null;
  rollingCopr: number | null;
};

type NormalizedSeasonMatch = LooseRecord & {
  key: string;
  eventKey: string;
  eventName: string;
  matchLabel: string;
  time: number | null;
  played: boolean;
  elim: boolean;
  alliance: 'red' | 'blue' | null;
  result: 'win' | 'loss' | 'tie' | 'unknown';
  redScore: number | null;
  blueScore: number | null;
  myScore: number | null;
  oppScore: number | null;
  margin: number | null;
  epaTotal: number | null;
  epaPost: number | null;
  breakdown: LooseRecord | null;
  status: unknown;
  week: number | null;
  dq: boolean;
  surrogate: boolean;
  isLoadedEvent: boolean;
  sb: LooseRecord;
};

type NormalizedEventMatch = LooseRecord & {
  key: string;
  eventKey: string;
  matchLabel: string;
  compLevel: string;
  time: number | null;
  played: boolean;
  elim: boolean;
  alliance: 'red' | 'blue';
  partners: string[];
  opponents: string[];
  result: 'win' | 'loss' | 'tie' | 'unknown';
  redScore: number | null;
  blueScore: number | null;
  myScore: number | null;
  oppScore: number | null;
  margin: number | null;
  winningAlliance: string | null;
  epaTotal: number | null;
  epaPost: number | null;
  breakdown: LooseRecord | null;
  pred: LooseRecord | null;
  rp: number | null;
  sb: LooseRecord | null;
  tba: MatchSimple;
} & Partial<RollingMetrics>;

type EventContextLike = {
  tba?: {
    teams?: LooseRecord[] | null;
    rankings?: LooseRecord | null;
    teamStatuses?: LooseRecord | null;
    matches?: MatchSimple[] | null;
    oprs?: LooseRecord | null;
  } | null;
  sb?: {
    teamEvents?: LooseRecord[] | null;
  } | null;
};

type CompareDerivedInput = {
  seasonSummary: LooseRecord | null | undefined;
  seasonRollups: LooseRecord | null | undefined;
  playedEvents: LooseRecord[];
  upcomingEvents: LooseRecord[];
  seasonMatches: LooseRecord[];
  historicalEvents?: LooseRecord[] | null;
  historicalMatches?: LooseRecord[] | null;
  eventRow: CompareTeamEventRow | null | undefined;
  eventMatches: NormalizedEventMatch[];
  fieldAverages: Record<string, number | null> | null | undefined;
};
export const ANALYTICS_LINE_COLORS = [
  '#f3be3b',
  '#4bb3fd',
  '#ff6b6b',
  '#8ad17d',
  '#ff9f68',
  '#c084fc',
  '#2dd4bf',
  '#f472b6',
  '#facc15',
  '#60a5fa',
];
/**
 * Converts arbitrary external input into a finite number or `null`.
 */
export function analyticsSafeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
export function analyticsMean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
export function analyticsStddev(values: number[]): number | null {
  if (!values.length) return null;
  const mean = analyticsMean(values);
  if (mean == null) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
  return Math.sqrt(Math.max(variance, 0));
}
export function rollingAverage(
  values: (number | null | undefined)[],
  windowSize = 1,
): (number | null)[] {
  const size = Math.max(1, Math.floor(Number(windowSize) || 1));
  return values.map((_, index) => {
    const windowValues = values
      .slice(Math.max(0, index - size + 1), index + 1)
      .filter((value) => value != null && Number.isFinite(Number(value)))
      .map(Number);
    return analyticsMean(windowValues);
  });
}
export function extractSbTeamNumber(item: LooseRecord | null | undefined): number | null {
  const raw =
    item?.team_number ??
    item?.team_num ??
    item?.team ??
    item?.teamNumber ??
    item?.team_key ??
    item?.team?.team_number ??
    item?.team?.team ??
    item?.team?.key ??
    null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const normalized = raw.startsWith('frc') ? raw.slice(3) : raw;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
export function extractSbMatchKey(item: LooseRecord | null | undefined): string | null {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.key === 'string') return item.key;
  if (typeof item.match === 'string') return item.match;
  return null;
}
export function getSbOverallEpa(teamEvent: LooseRecord | null | undefined): number | null {
  return analyticsSafeNumber(teamEvent?.epa?.total_points?.mean ?? teamEvent?.norm_epa?.current);
}
export function getSbAutoEpa(teamEvent: LooseRecord | null | undefined): number | null {
  return analyticsSafeNumber(teamEvent?.epa?.breakdown?.auto_points);
}
export function getSbTeleopEpa(teamEvent: LooseRecord | null | undefined): number | null {
  return analyticsSafeNumber(teamEvent?.epa?.breakdown?.teleop_points);
}
export function getSbEndgameEpa(teamEvent: LooseRecord | null | undefined): number | null {
  return analyticsSafeNumber(teamEvent?.epa?.breakdown?.endgame_points);
}
export function compareMatchPlayed(match: MatchSimple | LooseRecord | null | undefined): boolean {
  const red = match?.alliances?.red?.score;
  const blue = match?.alliances?.blue?.score;
  const hasScore = typeof red === 'number' && typeof blue === 'number' && red >= 0 && blue >= 0;
  return hasScore || match?.actual_time != null || match?.post_result_time != null;
}
export function compareResultForTeam(
  match: MatchSimple | LooseRecord | null | undefined,
  teamKey: string,
): 'win' | 'loss' | 'tie' | 'unknown' {
  if (!match) return 'unknown';
  const winningAlliance = match?.winning_alliance ?? '';
  if (winningAlliance === '') {
    const redScore = match?.alliances?.red?.score;
    const blueScore = match?.alliances?.blue?.score;
    if (typeof redScore === 'number' && typeof blueScore === 'number') {
      if (redScore === blueScore) return 'tie';
      const onRed = match?.alliances?.red?.team_keys?.includes(teamKey);
      if (onRed) return redScore > blueScore ? 'win' : 'loss';
      const onBlue = match?.alliances?.blue?.team_keys?.includes(teamKey);
      if (onBlue) return blueScore > redScore ? 'win' : 'loss';
    }
    return 'unknown';
  }
  const onRed = match?.alliances?.red?.team_keys?.includes(teamKey);
  if (onRed) return winningAlliance === 'red' ? 'win' : 'loss';
  const onBlue = match?.alliances?.blue?.team_keys?.includes(teamKey);
  if (onBlue) return winningAlliance === 'blue' ? 'win' : 'loss';
  return 'unknown';
}
export function humanizeMatchKey(key: string): string {
  if (!key) return '-';
  const qm = key.match(/_qm(\d+)$/i);
  if (qm) return `QM${qm[1]}`;
  const ef = key.match(/_ef(\d+)m(\d+)$/i);
  if (ef) return `EF${ef[1]}-${ef[2]}`;
  const qf = key.match(/_qf(\d+)m(\d+)$/i);
  if (qf) return `QF${qf[1]}-${qf[2]}`;
  const sf = key.match(/_sf(\d+)m(\d+)$/i);
  if (sf) return `SF${sf[1]}-${sf[2]}`;
  const f = key.match(/_f(\d+)m(\d+)$/i);
  if (f) return `F${f[1]}-${f[2]}`;
  return key;
}
function extractNumericCandidates(
  obj: unknown,
  path = '',
  out: NumericCandidate[] = [],
): NumericCandidate[] {
  if (obj == null) return out;
  if (typeof obj === 'number' && Number.isFinite(obj)) {
    out.push({ path, value: obj });
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((value, index) => extractNumericCandidates(value, `${path}[${index}]`, out));
    return out;
  }
  if (typeof obj === 'object') {
    Object.entries(obj).forEach(([key, value]) =>
      extractNumericCandidates(value, path ? `${path}.${key}` : key, out),
    );
  }
  return out;
}
export function extractKnownRpFromMatch(
  match: MatchSimple | LooseRecord | null | undefined,
  alliance: 'red' | 'blue',
): number | null {
  const sb = match?.score_breakdown?.[alliance];
  if (!sb || typeof sb !== 'object') return null;
  const candidates = extractNumericCandidates(sb);
  const strong = candidates.find((candidate) =>
    /(^|\.)(rp|rankingPoints|ranking_points|totalRp|total_rp)$/i.test(candidate.path),
  );
  if (strong) return strong.value;
  const weak = candidates.find((candidate) => /rp|ranking/i.test(candidate.path));
  if (weak) return weak.value;
  return null;
}
export function sanitizeNarrativeHtml(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return '-';
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/\r?\n/g, '<br />')
    .replace(/<(?!\/?(?:b|strong|i|em|br)\b)[^>]*>/gi, '')
    .replace(/<(b|strong|i|em)(?:\s[^>]*)?>/gi, '<$1>')
    .replace(/<\/(b|strong|i|em)\s*>/gi, '</$1>')
    .replace(/<br(?:\s*\/)?>/gi, '<br />');
}
export function stripNarrativeHtml(raw: unknown): string {
  return (
    sanitizeNarrativeHtml(raw)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?(?:b|strong|i|em)\s*>/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || '-'
  );
}
function rawEventStatusSource(status: LooseRecord | null | undefined): string {
  if (!status) return '';
  if (typeof status?.overall_status_str === 'string' && status.overall_status_str.trim()) {
    return status.overall_status_str.trim();
  }
  if (typeof status?.alliance_status_str === 'string' && status.alliance_status_str.trim()) {
    return status.alliance_status_str.trim();
  }
  if (typeof status?.playoff_status_str === 'string' && status.playoff_status_str.trim()) {
    return status.playoff_status_str.trim();
  }
  if (status?.qual?.ranking?.rank != null && status?.qual?.num_teams != null) {
    return `Rank <b>${status.qual.ranking.rank}/${status.qual.num_teams}</b>`;
  }
  return '';
}
export function eventStatusHtml(status: LooseRecord | null | undefined): string {
  const raw = rawEventStatusSource(status);
  if (!raw) return '-';
  return sanitizeNarrativeHtml(raw);
}
export function eventStatusSummary(status: LooseRecord | null | undefined): string {
  const raw = rawEventStatusSource(status);
  if (!raw) return '-';
  return stripNarrativeHtml(raw);
}
export function seasonCurrentEpa(summary: LooseRecord | null | undefined): number | null {
  return analyticsSafeNumber(
    summary?.epa?.norm ?? summary?.norm_epa?.current ?? summary?.epa?.total_points?.mean,
  );
}
export function seasonMeanTotal(summary: LooseRecord | null | undefined): number | null {
  return analyticsSafeNumber(
    summary?.epa?.total_points?.mean ?? summary?.epa?.breakdown?.total_points,
  );
}
export function seasonBreakdown(
  summary: LooseRecord | null | undefined,
  key: string,
): number | null {
  return analyticsSafeNumber(summary?.epa?.breakdown?.[key]);
}
export function seasonRankValue(
  summary: LooseRecord | null | undefined,
  key: string,
): number | null {
  return analyticsSafeNumber(summary?.epa?.ranks?.[key]?.rank);
}
export function seasonPercentileValue(
  summary: LooseRecord | null | undefined,
  key: string,
): number | null {
  return analyticsSafeNumber(summary?.epa?.ranks?.[key]?.percentile);
}
export function normalizeSeasonMatches(
  teamNumber: number,
  teamMatchesRaw: LooseRecord[],
  teamEventsByKey: Record<string, LooseRecord>,
  loadedEventKey = '',
): NormalizedSeasonMatch[] {
  return (Array.isArray(teamMatchesRaw) ? teamMatchesRaw : [])
    .filter((row) => Number(row?.year) === 2026)
    .map((row) => {
      const eventKey = String(row?.event ?? '');
      const eventRow = teamEventsByKey?.[eventKey] ?? null;
      const alliance: 'red' | 'blue' | null =
        row?.alliance === 'red' || row?.alliance === 'blue' ? row.alliance : null;
      const result: 'win' | 'loss' | 'tie' | 'unknown' =
        row?.winner === 'red' || row?.winner === 'blue'
          ? row.winner === alliance
            ? 'win'
            : 'loss'
          : String(row?.status ?? '').toLowerCase() === 'tie'
            ? 'tie'
            : 'unknown';
      const rowEpa = (row?.epa as LooseRecord | undefined) ?? null;
      const breakdown = (rowEpa?.breakdown as LooseRecord | null | undefined) ?? null;
      return {
        key: String(row?.match ?? row?.key ?? ''),
        eventKey,
        eventName: eventRow?.event_name ?? eventKey,
        matchLabel: humanizeMatchKey(String(row?.match ?? row?.key ?? '')),
        time: analyticsSafeNumber(row?.time),
        played: String(row?.status ?? '').toLowerCase() !== 'upcoming',
        elim: Boolean(row?.elim),
        alliance,
        result,
        redScore: analyticsSafeNumber(row?.red_score),
        blueScore: analyticsSafeNumber(row?.blue_score),
        myScore:
          alliance === 'red'
            ? analyticsSafeNumber(row?.red_score)
            : alliance === 'blue'
              ? analyticsSafeNumber(row?.blue_score)
              : null,
        oppScore:
          alliance === 'red'
            ? analyticsSafeNumber(row?.blue_score)
            : alliance === 'blue'
              ? analyticsSafeNumber(row?.red_score)
              : null,
        margin:
          alliance === 'red' &&
          analyticsSafeNumber(row?.red_score) != null &&
          analyticsSafeNumber(row?.blue_score) != null
            ? Number(row.red_score) - Number(row.blue_score)
            : alliance === 'blue' &&
                analyticsSafeNumber(row?.blue_score) != null &&
                analyticsSafeNumber(row?.red_score) != null
              ? Number(row.blue_score) - Number(row.red_score)
              : null,
        epaTotal: analyticsSafeNumber(rowEpa?.total_points),
        epaPost: analyticsSafeNumber(rowEpa?.post),
        breakdown,
        status: row?.status ?? null,
        week: analyticsSafeNumber(row?.week ?? eventRow?.week),
        dq: Boolean(row?.dq),
        surrogate: Boolean(row?.surrogate),
        isLoadedEvent: Boolean(loadedEventKey) && eventKey === loadedEventKey,
        sb: row,
      };
    })
    .sort((a, b) => Number(a.time ?? 0) - Number(b.time ?? 0));
}
export function normalizeEventMatches(
  matches: MatchSimple[],
  sbMatches: LooseRecord[],
  teamKey: string,
): NormalizedEventMatch[] {
  const sbMatchMap = new Map<string, LooseRecord>();
  for (const item of Array.isArray(sbMatches) ? sbMatches : []) {
    const key = extractSbMatchKey(item);
    if (key) sbMatchMap.set(key, item);
  }
  return sortMatches(Array.isArray(matches) ? matches : [])
    .filter((match) => matchHasTeam(match, teamKey))
    .map((match) => {
      const alliance = match?.alliances?.red?.team_keys?.includes(teamKey) ? 'red' : 'blue';
      const partners =
        alliance === 'red'
          ? (match?.alliances?.red?.team_keys ?? []).filter((key) => key !== teamKey)
          : (match?.alliances?.blue?.team_keys ?? []).filter((key) => key !== teamKey);
      const opponents =
        alliance === 'red'
          ? (match?.alliances?.blue?.team_keys ?? [])
          : (match?.alliances?.red?.team_keys ?? []);
      const myScore =
        alliance === 'red'
          ? analyticsSafeNumber(match?.alliances?.red?.score)
          : analyticsSafeNumber(match?.alliances?.blue?.score);
      const oppScore =
        alliance === 'red'
          ? analyticsSafeNumber(match?.alliances?.blue?.score)
          : analyticsSafeNumber(match?.alliances?.red?.score);
      const sbMatch = sbMatchMap.get(match.key) ?? null;
      const sbMatchEpa = (sbMatch?.epa as LooseRecord | undefined) ?? null;
      return {
        key: String(match?.key ?? ''),
        eventKey: String((match as MatchSimple & { event_key?: string }).event_key ?? ''),
        matchLabel: formatMatchLabel(match),
        compLevel: String(match?.comp_level ?? ''),
        time:
          analyticsSafeNumber(
            match?.actual_time ?? match?.post_result_time ?? match?.predicted_time ?? match?.time,
          ) ?? null,
        played: compareMatchPlayed(match),
        elim: match?.comp_level !== 'qm',
        alliance,
        partners,
        opponents,
        result: compareResultForTeam(match, teamKey),
        redScore: analyticsSafeNumber(match?.alliances?.red?.score),
        blueScore: analyticsSafeNumber(match?.alliances?.blue?.score),
        myScore,
        oppScore,
        margin: myScore != null && oppScore != null ? myScore - oppScore : null,
        winningAlliance: match?.winning_alliance ?? null,
        epaTotal: analyticsSafeNumber(sbMatchEpa?.total_points),
        epaPost: analyticsSafeNumber(sbMatchEpa?.post),
        breakdown: (sbMatchEpa?.breakdown as LooseRecord | null | undefined) ?? null,
        pred: (sbMatch?.pred as LooseRecord | null | undefined) ?? null,
        rp:
          extractKnownRpFromMatch(match, alliance) ??
          analyticsSafeNumber(
            alliance === 'red'
              ? (sbMatch?.pred?.red_rp_1 ?? 0) + (sbMatch?.pred?.red_rp_2 ?? 0)
              : (sbMatch?.pred?.blue_rp_1 ?? 0) + (sbMatch?.pred?.blue_rp_2 ?? 0),
          ),
        sb: sbMatch,
        tba: match,
      };
    });
}
function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, index) => [...row, rhs[index] ?? 0]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      const rowValue = a[row]?.[col] ?? 0;
      const pivotValue = a[pivot]?.[col] ?? 0;
      if (Math.abs(rowValue) > Math.abs(pivotValue)) pivot = row;
    }
    if (pivot !== col) [a[col], a[pivot]] = [a[pivot] ?? [], a[col] ?? []];
    const pivotRow = a[col];
    if (!pivotRow) continue;
    const pivotValue = pivotRow[col] ?? 0;
    if (Math.abs(pivotValue) < 1e-9) continue;
    for (let c = col; c <= n; c += 1) {
      const current = pivotRow[c] ?? 0;
      pivotRow[c] = current / pivotValue;
    }
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const currentRow = a[row];
      if (!currentRow) continue;
      const factor = currentRow[col] ?? 0;
      if (Math.abs(factor) < 1e-12) continue;
      for (let c = col; c <= n; c += 1) {
        const next = (currentRow[c] ?? 0) - factor * (pivotRow[c] ?? 0);
        currentRow[c] = next;
      }
    }
  }
  return a.map((row) => {
    const value = row?.[n];
    return Number.isFinite(value) ? Number(value) : 0;
  });
}
function buildLinearStats(
  matches: MatchSimple[],
  teamKeys: string[],
): { opr: number[]; dpr: number[]; ccwm: number[]; idx: Map<string, number> } {
  const idx = new Map<string, number>();
  teamKeys.forEach((key, index) => idx.set(key, index));
  const size = teamKeys.length;
  const ata = Array.from({ length: size }, () => Array(size).fill(0));
  const atbOpr = Array(size).fill(0);
  const atbDpr = Array(size).fill(0);
  for (const match of matches) {
    const red = match?.alliances?.red?.team_keys ?? [];
    const blue = match?.alliances?.blue?.team_keys ?? [];
    const redScore = Number(match?.alliances?.red?.score ?? 0);
    const blueScore = Number(match?.alliances?.blue?.score ?? 0);
    const alliances = [
      { teams: red, scoreFor: redScore, scoreAgainst: blueScore },
      { teams: blue, scoreFor: blueScore, scoreAgainst: redScore },
    ];
    for (const alliance of alliances) {
      const ids = alliance.teams
        .map((key) => idx.get(key))
        .filter((value): value is number => value != null);
      for (const i of ids) {
        atbOpr[i] += alliance.scoreFor;
        atbDpr[i] += alliance.scoreAgainst;
        const ataRow = ata[i];
        if (!ataRow) continue;
        for (const j of ids) {
          ataRow[j] = (ataRow[j] ?? 0) + 1;
        }
      }
    }
  }
  for (let index = 0; index < size; index += 1) {
    const ataRow = ata[index];
    if (!ataRow) continue;
    ataRow[index] = (ataRow[index] ?? 0) + 1e-6;
  }
  const opr = solveLinearSystem(
    ata.map((row) => [...row]),
    atbOpr,
  );
  const dpr = solveLinearSystem(
    ata.map((row) => [...row]),
    atbDpr,
  );
  const ccwm = opr.map((value, index) => value - (dpr[index] ?? 0));
  return { opr, dpr, ccwm, idx };
}
export function buildRollingLinearMetrics(
  allMatches: MatchSimple[],
): Map<string, Map<string, RollingMetrics>> {
  const playedMatches = sortMatches(Array.isArray(allMatches) ? allMatches : []).filter(
    compareMatchPlayed,
  );
  const teamKeys = Array.from(
    new Set(
      playedMatches.flatMap((match) => [
        ...(match?.alliances?.red?.team_keys ?? []),
        ...(match?.alliances?.blue?.team_keys ?? []),
      ]),
    ),
  );
  const perTeamByMatch = new Map<string, Map<string, RollingMetrics>>();
  const prefix = [];
  for (const match of playedMatches) {
    prefix.push(match);
    const { opr, dpr, ccwm, idx } = buildLinearStats(prefix, teamKeys);
    const participants = [
      ...(match?.alliances?.red?.team_keys ?? []),
      ...(match?.alliances?.blue?.team_keys ?? []),
    ];
    for (const teamKey of participants) {
      const teamIndex = idx.get(teamKey);
      if (teamIndex == null) continue;
      if (!perTeamByMatch.has(teamKey)) perTeamByMatch.set(teamKey, new Map());
      perTeamByMatch.get(teamKey)?.set(match.key, {
        rollingOpr: analyticsSafeNumber(opr[teamIndex]),
        rollingDpr: analyticsSafeNumber(dpr[teamIndex]),
        rollingCcwm: analyticsSafeNumber(ccwm[teamIndex]),
        rollingCopr: analyticsSafeNumber(opr[teamIndex]),
      });
    }
  }
  return perTeamByMatch;
}
export function attachRollingEventMetrics(
  teamKey: string,
  eventMatches: NormalizedEventMatch[],
  allEventMatches: MatchSimple[],
): NormalizedEventMatch[] {
  const rollingMap = buildRollingLinearMetrics(allEventMatches);
  const teamRolling = rollingMap.get(teamKey) ?? new Map();
  let latestRolling: RollingMetrics | null = null;
  return (eventMatches ?? []).map((match) => {
    const rolling = teamRolling.get(match.key) ?? latestRolling ?? null;
    if (teamRolling.has(match.key)) latestRolling = teamRolling.get(match.key);
    return {
      ...match,
      rollingOpr: rolling?.rollingOpr ?? null,
      rollingDpr: rolling?.rollingDpr ?? null,
      rollingCcwm: rolling?.rollingCcwm ?? null,
      rollingCopr: rolling?.rollingCopr ?? null,
    };
  });
}
export function buildEventFieldAverages(
  rows: CompareTeamEventRow[],
): Record<string, number | null> | null {
  if (!rows?.length) return null;
  return {
    eventEpa: analyticsMean(
      rows
        .map((row) => row.overallEpa)
        .filter((value) => value != null)
        .map(Number),
    ),
    eventOpr: analyticsMean(
      rows
        .map((row) => row.opr)
        .filter((value) => value != null)
        .map(Number),
    ),
    eventCopr: analyticsMean(
      rows
        .map((row) => row.copr)
        .filter((value) => value != null)
        .map(Number),
    ),
    eventComposite: analyticsMean(
      rows
        .map((row) => row.composite)
        .filter((value) => value != null)
        .map(Number),
    ),
    eventRpAverage: analyticsMean(
      rows
        .map((row) => row.rpAverage)
        .filter((value) => value != null)
        .map(Number),
    ),
    eventTotalRp: analyticsMean(
      rows
        .map((row) => row.totalRp)
        .filter((value) => value != null)
        .map(Number),
    ),
    eventSos: analyticsMean(
      rows
        .map((row) => row.totalSos)
        .filter((value) => value != null)
        .map(Number),
    ),
  };
}
function rankingPointIndex(rankings: LooseRecord | null | undefined): number {
  const sortInfo = Array.isArray(rankings?.sort_order_info) ? rankings.sort_order_info : [];
  for (let index = 0; index < sortInfo.length; index += 1) {
    const name = String(sortInfo[index]?.name ?? '').toLowerCase();
    if (name.includes('ranking point') || name === 'rp' || name.includes('ranking score')) {
      return index;
    }
  }
  return 0;
}
export function buildEventTeamRowsFromContext(
  eventContext: EventContextLike,
): CompareTeamEventRow[] {
  const tbaTeams = Array.isArray(eventContext?.tba?.teams) ? eventContext.tba.teams : [];
  const rankingsRows = Array.isArray(eventContext?.tba?.rankings?.rankings)
    ? eventContext.tba.rankings.rankings
    : [];
  const rpIndex = rankingPointIndex(eventContext?.tba?.rankings);
  const rankingMap = new Map();
  for (const row of rankingsRows) {
    const sortOrders = Array.isArray(row?.sort_orders) ? row.sort_orders : [];
    const rpAverage = analyticsSafeNumber(sortOrders[rpIndex]);
    const matchesPlayed = safeNumber(row?.matches_played, 0);
    rankingMap.set(String(row.team_key), {
      ...row,
      _rpAverage: rpAverage,
      _totalRp: rpAverage != null && matchesPlayed > 0 ? rpAverage * matchesPlayed : null,
    });
  }
  const sbTeamEventMap = new Map();
  for (const item of eventContext?.sb?.teamEvents ?? []) {
    const teamNumber = extractSbTeamNumber(item);
    if (teamNumber != null && !sbTeamEventMap.has(teamNumber)) sbTeamEventMap.set(teamNumber, item);
  }
  const teamStatuses = (eventContext?.tba?.teamStatuses as LooseRecord | null | undefined) ?? {};
  const sortedMatches = sortMatches(eventContext?.tba?.matches ?? []);
  const baseRows = tbaTeams.map((team) => {
    const teamNumber = safeNumber(team?.team_number, 0);
    const teamKey = `frc${teamNumber}`;
    const ranking = rankingMap.get(teamKey) ?? null;
    const sbTeamEvent = sbTeamEventMap.get(teamNumber) ?? null;
    const recordObject = ranking?.record;
    return {
      teamKey,
      teamNumber,
      nickname: team?.nickname ?? team?.name ?? '',
      rank: ranking?.rank ?? null,
      compositeRank: null,
      matchesPlayed: safeNumber(ranking?.matches_played, 0),
      rpAverage: ranking?._rpAverage ?? null,
      totalRp: ranking?._totalRp ?? null,
      overallEpa: getSbOverallEpa(sbTeamEvent),
      autoEpa: getSbAutoEpa(sbTeamEvent),
      teleopEpa: getSbTeleopEpa(sbTeamEvent),
      endgameEpa: getSbEndgameEpa(sbTeamEvent),
      opr: analyticsSafeNumber(eventContext?.tba?.oprs?.oprs?.[teamKey]),
      copr: analyticsSafeNumber(eventContext?.tba?.oprs?.coprs?.[teamKey]),
      dpr: analyticsSafeNumber(eventContext?.tba?.oprs?.dprs?.[teamKey]),
      ccwm: analyticsSafeNumber(eventContext?.tba?.oprs?.ccwms?.[teamKey]),
      record: recordObject
        ? `${recordObject.wins ?? 0}-${recordObject.losses ?? 0}-${recordObject.ties ?? 0}`
        : '-',
      composite: null,
      compositeRaw: null,
      playedSos: null,
      remainingSos: null,
      totalSos: null,
      districtPoints: analyticsSafeNumber(sbTeamEvent?.district_points),
      district_points: analyticsSafeNumber(sbTeamEvent?.district_points),
      eventStatus: teamStatuses?.[teamKey] ?? null,
    };
  });
  const epaValues = baseRows
    .map((row) => row.overallEpa)
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map(Number);
  const oprValues = baseRows
    .map((row) => row.opr)
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map(Number);
  const epaMean = analyticsMean(epaValues) ?? 0;
  const epaStd = analyticsStddev(epaValues) ?? 1;
  const oprMean = analyticsMean(oprValues) ?? 0;
  const oprStd = analyticsStddev(oprValues) ?? 1;
  const withRaw = baseRows.map((row) => {
    const epa = row.overallEpa ?? epaMean;
    const opr = row.opr ?? oprMean;
    const zEpa = (epa - epaMean) / (epaStd || 1);
    const zOpr = Math.max(-1.75, Math.min(1.75, (opr - oprMean) / (oprStd || 1)));
    const wOpr = Math.max(0.1, Math.min(0.45, 0.1 + 0.03 * Math.max(0, row.matchesPlayed ?? 0)));
    const wEpa = 1 - wOpr;
    return {
      ...row,
      compositeRaw: wEpa * zEpa + wOpr * zOpr,
    };
  });
  const rawValues = withRaw
    .map((row) => row.compositeRaw)
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map(Number);
  const withComposite = withRaw.map((row) => ({
    ...row,
    composite:
      row.compositeRaw != null && rawValues.length
        ? (rawValues.filter((value) => value <= row.compositeRaw).length / rawValues.length) * 100
        : null,
  }));
  const sortedByComposite = [...withComposite].sort(
    (a, b) => safeNumber(b.compositeRaw, -999) - safeNumber(a.compositeRaw, -999),
  );
  const compositeRankMap = new Map<string, number>();
  sortedByComposite.forEach((row, index) => compositeRankMap.set(row.teamKey, index + 1));
  const compScoreMap = new Map<string, number>();
  withComposite.forEach((row) => compScoreMap.set(row.teamKey, row.composite ?? 0));
  function matchDifficulty(match: MatchSimple, teamKey: string): number | null {
    const isRed = match?.alliances?.red?.team_keys?.includes(teamKey);
    const isBlue = match?.alliances?.blue?.team_keys?.includes(teamKey);
    if (!isRed && !isBlue) return null;
    const oppKeys = isRed
      ? (match?.alliances?.blue?.team_keys ?? [])
      : (match?.alliances?.red?.team_keys ?? []);
    const partnerKeys = (
      isRed ? (match?.alliances?.red?.team_keys ?? []) : (match?.alliances?.blue?.team_keys ?? [])
    ).filter((key) => key !== teamKey);
    const oppAvg = analyticsMean(
      oppKeys
        .map((key) => compScoreMap.get(key) ?? null)
        .filter((value) => value != null)
        .map(Number),
    );
    const partnerAvg = analyticsMean(
      partnerKeys
        .map((key) => compScoreMap.get(key) ?? null)
        .filter((value) => value != null)
        .map(Number),
    );
    if (oppAvg == null) return null;
    return oppAvg - (partnerAvg ?? 0);
  }
  return withComposite.map((row) => {
    const quals = sortedMatches.filter(
      (match) => match?.comp_level === 'qm' && matchHasTeam(match, row.teamKey),
    );
    const played = quals.filter((match) => compareMatchPlayed(match));
    const remaining = quals.filter((match) => !compareMatchPlayed(match));
    return {
      ...row,
      compositeRank: compositeRankMap.get(row.teamKey) ?? null,
      playedSos: analyticsMean(
        played
          .map((match) => matchDifficulty(match, row.teamKey))
          .filter((value) => value != null)
          .map(Number),
      ),
      remainingSos: analyticsMean(
        remaining
          .map((match) => matchDifficulty(match, row.teamKey))
          .filter((value) => value != null)
          .map(Number),
      ),
      totalSos: analyticsMean(
        quals
          .map((match) => matchDifficulty(match, row.teamKey))
          .filter((value) => value != null)
          .map(Number),
      ),
    };
  });
}
export function buildCompareDerivedMetrics({
  seasonSummary,
  seasonRollups,
  playedEvents,
  upcomingEvents,
  seasonMatches,
  historicalEvents,
  historicalMatches,
  eventRow,
  eventMatches,
  fieldAverages,
}: CompareDerivedInput): Record<string, number | string | boolean | null> {
  const historicalSeasonEvents: LooseRecord[] = historicalEvents ?? playedEvents ?? [];
  const historicalSeasonMatches: LooseRecord[] = historicalMatches ?? seasonMatches ?? [];
  const seasonMatchEpas = (historicalSeasonMatches ?? [])
    .map((match) => analyticsSafeNumber(match?.epaTotal))
    .filter((value) => value != null)
    .map(Number);
  const seasonMatchAutos = (historicalSeasonMatches ?? [])
    .map((match) => analyticsSafeNumber(match?.breakdown?.auto_points))
    .filter((value) => value != null)
    .map(Number);
  const seasonMatchTeleops = (historicalSeasonMatches ?? [])
    .map((match) => analyticsSafeNumber(match?.breakdown?.teleop_points))
    .filter((value) => value != null)
    .map(Number);
  const seasonMatchEnds = (historicalSeasonMatches ?? [])
    .map((match) => analyticsSafeNumber(match?.breakdown?.endgame_points))
    .filter((value) => value != null)
    .map(Number);
  const eventEpas = (eventMatches ?? [])
    .map((match) => analyticsSafeNumber(match?.epaTotal))
    .filter((value) => value != null)
    .map(Number);
  const eventMargins = (eventMatches ?? [])
    .map((match) => analyticsSafeNumber(match?.margin))
    .filter((value) => value != null)
    .map(Number);
  const eventWins = (eventMatches ?? []).filter((match) => match?.result === 'win').length;
  const eventPlayed = (eventMatches ?? []).filter((match) => match?.played !== false).length;
  const eventRowOverallEpa = analyticsSafeNumber(eventRow?.overallEpa);
  const eventRowOpr = analyticsSafeNumber(eventRow?.opr);
  const eventRowComposite = analyticsSafeNumber(eventRow?.composite);
  const fieldEventEpa = analyticsSafeNumber(fieldAverages?.eventEpa);
  const fieldEventOpr = analyticsSafeNumber(fieldAverages?.eventOpr);
  const fieldEventComposite = analyticsSafeNumber(fieldAverages?.eventComposite);
  return {
    seasonCurrentEpa: seasonCurrentEpa(seasonSummary),
    seasonMeanTotal: seasonMeanTotal(seasonSummary),
    seasonAuto: seasonBreakdown(seasonSummary, 'auto_points'),
    seasonTeleop: seasonBreakdown(seasonSummary, 'teleop_points'),
    seasonEndgame: seasonBreakdown(seasonSummary, 'endgame_points'),
    seasonDistrictPoints: analyticsSafeNumber(seasonSummary?.district_points),
    seasonDistrictRank: analyticsSafeNumber(seasonSummary?.district_rank),
    seasonWorldRank: seasonRankValue(seasonSummary, 'total'),
    seasonCountryRank: seasonRankValue(seasonSummary, 'country'),
    seasonStateRank: seasonRankValue(seasonSummary, 'state'),
    seasonDistrictContextRank: seasonRankValue(seasonSummary, 'district'),
    seasonCountryPercentile: seasonPercentileValue(seasonSummary, 'country'),
    seasonDistrictPercentile: seasonPercentileValue(seasonSummary, 'district'),
    seasonWinRate: analyticsSafeNumber(seasonRollups?.winRate ?? seasonSummary?.record?.winrate),
    seasonRecordText: seasonSummary?.record
      ? `${seasonSummary.record.wins ?? 0}-${seasonSummary.record.losses ?? 0}-${seasonSummary.record.ties ?? 0}`
      : `${seasonRollups?.wins ?? 0}-${seasonRollups?.losses ?? 0}-${seasonRollups?.ties ?? 0}`,
    seasonMatchCount: analyticsSafeNumber(seasonRollups?.totalMatchCount),
    seasonQualMatchCount: analyticsSafeNumber(seasonRollups?.qualMatchCount),
    seasonPlayoffMatchCount: analyticsSafeNumber(seasonRollups?.playoffMatchCount),
    playedEventCount: analyticsSafeNumber((playedEvents ?? []).length),
    historicalPlayedEventCount: analyticsSafeNumber((historicalSeasonEvents ?? []).length),
    upcomingEventCount: analyticsSafeNumber((upcomingEvents ?? []).length),
    seasonMatchEpaMean: analyticsMean(seasonMatchEpas),
    seasonMatchEpaStdDev: analyticsStddev(seasonMatchEpas),
    seasonAutoMean: analyticsMean(seasonMatchAutos),
    seasonTeleopMean: analyticsMean(seasonMatchTeleops),
    seasonEndgameMean: analyticsMean(seasonMatchEnds),
    eventPresent: Boolean(eventRow),
    eventRank: analyticsSafeNumber(eventRow?.rank),
    eventCompositeRank: analyticsSafeNumber(eventRow?.compositeRank),
    eventTotalRp: analyticsSafeNumber(eventRow?.totalRp),
    eventRpAverage: analyticsSafeNumber(eventRow?.rpAverage),
    eventEpa: analyticsSafeNumber(eventRow?.overallEpa),
    eventAuto: analyticsSafeNumber(eventRow?.autoEpa),
    eventTeleop: analyticsSafeNumber(eventRow?.teleopEpa),
    eventEndgame: analyticsSafeNumber(eventRow?.endgameEpa),
    eventOpr: analyticsSafeNumber(eventRow?.opr),
    eventCopr: analyticsSafeNumber(eventRow?.copr),
    eventDpr: analyticsSafeNumber(eventRow?.dpr),
    eventCcwm: analyticsSafeNumber(eventRow?.ccwm),
    eventComposite: analyticsSafeNumber(eventRow?.composite),
    eventPlayedSos: analyticsSafeNumber(eventRow?.playedSos),
    eventRemainingSos: analyticsSafeNumber(eventRow?.remainingSos),
    eventTotalSos: analyticsSafeNumber(eventRow?.totalSos),
    eventStatus: eventStatusSummary(eventRow?.eventStatus),
    eventStatusHtml: eventStatusHtml(eventRow?.eventStatus),
    eventMatchCount: analyticsSafeNumber(eventPlayed),
    eventWinRate: eventPlayed > 0 ? eventWins / eventPlayed : null,
    eventMatchEpaMean: analyticsMean(eventEpas),
    eventMatchEpaStdDev: analyticsStddev(eventEpas),
    eventMarginMean: analyticsMean(eventMargins),
    eventMarginStdDev: analyticsStddev(eventMargins),
    deltaVsFieldEpa:
      eventRowOverallEpa != null && fieldEventEpa != null
        ? eventRowOverallEpa - fieldEventEpa
        : null,
    deltaVsFieldOpr:
      eventRowOpr != null && fieldEventOpr != null ? eventRowOpr - fieldEventOpr : null,
    deltaVsFieldComposite:
      eventRowComposite != null && fieldEventComposite != null
        ? eventRowComposite - fieldEventComposite
        : null,
  };
}
export function humanizeCompareKey(key: string): string {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/\brp\b/gi, 'RP')
    .replace(/\bepa\b/gi, 'EPA')
    .replace(/\bteleop\b/gi, 'Teleop')
    .replace(/\bendgame\b/gi, 'Endgame')
    .replace(/\bauto\b/gi, 'Auto')
    .replace(/\bopr\b/gi, 'OPR')
    .replace(/\bcopr\b/gi, 'COPR')
    .replace(/\bccwm\b/gi, 'CCWM')
    .replace(/\bsos\b/gi, 'SOS')
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}
export function collectCompareBreakdownKeys(teamRows: LooseRecord[]): string[] {
  const keys = new Set<string>();
  for (const row of teamRows ?? []) {
    Object.keys(row?.seasonSummary?.epa?.breakdown ?? {}).forEach((key) => keys.add(key));
    Object.keys(row?.eventMatches?.[0]?.breakdown ?? {}).forEach((key) => keys.add(key));
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}
export function partitionItemsByEventKey<T extends { eventKey?: string; event?: string }>(
  items: T[],
  loadedEventKey: string,
): {
  currentEventItems: T[];
  historicalItems: T[];
} {
  const currentEventItems: T[] = [];
  const historicalItems: T[] = [];
  for (const item of items ?? []) {
    if (loadedEventKey && String(item?.eventKey ?? item?.event ?? '') === loadedEventKey) {
      currentEventItems.push(item);
    } else {
      historicalItems.push(item);
    }
  }
  return { currentEventItems, historicalItems };
}
export function buildHistoricalEventRows(
  playedEvents: ExternalArray,
  upcomingEvents: ExternalArray,
  loadedEventKey: string,
): LooseRecord[] {
  return [...(playedEvents ?? []), ...(upcomingEvents ?? [])].filter(
    (row) => !loadedEventKey || String(row?.event ?? '') !== loadedEventKey,
  );
}
