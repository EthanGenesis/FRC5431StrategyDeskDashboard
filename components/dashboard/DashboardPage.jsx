'use client';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../lib/storage';
import YouTubeWebcastPlayer from '../YouTubeWebcastPlayer';
import PageHeader from '../ui/PageHeader';
import ProductClock from '../ui/ProductClock';
import DisclosureSection from '../ui/DisclosureSection';
import DashboardPreferencesProvider from '../providers/DashboardPreferencesProvider';
import { createSupabaseBrowserClient } from '../../lib/supabase-browser';
import {
  addTeamToCompareDraftShared,
  loadNamedArtifactsShared,
  loadWorkspaceSettings,
  mergeWorkspaceSettingsIntoSettings,
  saveNamedArtifactsShared,
  saveWorkspaceSettings,
} from '../../lib/shared-workspace-browser';
import { getEventWorkspaceKey } from '../../lib/workspace-key';
import { fetchJsonOrThrow } from '../../lib/httpCache';
import { PERSISTENCE_TABLES } from '../../lib/persistence-surfaces';
import { isSupabaseConfigured } from '../../lib/supabase';
import { getYouTubeVideoIdFromWebcast, isYouTubeEmbedCapableWebcast } from '../../lib/webcast';
import {
  allianceForTeam,
  bestCountdownUnix,
  clamp,
  formatCountdown,
  formatMatchLabel,
  matchHasTeam,
  percentileRank,
  realPointerIndex,
  safeNumber,
  sortMatches,
  teamNumberFromKey,
  tbaTeamKey,
} from '../../lib/logic';
import { deriveTeamOpsFromNexusSnapshot } from '../../lib/nexus-ops';
import { buildAllianceCandidateInsights } from '../../lib/alliance-insights';
import {
  LANGUAGE_OPTIONS,
  THEME_OPTIONS,
  WEBHOOK_EVENT_OPTIONS,
  formatLocalizedDateTime,
  normalizeTranslationKey,
  translate,
} from '../../lib/product-preferences';

function DeferredPanelPlaceholder({ label = 'Loading section...' }) {
  return (
    <section className="card" aria-busy="true">
      <div className="muted">{label}</div>
    </section>
  );
}

const deferredPanel = (loader, label) =>
  dynamic(loader, {
    ssr: false,
    loading: () => <DeferredPanelPlaceholder label={label} />,
  });

const StrategyWorkspace = deferredPanel(
  () => import('../StrategyWorkspace'),
  'Loading strategy workspace...',
);
const TeamProfileTab = deferredPanel(() => import('../TeamProfileTab'), 'Loading team profile...');
const PreEventTab = deferredPanel(() => import('../PreEventTab'), 'Loading season scouting...');
const CompareTab = deferredPanel(() => import('../CompareTab'), 'Loading compare tools...');
const AnalyticsChartBlock = deferredPanel(
  () => import('../AnalyticsChartBlock'),
  'Loading chart...',
);
const TeamContextAnalyticsBlock = deferredPanel(
  () => import('../TeamContextAnalyticsBlock'),
  'Loading team context...',
);
const DataSuperTab = deferredPanel(() => import('../DataSuperTab'), 'Loading data explorer...');
const RawPayloadExplorer = deferredPanel(
  () => import('../RawPayloadExplorer'),
  'Loading payload explorer...',
);
const DistrictPointsTab = deferredPanel(
  () => import('../DistrictPointsTab'),
  'Loading district points...',
);
const GameManualTab = deferredPanel(() => import('../GameManualTab'), 'Loading game manual...');

const EVENT_SEARCH_YEAR = 2026;
const AUDIO_PATTERN_BY_QUEUE = {
  QUEUE_5: [0],
  QUEUE_2: [0, 0.18],
  QUEUE_1: [0, 0.14, 0.28],
  PLAYING_NOW: [0, 0.12, 0.24, 0.38],
  TEST: [0, 0.12, 0.28],
};

function pct(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${Math.round(Number(value) * 100)}%`;
}
function fmt(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(digits);
}
function pctPrecise(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value) * 100;
  if (n === 0) return '0%';
  if (n < 0.1) return `${n.toFixed(2)}%`;
  if (n < 1) return `${n.toFixed(1)}%`;
  return `${n.toFixed(1)}%`;
}
function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function stddev(values) {
  if (!values.length) return 1;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / values.length;
  const s = Math.sqrt(variance);
  return s > 0 ? s : 1;
}
function averageNullable(values) {
  const cleaned = values.filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  if (!cleaned.length) return null;
  return mean(cleaned);
}
function permutationCount(n, k) {
  const total = Math.max(0, Math.floor(Number(n) || 0));
  const picked = Math.max(0, Math.floor(Number(k) || 0));
  if (!total || !picked || picked > total) return 0n;
  let out = 1n;
  for (let index = 0; index < picked; index += 1) {
    out *= BigInt(total - index);
  }
  return out;
}
function combinationCount(n, k) {
  const total = Math.max(0, Math.floor(Number(n) || 0));
  const picked = Math.max(0, Math.floor(Number(k) || 0));
  if (!total || !picked || picked > total) return 0n;
  const effectivePicked = Math.min(picked, total - picked);
  let numerator = 1n;
  let denominator = 1n;
  for (let index = 1; index <= effectivePicked; index += 1) {
    numerator *= BigInt(total - effectivePicked + index);
    denominator *= BigInt(index);
  }
  return numerator / denominator;
}
function formatBigInt(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function normalizeEventKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}
function topInsightRows(rows, key) {
  return [...rows].sort((a, b) => Number(b?.[key] ?? 0) - Number(a?.[key] ?? 0)).slice(0, 3);
}
function parseLocalDateOnly(value) {
  if (typeof value !== 'string' || !value) return null;
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}
function dayDiff(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}
function extractSbMatchKey(item) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.key === 'string') return item.key;
  if (typeof item.match === 'string') return item.match;
  return null;
}
function extractSbTeamNumber(item) {
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
    const s = raw.startsWith('frc') ? raw.slice(3) : raw;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function getSbPred(match) {
  return match?.pred ?? null;
}
function matchIsCompleted(match) {
  const rs = match?.alliances?.red?.score;
  const bs = match?.alliances?.blue?.score;
  const hasScore = typeof rs === 'number' && typeof bs === 'number' && rs >= 0 && bs >= 0;
  return hasScore || match?.actual_time != null || match?.post_result_time != null;
}
function getLiveCountdownUnix(match) {
  const t = bestCountdownUnix(match);
  return t != null && Number.isFinite(Number(t)) ? Number(t) : null;
}
function collectNumericCandidates(obj, path = '', out = []) {
  if (obj == null) return out;
  if (typeof obj === 'number' && Number.isFinite(obj)) {
    out.push({ path, value: obj });
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => collectNumericCandidates(v, `${path}[${i}]`, out));
    return out;
  }
  if (typeof obj === 'object') {
    Object.entries(obj).forEach(([k, v]) =>
      collectNumericCandidates(v, path ? `${path}.${k}` : k, out),
    );
  }
  return out;
}
function extractKnownRpFromMatch(match, alliance) {
  const sb = match?.score_breakdown?.[alliance];
  if (!sb || typeof sb !== 'object') return null;
  const candidates = collectNumericCandidates(sb);
  const strong = candidates.find((c) =>
    /(^|\.)(rp|rankingPoints|ranking_points|totalRp|total_rp)$/i.test(c.path),
  );
  if (strong) return strong.value;
  const weak = candidates.find((c) => /rp|ranking/i.test(c.path));
  if (weak) return weak.value;
  return null;
}
function parseQualMatchNumber(match) {
  if (!match || match.comp_level !== 'qm') return null;
  const direct = Number(match.match_number);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  const nameMatch = String(match.match_name ?? '').match(/Qual\s+(\d+)/i);
  if (nameMatch) return Number(nameMatch[1]);
  const keyMatch = String(match.key ?? '').match(/_qm(\d+)$/i);
  if (keyMatch) return Number(keyMatch[1]);
  return null;
}
function solveLinearSystem(matrix, rhs) {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i] ?? 0]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (pivot !== col) [a[col], a[pivot]] = [a[pivot], a[col]];
    const pivotVal = a[col][col];
    if (Math.abs(pivotVal) < 1e-9) continue;
    for (let c = col; c <= n; c += 1) a[col][c] /= pivotVal;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = a[r][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let c = col; c <= n; c += 1) a[r][c] -= factor * a[col][c];
    }
  }
  return a.map((row) => (Number.isFinite(row[n]) ? row[n] : 0));
}
function buildLinearStats(matches, teamKeys) {
  const idx = new Map();
  teamKeys.forEach((key, i) => idx.set(key, i));
  const n = teamKeys.length;
  const ata = Array.from({ length: n }, () => Array(n).fill(0));
  const atbOpr = Array(n).fill(0);
  const atbDpr = Array(n).fill(0);
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
      const ids = alliance.teams.map((k) => idx.get(k)).filter((v) => v != null);
      for (const i of ids) {
        atbOpr[i] += alliance.scoreFor;
        atbDpr[i] += alliance.scoreAgainst;
        for (const j of ids) ata[i][j] += 1;
      }
    }
  }
  for (let i = 0; i < n; i += 1) ata[i][i] += 1e-6;
  const opr = solveLinearSystem(
    ata.map((row) => [...row]),
    atbOpr,
  );
  const dpr = solveLinearSystem(
    ata.map((row) => [...row]),
    atbDpr,
  );
  const ccwm = opr.map((v, i) => v - (dpr[i] ?? 0));
  return { opr, dpr, ccwm, idx };
}
function rankRowsByRp(rows) {
  const sorted = [...rows].sort((a, b) => {
    const totalA = Number.isFinite(Number(a?.totalRp)) ? Number(a.totalRp) : -Infinity;
    const totalB = Number.isFinite(Number(b?.totalRp)) ? Number(b.totalRp) : -Infinity;
    if (totalB !== totalA) return totalB - totalA;
    const avgA = Number.isFinite(Number(a?.rpAverage)) ? Number(a.rpAverage) : -Infinity;
    const avgB = Number.isFinite(Number(b?.rpAverage)) ? Number(b.rpAverage) : -Infinity;
    if (avgB !== avgA) return avgB - avgA;
    const winsA = Number(String(a?.record ?? '0-0-0').split('-')[0] ?? 0);
    const winsB = Number(String(b?.record ?? '0-0-0').split('-')[0] ?? 0);
    if (winsB !== winsA) return winsB - winsA;
    const compA = Number.isFinite(Number(a?.composite)) ? Number(a.composite) : -Infinity;
    const compB = Number.isFinite(Number(b?.composite)) ? Number(b.composite) : -Infinity;
    if (compB !== compA) return compB - compA;
    return String(a?.teamKey ?? '').localeCompare(String(b?.teamKey ?? ''));
  });
  const out = new Map();
  sorted.forEach((row, idx) => out.set(String(row.teamKey), idx + 1));
  return out;
}
function buildKeyMatchNarrative(
  match,
  rivalTeamKey,
  ourTotalRp,
  eventRowMap,
  sbMatchMap,
  loadedTeam,
) {
  if (!rivalTeamKey) return 'Relevant match in our rival band.';
  const rival = eventRowMap.get(rivalTeamKey);
  const ourKey = loadedTeam != null ? tbaTeamKey(loadedTeam) : '';
  const ourRow = eventRowMap.get(ourKey);
  const pred = getSbPred(sbMatchMap.get(match.key));
  const onRed = match.alliances.red.team_keys.includes(rivalTeamKey);
  const rivalWin =
    pred?.red_win_prob != null
      ? onRed
        ? Number(pred.red_win_prob)
        : 1 - Number(pred.red_win_prob)
      : null;
  const gap = ourTotalRp != null && rival?.totalRp != null ? rival.totalRp - ourTotalRp : null;
  const side = onRed ? 'red' : 'blue';
  const partnerText = (onRed ? match.alliances.red.team_keys : match.alliances.blue.team_keys)
    .filter((k) => k !== rivalTeamKey)
    .join(', ');
  const oppText = (onRed ? match.alliances.blue.team_keys : match.alliances.red.team_keys).join(
    ', ',
  );
  const gapText =
    gap == null ? 'unknown RP gap' : `${gap >= 0 ? '+' : ''}${fmt(gap, 1)} TOTAL RP vs us`;
  const winText = rivalWin == null ? 'unknown win chance' : `${pct(rivalWin)} rival win chance`;
  const ourRankText = ourRow?.rank != null ? `We are rank ${ourRow.rank}.` : '';
  return `${rivalTeamKey} is on ${side} with ${partnerText}. Opposing alliance: ${oppText}. Current gap: ${gapText}. ${winText}. ${ourRankText}`;
}
function getSbOverallEpa(teamEvent) {
  const v = teamEvent?.epa?.total_points?.mean ?? teamEvent?.norm_epa?.current;
  return Number.isFinite(Number(v)) ? Number(v) : null;
}
function getSbAutoEpa(teamEvent) {
  const v = teamEvent?.epa?.breakdown?.auto_points;
  return Number.isFinite(Number(v)) ? Number(v) : null;
}
function getSbTeleopEpa(teamEvent) {
  const v = teamEvent?.epa?.breakdown?.teleop_points;
  return Number.isFinite(Number(v)) ? Number(v) : null;
}
function getSbEndgameEpa(teamEvent) {
  const v = teamEvent?.epa?.breakdown?.endgame_points;
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function webcastStateIsContinuing(value) {
  return value === 'playing' || value === 'buffering';
}

function webcastStateStopsFloating(value) {
  return value === 'ended' || value === 'error';
}

function readSessionStorageValue(key) {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionStorageValue(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Ignore storage failures so restrictive mobile browsers do not crash the app.
  }
}

function removeSessionStorageValue(key) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore storage failures so restrictive mobile browsers do not crash the app.
  }
}

function getStickyViewportTopInset() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 0;

  return ['.dashboard-productbar', '.dashboard-topbar'].reduce((maxBottom, selector) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) return maxBottom;

    const style = window.getComputedStyle(element);
    if (style.position !== 'sticky' && style.position !== 'fixed') return maxBottom;

    const rect = element.getBoundingClientRect();
    if (rect.bottom <= 0) return maxBottom;

    return Math.max(maxBottom, rect.bottom);
  }, 0);
}

const CURRENT_TABS = [
  'NOW',
  'SCHEDULE',
  'MATCH',
  'STRATEGY',
  'GAME MANUAL',
  'DISTRICT',
  'COMPARE',
  'TEAM_PROFILE',
  'RANKINGS',
  'PLAYOFFS',
  'EVENT',
  'DATA',
];

const HISTORICAL_TABS = [
  'PRE_EVENT',
  'STRATEGY',
  'DISTRICT',
  'COMPARE',
  'TEAM_PROFILE',
  'RANKINGS',
  'PLAYOFFS',
  'EVENT',
  'DATA',
];

const PREDICT_TABS = ['PREDICT', 'ALLIANCE', 'PLAYOFF_LAB', 'IMPACT', 'PICK_LIST', 'LIVE_ALLIANCE'];

const PAGE_META = {
  CURRENT: {
    NOW: {
      eyebrow: 'Current / Overview',
      title: 'Live Match Queue',
      description:
        'Monitor the next match, rival pressure, countdown context, and the few things that matter most right now.',
      template: 'Overview',
    },
    SCHEDULE: {
      eyebrow: 'Current / Schedule',
      title: 'Event Schedule',
      description:
        'Track our remaining matches, timing pressure, and the teams we need to prepare for next.',
      template: 'Overview',
    },
    MATCH: {
      eyebrow: 'Current / Match',
      title: 'Match Detail',
      description:
        'Review one match deeply with alliance context, predictions, and tactical implications before queuing.',
      template: 'Workbench',
    },
    STRATEGY: {
      eyebrow: 'Current / Strategy',
      title: 'Strategy Workspace',
      description:
        'Build and save match plans, field diagrams, and team notes without losing live event context.',
      template: 'Workbench',
    },
    'GAME MANUAL': {
      eyebrow: 'Current / Reference',
      title: '2026 Game Manual',
      description:
        'Search, read, and reference the official manual in-product while staying in your event workflow.',
      template: 'Reference',
    },
    DISTRICT: {
      eyebrow: 'Current / District',
      title: 'District Points',
      description:
        'See live district context, event distributions, and manual what-if calculations for the current event.',
      template: 'Workbench',
    },
    COMPARE: {
      eyebrow: 'Current / Compare',
      title: 'Team Comparison',
      description:
        'Compare shortlists, evaluate role fit, and keep the exact numbers visible across teams.',
      template: 'Workbench',
    },
    TEAM_PROFILE: {
      eyebrow: 'Current / Team Profile',
      title: 'Team Profile',
      description:
        'Open a single team’s live event view with scouting context, analytics, and season framing.',
      template: 'Workbench',
    },
    RANKINGS: {
      eyebrow: 'Current / Rankings',
      title: 'Rankings Pressure',
      description:
        'Understand ranking movement, RP pressure, and the neighbors who matter most to our current position.',
      template: 'Overview',
    },
    PLAYOFFS: {
      eyebrow: 'Current / Playoffs',
      title: 'Playoff Context',
      description:
        'Track alliance formation, likely bracket paths, and how the live field may unfold from here.',
      template: 'Workbench',
    },
    EVENT: {
      eyebrow: 'Current / Event',
      title: 'Event Context',
      description:
        'Review the full event picture with teams, match status, and the supporting analytics behind the live state.',
      template: 'Workbench',
    },
    DATA: {
      eyebrow: 'Current / Data',
      title: 'Data Super Tab',
      description:
        'Dive into metrics, breakdown matrices, and chartable event data without losing analyst-grade density.',
      template: 'Workbench',
    },
  },
  HISTORICAL: {
    PRE_EVENT: {
      eyebrow: 'Historical / Pre-Event',
      title: 'Season Scouting',
      description:
        'Review historical event, team, ranking, and playoff context through a season-wide scouting lens.',
      template: 'Workbench',
    },
    STRATEGY: {
      eyebrow: 'Historical / Strategy',
      title: 'Historical Strategy',
      description:
        'Revisit prior match plans, compare saved strategy boards, and learn from completed events.',
      template: 'Workbench',
    },
    DISTRICT: {
      eyebrow: 'Historical / District',
      title: 'Season District Outlook',
      description:
        'See cut lines, probability bands, and season-range outcomes for district advancement.',
      template: 'Overview',
    },
    COMPARE: {
      eyebrow: 'Historical / Compare',
      title: 'Season Team Comparison',
      description:
        'Compare teams across season trends, match logs, and historical role fit with exact metrics.',
      template: 'Workbench',
    },
    TEAM_PROFILE: {
      eyebrow: 'Historical / Team Profile',
      title: 'Season Team Profile',
      description:
        'Open a season-centric team profile with event history, breakdowns, and reference analytics.',
      template: 'Workbench',
    },
    RANKINGS: {
      eyebrow: 'Historical / Rankings',
      title: 'Historical Rankings',
      description:
        'Study prior ranking movement, event tables, and where teams actually landed after play was complete.',
      template: 'Overview',
    },
    PLAYOFFS: {
      eyebrow: 'Historical / Playoffs',
      title: 'Historical Playoffs',
      description:
        'Review alliance outcomes, bracket results, and the playoff picture from completed events.',
      template: 'Workbench',
    },
    EVENT: {
      eyebrow: 'Historical / Event',
      title: 'Historical Event Context',
      description:
        'Explore full prior-event context without disturbing the live-event workflow in Current.',
      template: 'Workbench',
    },
    DATA: {
      eyebrow: 'Historical / Data',
      title: 'Historical Data Super Tab',
      description:
        'Analyze season and event history with the same dense metric tools used in live operations.',
      template: 'Workbench',
    },
  },
  PREDICT: {
    PREDICT: {
      eyebrow: 'Predict / Forecast',
      title: 'Qualification Forecast',
      description:
        'Run forecast scenarios, compare likely ranking movement, and see the live projection story clearly.',
      template: 'Workbench',
    },
    ALLIANCE: {
      eyebrow: 'Predict / Alliance',
      title: 'Alliance Selection',
      description:
        'Model alliance creation, evaluate fit, and keep likely captain paths visible as the board changes.',
      template: 'Workbench',
    },
    PLAYOFF_LAB: {
      eyebrow: 'Predict / Playoff Lab',
      title: 'Playoff Simulation Lab',
      description:
        'Stress-test bracket outcomes, compare scenarios, and understand how matchup assumptions change the field.',
      template: 'Workbench',
    },
    IMPACT: {
      eyebrow: 'Predict / Impact',
      title: 'Impact Simulator',
      description:
        'See how different RP results and match outcomes change ranking pressure around our team.',
      template: 'Overview',
    },
    PICK_LIST: {
      eyebrow: 'Predict / Pick Lists',
      title: 'Pick Lists',
      description:
        'Maintain role-aware shortlist views with comments, tags, and priority movement as the event evolves.',
      template: 'Workbench',
    },
    LIVE_ALLIANCE: {
      eyebrow: 'Predict / Live Alliance',
      title: 'Live Alliance Board',
      description:
        'Track live alliance selection in a purpose-built board without losing the wider strategic context.',
      template: 'Workbench',
    },
  },
  SETTINGS: {
    SETTINGS: {
      eyebrow: 'System / Settings',
      title: 'Product Controls',
      description:
        'Manage polling, diagnostics, branding assets, and raw payload inspection for troubleshooting and tuning.',
      template: 'Reference',
    },
  },
};

function pageMetaTranslationKey(majorTab, tab, field) {
  return `page.${normalizeTranslationKey(majorTab)}.${normalizeTranslationKey(tab)}.${field}`;
}

function subTabTranslationKey(majorTab, tab) {
  return `nav.sub.${normalizeTranslationKey(majorTab)}.${normalizeTranslationKey(tab)}`;
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export default function HomePage() {
  const MONTE_CARLO_SCENARIO_DEPTH = 12;
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [localSettingsReady, setLocalSettingsReady] = useState(false);
  const [draftTeam, setDraftTeam] = useState(5431);
  const [draftEventKey, setDraftEventKey] = useState('');
  const [loadedTeam, setLoadedTeam] = useState(null);
  const [loadedEventKey, setLoadedEventKey] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [lastSnapshotMeta, setLastSnapshotMeta] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlineAdvance, setOfflineAdvance] = useState(0);
  const [majorTab, setMajorTab] = useState('CURRENT');
  const [currentSubTab, setCurrentSubTab] = useState('NOW');
  const [historicalSubTab, setHistoricalSubTab] = useState('PRE_EVENT');
  const [predictSubTab, setPredictSubTab] = useState('PREDICT');
  const [scheduleView, setScheduleView] = useState('ourUpcoming');
  const [selectedMatchKey, setSelectedMatchKey] = useState(null);
  const [selectedTeamNumber, setSelectedTeamNumber] = useState(null);
  const [strategyTarget, setStrategyTarget] = useState(null);
  const [historicalStrategyTarget, setHistoricalStrategyTarget] = useState(null);
  const [currentTeamProfileForcedTeamNumber, setCurrentTeamProfileForcedTeamNumber] =
    useState(null);
  const [historicalTeamProfileForcedTeamNumber, setHistoricalTeamProfileForcedTeamNumber] =
    useState(null);
  const [teamSearch, setTeamSearch] = useState('');
  const [eventSortMode, setEventSortMode] = useState('rank');
  const [eventAfterQualInput, setEventAfterQualInput] = useState('0');
  const [nowMs, setNowMs] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioStatusText, setAudioStatusText] = useState('');
  const [settingsRawPayloadOpen, setSettingsRawPayloadOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('');
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0);
  const [eventSearchOptions, setEventSearchOptions] = useState([]);
  const [eventSearchOpen, setEventSearchOpen] = useState(false);
  const [eventSearchLoading, setEventSearchLoading] = useState(false);
  const [webhookDelivery, setWebhookDelivery] = useState({
    pending: false,
    lastSuccessAtMs: null,
    lastFailureAtMs: null,
    lastFailureText: '',
  });
  // Predict / scenario state
  const [predictFilter, setPredictFilter] = useState('future');
  const [predictOverrides, setPredictOverrides] = useState({});
  const [simRuns, setSimRuns] = useState(1000);
  const [savedPredictScenarios, setSavedPredictScenarios] = useState([]);
  const [savedAllianceScenarios, setSavedAllianceScenarios] = useState([]);
  const [selectedPredictScenarioId, setSelectedPredictScenarioId] = useState('live');
  const [allianceSourceType, setAllianceSourceType] = useState('live');
  const [allianceSourceId, setAllianceSourceId] = useState('live');
  const [alliancePickTarget, setAlliancePickTarget] = useState('');
  const [playoffLabSourceType, setPlayoffLabSourceType] = useState('live');
  const [playoffLabSourceId, setPlayoffLabSourceId] = useState('live');
  const [playoffLabWinners, setPlayoffLabWinners] = useState({});
  const [impactSelectedMatchKey, setImpactSelectedMatchKey] = useState(null);
  const [predictScenarioMode, setPredictScenarioMode] = useState('manual');
  const [allianceLiveLocked, setAllianceLiveLocked] = useState(false);
  const [allianceSortMode, setAllianceSortMode] = useState('composite');
  const [mcScenarioSelection, setMcScenarioSelection] = useState('most_likely');
  const [mcProjectionSnapshot, setMcProjectionSnapshot] = useState(null);
  const [mcProjectionDirty, setMcProjectionDirty] = useState(false);
  const [lastMcCompletedQualCount, setLastMcCompletedQualCount] = useState(0);
  const [pickLists, setPickLists] = useState([]);
  const [activePickListId, setActivePickListId] = useState('live_picklist');
  const [pickListEntry, setPickListEntry] = useState('');
  const [pickListTarget, setPickListTarget] = useState('first');
  const [pickListComment, setPickListComment] = useState('');
  const [pickListTag, setPickListTag] = useState('');
  const [liveAllianceRuntime, setLiveAllianceRuntime] = useState(null);
  const [liveAlliancePulledAt, setLiveAlliancePulledAt] = useState(null);
  const [liveAlliancePickTarget, setLiveAlliancePickTarget] = useState('');
  const [playoffSimModel, setPlayoffSimModel] = useState('composite');
  const [savedPlayoffResults, setSavedPlayoffResults] = useState([]);
  const [activePlayoffResultId, setActivePlayoffResultId] = useState('');
  const [playoffSimRuns, setPlayoffSimRuns] = useState(1000);
  const [scenarioCompareSort, setScenarioCompareSort] = useState('furthest');
  const [currentCompareSyncKey, setCurrentCompareSyncKey] = useState(0);
  const [historicalCompareSyncKey, setHistoricalCompareSyncKey] = useState(0);
  const [sharedWorkspaceReady, setSharedWorkspaceReady] = useState(false);
  const [hydratedWorkspaceKey, setHydratedWorkspaceKey] = useState(null);
  const webhookSentAtRef = useRef(new Map());
  const previousQueueStateRef = useRef(null);
  const previousOfflineModeRef = useRef(null);
  const snapshotHealthRef = useRef(null);
  const skipSharedSettingsSaveRef = useRef(false);
  const skipPredictSaveRef = useRef(false);
  const skipAllianceSaveRef = useRef(false);
  const skipPickListSaveRef = useRef(false);
  const skipPlayoffSaveRef = useRef(false);
  const commandPaletteInputRef = useRef(null);
  const eventSearchAbortRef = useRef(null);
  const eventSearchInputRef = useRef(null);
  const audioContextRef = useRef(null);
  const tab =
    majorTab === 'CURRENT'
      ? currentSubTab
      : majorTab === 'HISTORICAL'
        ? historicalSubTab
        : majorTab === 'PREDICT'
          ? predictSubTab
          : 'SETTINGS';

  const subTabs =
    majorTab === 'CURRENT'
      ? CURRENT_TABS
      : majorTab === 'HISTORICAL'
        ? HISTORICAL_TABS
        : majorTab === 'PREDICT'
          ? PREDICT_TABS
          : [];
  const activeWorkspaceKey = useMemo(() => getEventWorkspaceKey(loadedEventKey), [loadedEventKey]);

  const activePageMeta = PAGE_META[majorTab]?.[tab] ?? PAGE_META.SETTINGS.SETTINGS;
  const language = settings.language ?? 'en';
  const sourceValidation = snapshot?.validation ?? null;
  const officialSnapshot = snapshot?.official ?? null;
  const nexusSnapshot = snapshot?.nexus ?? null;
  const mediaSnapshot = snapshot?.media ?? null;
  const liveSignals = useMemo(
    () => (Array.isArray(snapshot?.liveSignals) ? snapshot.liveSignals : []),
    [snapshot?.liveSignals],
  );
  const t = useCallback(
    (key, fallback, vars) => translate(language, key, fallback, vars),
    [language],
  );
  const localizedPageMeta = useMemo(
    () => ({
      eyebrow: t(pageMetaTranslationKey(majorTab, tab, 'eyebrow'), activePageMeta.eyebrow),
      title: t(pageMetaTranslationKey(majorTab, tab, 'title'), activePageMeta.title),
      description: t(
        pageMetaTranslationKey(majorTab, tab, 'description'),
        activePageMeta.description,
      ),
      template:
        activePageMeta.template === 'Overview'
          ? t('template.overview', 'Overview')
          : activePageMeta.template === 'Reference'
            ? t('template.reference', 'Reference')
            : t('template.workbench', 'Workbench'),
    }),
    [
      activePageMeta.description,
      activePageMeta.eyebrow,
      activePageMeta.template,
      activePageMeta.title,
      majorTab,
      t,
      tab,
    ],
  );
  const competitionHeaderMeta = useMemo(() => {
    const event = snapshot?.tba?.event ?? null;
    const competitionName = String(event?.short_name ?? event?.name ?? loadedEventKey ?? '').trim();
    if (!competitionName) return null;

    const start = parseLocalDateOnly(event?.start_date);
    const end = parseLocalDateOnly(event?.end_date) ?? start;
    let competitionDayText = '';

    if (start && end) {
      const totalDays = Math.max(1, dayDiff(end, start) + 1);
      const today = new Date(nowMs);
      const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const currentDay = clamp(dayDiff(todayDate, start) + 1, 1, totalDays);
      competitionDayText =
        totalDays > 1
          ? `${t('field.day', 'Day')} ${currentDay}/${totalDays}`
          : `${t('field.day', 'Day')} ${currentDay}`;
    }

    return {
      competitionName,
      competitionDayText,
    };
  }, [loadedEventKey, nowMs, snapshot?.tba?.event, t]);
  const sourceStatusBadgeClass = (status) => {
    if (status === 'available') return 'badge-green';
    if (status === 'partial') return 'badge-yellow';
    if (status === 'error') return 'badge-red';
    return '';
  };
  const sourceStatusLabel = (status) => {
    if (status === 'available') return t('status.available', 'Available');
    if (status === 'partial') return t('status.partial', 'Partial');
    if (status === 'error') return t('status.error', 'Error');
    if (status === 'unsupported') return t('status.unsupported', 'Unsupported');
    return t('status.disabled', 'Disabled');
  };
  const validationCounts = useMemo(() => {
    const discrepancies = Array.isArray(sourceValidation?.discrepancies)
      ? sourceValidation.discrepancies
      : [];
    return {
      match: discrepancies.filter((item) => item.status === 'match').length,
      mismatch: discrepancies.filter((item) => item.status === 'mismatch').length,
      missing: discrepancies.filter((item) => item.status === 'missing').length,
    };
  }, [sourceValidation]);
  const recentLiveSignals = useMemo(() => liveSignals.slice(0, 6), [liveSignals]);
  const lastLiveSignal = recentLiveSignals[0] ?? null;
  const priorityLiveSignal = useMemo(
    () =>
      recentLiveSignals.find((signal) =>
        ['alliance_selection', 'broadcast'].includes(String(signal?.signalType ?? '')),
      ) ?? null,
    [recentLiveSignals],
  );
  const featuredLiveSignal =
    lastLiveSignal &&
    ['alliance_selection', 'broadcast'].includes(String(lastLiveSignal.signalType ?? ''))
      ? lastLiveSignal
      : priorityLiveSignal;
  const preferredWebcast = useMemo(
    () => mediaSnapshot?.webcasts?.find((entry) => entry?.embedUrl || entry?.url) ?? null,
    [mediaSnapshot],
  );
  const preferredYouTubeWebcast = useMemo(
    () => (isYouTubeEmbedCapableWebcast(preferredWebcast) ? preferredWebcast : null),
    [preferredWebcast],
  );
  const preferredYouTubeVideoId = useMemo(
    () => getYouTubeVideoIdFromWebcast(preferredYouTubeWebcast),
    [preferredYouTubeWebcast],
  );
  const currentEventName = snapshot?.tba?.event?.name ?? loadedEventKey ?? 'Current event';
  const inlineWebcastAnchorRef = useRef(null);
  const [webcastPlayerState, setWebcastPlayerState] = useState({
    videoId: null,
    ready: false,
    playbackState: 'unstarted',
    currentTime: 0,
    floatingVisible: false,
    suppressed: false,
    errorText: '',
  });
  const [inlineWebcastInView, setInlineWebcastInView] = useState(true);
  const [persistedWebcastSuppressed, setPersistedWebcastSuppressed] = useState(false);
  const officialCounts = sourceValidation?.officialCounts ?? null;
  const firstZeroCounts =
    sourceValidation?.firstStatus === 'error' &&
    officialCounts &&
    !officialCounts.eventPresent &&
    Number(officialCounts.rankings ?? 0) === 0 &&
    Number(officialCounts.matches ?? 0) === 0 &&
    Number(officialCounts.awards ?? 0) === 0;
  const firstErrorHint = firstZeroCounts
    ? 'FIRST error with zero official counts usually indicates production auth/config or upstream availability.'
    : '';
  const teamScopedEventSearch = Number.isFinite(Number(draftTeam)) && Number(draftTeam) > 0;
  const visibleEventSearchOptions = eventSearchOptions.slice(0, 10);
  const showEventSearchResults =
    eventSearchOpen && (eventSearchLoading || visibleEventSearchOptions.length > 0);
  const loadedTeamOps = useMemo(
    () =>
      nexusSnapshot?.loadedTeamOps ??
      deriveTeamOpsFromNexusSnapshot(nexusSnapshot, loadedTeam ?? null),
    [loadedTeam, nexusSnapshot],
  );
  const isNowTab = majorTab === 'CURRENT' && currentSubTab === 'NOW';
  const webcastPlaybackSuppressed =
    webcastPlayerState.suppressed || Boolean(persistedWebcastSuppressed);
  const webcastPlaybackContinuing = webcastStateIsContinuing(webcastPlayerState.playbackState);
  const showScrollPictureInPicture = Boolean(
    isNowTab &&
    preferredYouTubeVideoId &&
    !webcastPlaybackSuppressed &&
    !inlineWebcastInView &&
    (webcastPlaybackContinuing || webcastPlayerState.floatingVisible),
  );
  const showFloatingWebcast = Boolean(
    preferredYouTubeVideoId &&
    !webcastPlaybackSuppressed &&
    (showScrollPictureInPicture ||
      webcastPlayerState.floatingVisible ||
      (!isNowTab && webcastPlaybackContinuing)),
  );
  const showInlineWebcast = Boolean(isNowTab && preferredYouTubeVideoId && !showFloatingWebcast);
  const pitAddressRows = useMemo(() => {
    const rows = Object.entries(nexusSnapshot?.pitAddressByTeam ?? {}).map(([teamNumber, pit]) => ({
      teamNumber: Number(teamNumber),
      pitAddress: pit,
    }));
    return rows.sort((a, b) => {
      if (a.teamNumber === loadedTeam) return -1;
      if (b.teamNumber === loadedTeam) return 1;
      return a.teamNumber - b.teamNumber;
    });
  }, [loadedTeam, nexusSnapshot?.pitAddressByTeam]);
  const inspectionRows = useMemo(() => {
    const rows = Object.entries(nexusSnapshot?.inspectionByTeam ?? {}).map(
      ([teamNumber, status]) => ({
        teamNumber: Number(teamNumber),
        status,
      }),
    );
    return rows.sort((a, b) => {
      if (a.teamNumber === loadedTeam) return -1;
      if (b.teamNumber === loadedTeam) return 1;
      return a.teamNumber - b.teamNumber;
    });
  }, [loadedTeam, nexusSnapshot?.inspectionByTeam]);
  const formatOpsTime = useCallback(
    (value) => {
      if (!Number.isFinite(Number(value))) return '—';
      return formatLocalizedDateTime(Number(value), language, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    },
    [language],
  );
  const renderTeamOpsBadges = useCallback(
    (teamNumber, { emphasizeLoaded = false } = {}) => {
      if (teamNumber == null) return null;
      const ops = deriveTeamOpsFromNexusSnapshot(nexusSnapshot, teamNumber);
      if (!ops) return null;
      return (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {emphasizeLoaded ? <span className="badge badge-green">Loaded Team Ops</span> : null}
          {ops.pitAddress ? <span className="badge">Pit {ops.pitAddress}</span> : null}
          {ops.inspectionStatus ? (
            <span className="badge">Inspection {ops.inspectionStatus}</span>
          ) : null}
          {ops.queueState ? <span className="badge">{ops.queueState}</span> : null}
          {ops.bumperColor ? <span className="badge">Bumper {ops.bumperColor}</span> : null}
          {ops.partsRequestCount ? (
            <span className="badge">Parts {ops.partsRequestCount}</span>
          ) : null}
        </div>
      );
    },
    [nexusSnapshot],
  );
  const chooseEventSearchOption = useCallback((option) => {
    const nextKey = normalizeEventKey(option?.key);
    if (!nextKey) return;
    setDraftEventKey(nextKey);
    setEventSearchOpen(false);
    requestAnimationFrame(() => {
      eventSearchInputRef.current?.focus?.();
    });
  }, []);
  const webhookContextFields = useCallback(
    (extraFields = []) =>
      [
        loadedEventKey ? { name: t('field.event', 'Event'), value: loadedEventKey } : null,
        loadedTeam != null ? { name: t('field.team', 'Team'), value: String(loadedTeam) } : null,
        ...extraFields,
      ].filter(Boolean),
    [loadedEventKey, loadedTeam, t],
  );
  const sendDiscordWebhookEvent = useCallback(
    async (eventKey, title, body, extraFields = [], { force = false } = {}) => {
      const webhookSettings = settings.webhook;
      if (!webhookSettings?.enabled || !String(webhookSettings.discordUrl || '').trim())
        return false;
      if (!force && !webhookSettings.events?.[eventKey]) return false;

      const signature = JSON.stringify({
        eventKey,
        title,
        body,
        extraFields,
      });
      const lastSentAt = webhookSentAtRef.current.get(signature) ?? 0;
      const cooldownMs = Math.max(5, Number(webhookSettings.cooldownSeconds || 30)) * 1000;

      if (!force && lastSentAt && Date.now() - lastSentAt < cooldownMs) {
        return false;
      }

      setWebhookDelivery((prev) => ({
        ...prev,
        pending: true,
      }));

      try {
        await fetchJsonOrThrow(
          '/api/webhook/discord',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              webhookUrl: webhookSettings.discordUrl,
              displayName: webhookSettings.displayName,
              eventKey,
              title,
              body,
              fields: webhookContextFields(extraFields),
            }),
            cache: 'no-store',
          },
          'Discord webhook failed',
        );

        webhookSentAtRef.current.set(signature, Date.now());
        setWebhookDelivery({
          pending: false,
          lastSuccessAtMs: Date.now(),
          lastFailureAtMs: null,
          lastFailureText: '',
        });
        return true;
      } catch (error) {
        setWebhookDelivery((prev) => ({
          ...prev,
          pending: false,
          lastFailureAtMs: Date.now(),
          lastFailureText: error instanceof Error ? error.message : 'Unknown Discord webhook error',
        }));
        return false;
      }
    },
    [settings.webhook, webhookContextFields],
  );
  const handleActionInputKeyDown = useCallback((event, action) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) return;
    event.preventDefault();
    action();
  }, []);
  const ensureAudioContext = useCallback(async () => {
    if (typeof window === 'undefined') return null;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      setAudioStatusText('Audio is not supported in this browser.');
      return null;
    }

    try {
      let context = audioContextRef.current;
      if (!context) {
        context = new AudioContextCtor();
        audioContextRef.current = context;
      }
      if (context.state === 'suspended') {
        await context.resume();
      }
      return context;
    } catch (error) {
      setAudioStatusText(error instanceof Error ? error.message : 'Audio could not start.');
      return null;
    }
  }, []);
  const playAudioPattern = useCallback(
    async (patternKey = 'TEST', { updateStatus = false } = {}) => {
      const context = await ensureAudioContext();
      if (!context) return false;

      const offsets = AUDIO_PATTERN_BY_QUEUE[patternKey] ?? AUDIO_PATTERN_BY_QUEUE.TEST;
      const baseFrequency = patternKey === 'PLAYING_NOW' ? 940 : 760;

      offsets.forEach((offset, index) => {
        const startAt = context.currentTime + 0.02 + offset;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = patternKey === 'PLAYING_NOW' ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(baseFrequency + index * 35, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.09, startAt + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.12);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.14);
      });

      if (updateStatus) {
        setAudioStatusText(patternKey === 'TEST' ? 'Audio test played.' : 'Audio alert is ready.');
      }
      return true;
    },
    [ensureAudioContext],
  );
  const toggleAudio = useCallback(async () => {
    if (audioEnabled) {
      setAudioEnabled(false);
      setAudioStatusText('Audio off.');
      return;
    }
    const ready = await ensureAudioContext();
    if (!ready) return;
    setAudioEnabled(true);
    setAudioStatusText('Audio on.');
  }, [audioEnabled, ensureAudioContext]);
  const setTab = useCallback(
    (nextTab) => {
      if (['NOW', 'SCHEDULE', 'MATCH'].includes(nextTab)) {
        setMajorTab('CURRENT');
        setCurrentSubTab(nextTab);
        return;
      }
      if (
        [
          'STRATEGY',
          'GAME MANUAL',
          'DISTRICT',
          'COMPARE',
          'TEAM_PROFILE',
          'RANKINGS',
          'PLAYOFFS',
          'EVENT',
          'DATA',
        ].includes(nextTab)
      ) {
        if (majorTab === 'HISTORICAL') {
          setMajorTab('HISTORICAL');
          setHistoricalSubTab(nextTab);
        } else {
          setMajorTab('CURRENT');
          setCurrentSubTab(nextTab);
        }
        return;
      }
      if (nextTab === 'PRE_EVENT') {
        setMajorTab('HISTORICAL');
        setHistoricalSubTab('PRE_EVENT');
        return;
      }
      if (
        ['PREDICT', 'ALLIANCE', 'PLAYOFF_LAB', 'IMPACT', 'PICK_LIST', 'LIVE_ALLIANCE'].includes(
          nextTab,
        )
      ) {
        setMajorTab('PREDICT');
        setPredictSubTab(nextTab);
        return;
      }
      if (nextTab === 'SETTINGS') {
        setMajorTab('SETTINGS');
        return;
      }
      if (nextTab === 'DATA') {
        setMajorTab('CURRENT');
        setCurrentSubTab('DATA');
      }
    },
    [majorTab],
  );
  useEffect(() => {
    setWebcastPlayerState((prev) => ({
      videoId: preferredYouTubeVideoId ?? null,
      ready: false,
      playbackState: prev.suppressed ? 'paused' : 'unstarted',
      currentTime: prev.suppressed ? prev.currentTime : 0,
      floatingVisible: false,
      suppressed: prev.suppressed,
      errorText: '',
    }));
  }, [loadedEventKey, preferredYouTubeVideoId]);
  useEffect(() => {
    if (!preferredYouTubeVideoId) return;

    if (isNowTab) {
      setWebcastPlayerState((prev) => {
        if (inlineWebcastInView) {
          return prev.floatingVisible ? { ...prev, floatingVisible: false } : prev;
        }
        if (webcastPlaybackSuppressed || prev.floatingVisible) return prev;
        if (!webcastStateIsContinuing(prev.playbackState)) return prev;
        return {
          ...prev,
          floatingVisible: true,
        };
      });
      return;
    }

    setWebcastPlayerState((prev) => {
      if (webcastPlaybackSuppressed || prev.floatingVisible) return prev;
      if (!webcastStateIsContinuing(prev.playbackState)) return prev;
      return {
        ...prev,
        floatingVisible: true,
      };
    });
  }, [
    inlineWebcastInView,
    isNowTab,
    preferredYouTubeVideoId,
    webcastPlaybackSuppressed,
    webcastPlayerState.playbackState,
  ]);
  useEffect(() => {
    setPersistedWebcastSuppressed(
      Boolean(loadedEventKey) &&
        readSessionStorageValue('tbsb_webcast_closed_event') === loadedEventKey,
    );
  }, [loadedEventKey]);
  useEffect(() => {
    if (!isNowTab || !preferredYouTubeVideoId) {
      setInlineWebcastInView(true);
      return undefined;
    }

    const node = inlineWebcastAnchorRef.current;
    if (
      !node ||
      typeof window === 'undefined' ||
      typeof node.getBoundingClientRect !== 'function'
    ) {
      setInlineWebcastInView(true);
      return undefined;
    }

    let frameId = 0;
    const evaluateVisibility = () => {
      const rect = node.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const topInset = getStickyViewportTopInset() + 8;
      const bottomInset = 24;
      const visibleTop = Math.max(rect.top, topInset);
      const visibleBottom = Math.min(rect.bottom, viewportHeight - bottomInset);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);
      const visibleRatio = rect.height > 0 ? visibleHeight / rect.height : 0;
      const nextVisible = rect.bottom > topInset && visibleRatio >= 0.45;

      setInlineWebcastInView((prev) => (prev === nextVisible ? prev : nextVisible));
    };

    const scheduleEvaluation = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        evaluateVisibility();
      });
    };

    scheduleEvaluation();
    window.addEventListener('scroll', scheduleEvaluation, { passive: true });
    window.addEventListener('resize', scheduleEvaluation);
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      window.removeEventListener('scroll', scheduleEvaluation);
      window.removeEventListener('resize', scheduleEvaluation);
    };
  }, [isNowTab, preferredYouTubeVideoId]);
  const handleInlineWebcastPlayIntent = useCallback(() => {
    removeSessionStorageValue('tbsb_webcast_closed_event');
    setPersistedWebcastSuppressed(false);
    setWebcastPlayerState((prev) => ({
      ...prev,
      playbackState: 'playing',
      floatingVisible: false,
      suppressed: false,
    }));
  }, []);
  const handleWebcastSnapshotChange = useCallback((nextSnapshot) => {
    setWebcastPlayerState((prev) => {
      let playbackState = nextSnapshot?.playbackState ?? prev.playbackState;
      if (prev.suppressed && playbackState === 'playing') {
        playbackState = 'paused';
      }
      const nextState = {
        ...prev,
        videoId: nextSnapshot?.videoId ?? prev.videoId,
        ready: Boolean(nextSnapshot?.ready ?? prev.ready),
        playbackState,
        currentTime: Number.isFinite(Number(nextSnapshot?.currentTime))
          ? Number(nextSnapshot.currentTime)
          : prev.currentTime,
        errorText: nextSnapshot?.errorText ?? '',
      };

      if (webcastStateStopsFloating(playbackState)) {
        nextState.floatingVisible = false;
      }
      if (prev.suppressed) {
        nextState.floatingVisible = false;
      }

      const unchanged =
        nextState.videoId === prev.videoId &&
        nextState.ready === prev.ready &&
        nextState.playbackState === prev.playbackState &&
        nextState.currentTime === prev.currentTime &&
        nextState.floatingVisible === prev.floatingVisible &&
        nextState.suppressed === prev.suppressed &&
        nextState.errorText === prev.errorText;

      return unchanged ? prev : nextState;
    });
  }, []);
  const handleFloatingWebcastClose = useCallback(() => {
    if (loadedEventKey) writeSessionStorageValue('tbsb_webcast_closed_event', loadedEventKey);
    setPersistedWebcastSuppressed(Boolean(loadedEventKey));
    setWebcastPlayerState((prev) => ({
      ...prev,
      playbackState: 'paused',
      floatingVisible: false,
      suppressed: true,
    }));
  }, [loadedEventKey]);
  useEffect(() => {
    const saved = loadSettings();
    const restoredTeam = Math.max(
      1,
      Math.floor(Number(saved.teamNumber || DEFAULT_SETTINGS.teamNumber)),
    );
    const restoredEventKey = normalizeEventKey(saved.eventKey);

    setSettings(saved);
    setDraftTeam(restoredTeam);
    setDraftEventKey(restoredEventKey);

    if (restoredEventKey) {
      setLoadedTeam(restoredTeam);
      setLoadedEventKey(restoredEventKey);
    }

    setLocalSettingsReady(true);
  }, []);
  useEffect(() => {
    if (!localSettingsReady) return;
    saveSettings(settings);
  }, [localSettingsReady, settings]);
  useEffect(() => {
    let cancelled = false;

    if (!activeWorkspaceKey) {
      setSharedWorkspaceReady(false);
      setHydratedWorkspaceKey(null);
      setSavedPredictScenarios([]);
      setSavedAllianceScenarios([]);
      setPickLists([]);
      setSavedPlayoffResults([]);
      setCurrentCompareSyncKey((value) => value + 1);
      setHistoricalCompareSyncKey((value) => value + 1);
      return () => {
        cancelled = true;
      };
    }

    async function hydrateSharedWorkspace() {
      let loadedSuccessfully = false;
      setSharedWorkspaceReady(false);
      setHydratedWorkspaceKey(null);
      setSavedPredictScenarios([]);
      setSavedAllianceScenarios([]);
      setPickLists([]);
      setSavedPlayoffResults([]);
      try {
        const [saved, predictScenarios, allianceScenarios, sharedPickLists, playoffResults] =
          await Promise.all([
            loadWorkspaceSettings(activeWorkspaceKey),
            loadNamedArtifactsShared(PERSISTENCE_TABLES.predictScenarios, activeWorkspaceKey),
            loadNamedArtifactsShared(PERSISTENCE_TABLES.allianceScenarios, activeWorkspaceKey),
            loadNamedArtifactsShared(PERSISTENCE_TABLES.pickLists, activeWorkspaceKey),
            loadNamedArtifactsShared(PERSISTENCE_TABLES.playoffResults, activeWorkspaceKey),
          ]);
        if (cancelled) return;
        setSettings((prev) => mergeWorkspaceSettingsIntoSettings(prev, saved));
        setSavedPredictScenarios(predictScenarios);
        setSavedAllianceScenarios(allianceScenarios);
        setPickLists(sharedPickLists);
        setSavedPlayoffResults(playoffResults);
        setCurrentCompareSyncKey((value) => value + 1);
        setHistoricalCompareSyncKey((value) => value + 1);
        setHydratedWorkspaceKey(activeWorkspaceKey);
        loadedSuccessfully = true;
      } catch (error) {
        if (!cancelled) {
          setErrorText(error?.message ?? 'Failed to load shared workspace state.');
        }
      } finally {
        if (!cancelled) setSharedWorkspaceReady(loadedSuccessfully);
      }
    }

    hydrateSharedWorkspace();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceKey]);
  useEffect(() => {
    if (!sharedWorkspaceReady || !activeWorkspaceKey || hydratedWorkspaceKey !== activeWorkspaceKey)
      return;
    if (skipSharedSettingsSaveRef.current) {
      skipSharedSettingsSaveRef.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      void saveWorkspaceSettings(activeWorkspaceKey, settings).catch((error) => {
        setErrorText(error?.message ?? 'Failed to save shared settings.');
      });
    }, 250);
    return () => window.clearTimeout(id);
  }, [activeWorkspaceKey, hydratedWorkspaceKey, settings, sharedWorkspaceReady]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = settings.themeId ?? 'graphite-dark';
    document.documentElement.lang = settings.language ?? 'en';
  }, [settings.language, settings.themeId]);
  useEffect(() => {
    if (!sharedWorkspaceReady || !activeWorkspaceKey || hydratedWorkspaceKey !== activeWorkspaceKey)
      return;
    if (skipPredictSaveRef.current) {
      skipPredictSaveRef.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      void saveNamedArtifactsShared(
        PERSISTENCE_TABLES.predictScenarios,
        activeWorkspaceKey,
        savedPredictScenarios,
      ).catch((error) => {
        setErrorText(error?.message ?? 'Failed to save shared predict scenarios.');
      });
    }, 250);
    return () => window.clearTimeout(id);
  }, [activeWorkspaceKey, hydratedWorkspaceKey, savedPredictScenarios, sharedWorkspaceReady]);
  useEffect(() => {
    if (!sharedWorkspaceReady || !activeWorkspaceKey || hydratedWorkspaceKey !== activeWorkspaceKey)
      return;
    if (skipAllianceSaveRef.current) {
      skipAllianceSaveRef.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      void saveNamedArtifactsShared(
        PERSISTENCE_TABLES.allianceScenarios,
        activeWorkspaceKey,
        savedAllianceScenarios,
      ).catch((error) => {
        setErrorText(error?.message ?? 'Failed to save shared alliance scenarios.');
      });
    }, 250);
    return () => window.clearTimeout(id);
  }, [activeWorkspaceKey, hydratedWorkspaceKey, savedAllianceScenarios, sharedWorkspaceReady]);
  useEffect(() => {
    if (!sharedWorkspaceReady || !activeWorkspaceKey || hydratedWorkspaceKey !== activeWorkspaceKey)
      return;
    if (skipPickListSaveRef.current) {
      skipPickListSaveRef.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      void saveNamedArtifactsShared(
        PERSISTENCE_TABLES.pickLists,
        activeWorkspaceKey,
        pickLists,
      ).catch((error) => {
        setErrorText(error?.message ?? 'Failed to save shared pick lists.');
      });
    }, 250);
    return () => window.clearTimeout(id);
  }, [activeWorkspaceKey, hydratedWorkspaceKey, pickLists, sharedWorkspaceReady]);
  useEffect(() => {
    if (!sharedWorkspaceReady || !activeWorkspaceKey || hydratedWorkspaceKey !== activeWorkspaceKey)
      return;
    if (skipPlayoffSaveRef.current) {
      skipPlayoffSaveRef.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      void saveNamedArtifactsShared(
        PERSISTENCE_TABLES.playoffResults,
        activeWorkspaceKey,
        savedPlayoffResults,
      ).catch((error) => {
        setErrorText(error?.message ?? 'Failed to save shared playoff results.');
      });
    }, 250);
    return () => window.clearTimeout(id);
  }, [activeWorkspaceKey, hydratedWorkspaceKey, savedPlayoffResults, sharedWorkspaceReady]);
  useEffect(() => {
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(
    () => () => {
      if (typeof audioContextRef.current?.close === 'function') {
        void audioContextRef.current.close().catch(() => undefined);
      }
    },
    [],
  );
  const fetchSnapshot = useCallback(
    async (team, eventKey, source = 'auto') => {
      setIsLoading(true);
      setErrorText('');
      try {
        const json = await fetchJsonOrThrow(
          `/api/snapshot?team=${encodeURIComponent(String(team))}&eventKey=${encodeURIComponent(eventKey)}`,
          { cache: 'no-store' },
          'Snapshot failed',
        );
        const generatedAtMs = Number.isFinite(Number(json?.generatedAtMs))
          ? Number(json.generatedAtMs)
          : Date.now();
        setLastSnapshotMeta({
          team: Number(team),
          eventKey: normalizeEventKey(eventKey),
          generatedAtMs,
        });
        setSnapshot(json);
        if (offlineMode) {
          setOfflineMode(false);
          setOfflineAdvance(0);
        }
        if (snapshotHealthRef.current === false) {
          void sendDiscordWebhookEvent(
            'snapshot_recovered',
            t('webhook.event.snapshot_recovered.title', 'Snapshot load recovered'),
            `${eventKey} ${t('status.live', 'Live')} snapshot recovered successfully.`,
          );
        }
        snapshotHealthRef.current = true;
      } catch (err) {
        const message = err?.message ?? 'Unknown error';
        setErrorText(message);
        const eventKeyName = source === 'manual' ? 'manual_load_failed' : 'snapshot_failed';
        void sendDiscordWebhookEvent(
          eventKeyName,
          t(
            `webhook.event.${eventKeyName}.title`,
            source === 'manual' ? 'Manual load failed' : 'Snapshot load failed',
          ),
          message,
        );
        snapshotHealthRef.current = false;
      } finally {
        setIsLoading(false);
      }
    },
    [offlineMode, sendDiscordWebhookEvent, t],
  );
  function handleLoad() {
    const team = Number(draftTeam);
    const eventKey = normalizeEventKey(draftEventKey);
    if (!Number.isFinite(team) || team <= 0 || !eventKey) {
      const message = 'Enter a valid team number and event key.';
      setErrorText(message);
      void sendDiscordWebhookEvent(
        'warning',
        t('webhook.event.warning.title', 'Important dashboard warning'),
        message,
      );
      return;
    }
    setDraftTeam(team);
    setDraftEventKey(eventKey);
    setLoadedTeam(team);
    setLoadedEventKey(eventKey);
    setSettings((prev) => ({
      ...prev,
      teamNumber: team,
      eventKey,
    }));
    setEventSearchOpen(false);
    setSelectedMatchKey(null);
    setSelectedTeamNumber(null);
    setStrategyTarget(null);
    setCurrentTeamProfileForcedTeamNumber(null);
    setHistoricalTeamProfileForcedTeamNumber(null);
    setPredictOverrides({});
    fetchSnapshot(team, eventKey, 'manual');
  }
  useEffect(() => {
    const query = String(draftEventKey || '').trim();
    const teamNumber = Math.floor(Number(draftTeam));
    const hasTeamScope = Number.isFinite(teamNumber) && teamNumber > 0;
    const shouldSearch = eventSearchOpen && (query.length >= 2 || hasTeamScope);
    if (!shouldSearch) {
      setEventSearchOptions([]);
      setEventSearchLoading(false);
      return undefined;
    }

    const timeoutId = window.setTimeout(async () => {
      eventSearchAbortRef.current?.abort?.();
      const controller = new AbortController();
      eventSearchAbortRef.current = controller;
      setEventSearchLoading(true);

      try {
        const params = new URLSearchParams({
          query,
        });
        if (Number.isFinite(teamNumber) && teamNumber > 0) {
          params.set('team', String(teamNumber));
        }
        const result = await fetchJsonOrThrow(
          `/api/event-search?${params.toString()}`,
          {
            cache: 'no-store',
            signal: controller.signal,
          },
          'Event search failed',
        );
        if (controller.signal.aborted) return;
        setEventSearchOptions(Array.isArray(result?.events) ? result.events : []);
      } catch (_error) {
        if (!controller.signal.aborted) {
          setEventSearchOptions([]);
        }
      } finally {
        if (eventSearchAbortRef.current === controller) {
          setEventSearchLoading(false);
        }
      }
    }, 160);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [draftEventKey, draftTeam, eventSearchOpen]);
  useEffect(() => {
    if (!loadedTeam || !loadedEventKey || offlineMode) return;
    fetchSnapshot(loadedTeam, loadedEventKey, 'auto');
    const id = window.setInterval(
      () => fetchSnapshot(loadedTeam, loadedEventKey, 'auto'),
      clamp(settings.pollMs, 2000, 60000),
    );
    return () => window.clearInterval(id);
  }, [fetchSnapshot, loadedTeam, loadedEventKey, offlineMode, settings.pollMs]);
  useEffect(() => {
    if (!activeWorkspaceKey || !loadedEventKey || !isSupabaseConfigured()) return;

    let cancelled = false;
    const client = createSupabaseBrowserClient();

    const matchesWorkspace = (payload) => {
      const workspaceKey =
        payload?.new?.workspace_key ??
        payload?.old?.workspace_key ??
        payload?.record?.workspace_key ??
        null;
      return !workspaceKey || String(workspaceKey) === String(activeWorkspaceKey);
    };

    const reloadWorkspaceSettings = async () => {
      try {
        const saved = await loadWorkspaceSettings(activeWorkspaceKey);
        if (cancelled) return;
        skipSharedSettingsSaveRef.current = true;
        setSettings((prev) => mergeWorkspaceSettingsIntoSettings(prev, saved));
      } catch {}
    };

    const reloadArtifacts = async (table, setter, skipRef) => {
      try {
        const rows = await loadNamedArtifactsShared(table, activeWorkspaceKey);
        if (cancelled) return;
        skipRef.current = true;
        setter(rows);
      } catch {}
    };

    const refreshLiveSnapshot = (payload) => {
      const nextEventKey =
        payload?.new?.event_key ?? payload?.record?.event_key ?? payload?.old?.event_key ?? null;
      if (nextEventKey && String(nextEventKey) !== String(loadedEventKey)) return;
      if (loadedTeam != null) {
        void fetchSnapshot(loadedTeam, loadedEventKey, 'auto');
      }
    };

    const channel = client
      .channel(`workspace-live:${activeWorkspaceKey}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: PERSISTENCE_TABLES.workspaceSettings },
        (payload) => {
          if (matchesWorkspace(payload)) void reloadWorkspaceSettings();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: PERSISTENCE_TABLES.predictScenarios },
        (payload) => {
          if (matchesWorkspace(payload)) {
            void reloadArtifacts(
              PERSISTENCE_TABLES.predictScenarios,
              setSavedPredictScenarios,
              skipPredictSaveRef,
            );
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: PERSISTENCE_TABLES.allianceScenarios },
        (payload) => {
          if (matchesWorkspace(payload)) {
            void reloadArtifacts(
              PERSISTENCE_TABLES.allianceScenarios,
              setSavedAllianceScenarios,
              skipAllianceSaveRef,
            );
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: PERSISTENCE_TABLES.pickLists },
        (payload) => {
          if (matchesWorkspace(payload)) {
            void reloadArtifacts(PERSISTENCE_TABLES.pickLists, setPickLists, skipPickListSaveRef);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: PERSISTENCE_TABLES.playoffResults },
        (payload) => {
          if (matchesWorkspace(payload)) {
            void reloadArtifacts(
              PERSISTENCE_TABLES.playoffResults,
              setSavedPlayoffResults,
              skipPlayoffSaveRef,
            );
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: PERSISTENCE_TABLES.compareDrafts },
        (payload) => {
          if (!matchesWorkspace(payload)) return;
          setCurrentCompareSyncKey((value) => value + 1);
          setHistoricalCompareSyncKey((value) => value + 1);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: PERSISTENCE_TABLES.compareSets },
        (payload) => {
          if (!matchesWorkspace(payload)) return;
          setCurrentCompareSyncKey((value) => value + 1);
          setHistoricalCompareSyncKey((value) => value + 1);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: PERSISTENCE_TABLES.eventLiveSignals },
        (payload) => {
          if (!matchesWorkspace(payload)) return;
          refreshLiveSnapshot(payload);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [activeWorkspaceKey, fetchSnapshot, loadedEventKey, loadedTeam]);
  const sortedMatches = useMemo(() => sortMatches(snapshot?.tba?.matches ?? []), [snapshot]);
  const sbMatchMap = useMemo(() => {
    const map = new Map();
    for (const item of snapshot?.sb?.matches ?? []) {
      const key = extractSbMatchKey(item);
      if (key) map.set(key, item);
    }
    return map;
  }, [snapshot]);
  const sbTeamEventMap = useMemo(() => {
    const map = new Map();
    for (const item of snapshot?.sb?.teamEvents ?? []) {
      const teamNumber = extractSbTeamNumber(item);
      if (teamNumber != null && !map.has(teamNumber)) map.set(teamNumber, item);
    }
    return map;
  }, [snapshot]);
  const rankingsDerived = useMemo(() => {
    const rankings = Array.isArray(snapshot?.tba?.rankings?.rankings)
      ? snapshot.tba.rankings.rankings
      : [];
    const sortInfo = Array.isArray(snapshot?.tba?.rankings?.sort_order_info)
      ? snapshot.tba.rankings.sort_order_info
      : [];
    let rpIndex = 0;
    for (let i = 0; i < sortInfo.length; i += 1) {
      const name = String(sortInfo[i]?.name ?? '').toLowerCase();
      if (name.includes('ranking point') || name === 'rp' || name.includes('ranking score')) {
        rpIndex = i;
        break;
      }
    }
    const rows = rankings.map((row) => {
      const sortOrders = Array.isArray(row.sort_orders) ? row.sort_orders : [];
      const rpAverage = safeNumber(sortOrders[rpIndex], NaN);
      const matchesPlayed = safeNumber(row.matches_played, 0);
      const totalRp =
        Number.isFinite(rpAverage) && matchesPlayed > 0 ? rpAverage * matchesPlayed : null;
      return {
        ...row,
        _rpAverage: Number.isFinite(rpAverage) ? rpAverage : null,
        _totalRp: totalRp,
      };
    });
    const ourKey = loadedTeam != null ? tbaTeamKey(loadedTeam) : '';
    const ourRow = rows.find((r) => r.team_key === ourKey) ?? null;
    return { rows, rpIndex, ourRow, ourTotalRp: ourRow?._totalRp ?? null };
  }, [snapshot, loadedTeam]);
  const pointers = useMemo(() => {
    const realIdx = realPointerIndex(sortedMatches);
    const virtualIdx = sortedMatches.length
      ? Math.min(sortedMatches.length - 1, Math.max(-1, realIdx + offlineAdvance))
      : -1;
    let ourNextIdx = null;
    if (loadedTeam != null) {
      const ourKey = tbaTeamKey(loadedTeam);
      for (let i = Math.max(0, virtualIdx + 1); i < sortedMatches.length; i += 1) {
        if (matchHasTeam(sortedMatches[i], ourKey)) {
          ourNextIdx = i;
          break;
        }
      }
    }
    return {
      realIdx,
      virtualIdx,
      ourNextIdx,
      ourNextMatch: ourNextIdx != null ? sortedMatches[ourNextIdx] : null,
      deltaMatches: ourNextIdx != null && virtualIdx >= -1 ? ourNextIdx - virtualIdx - 1 : null,
    };
  }, [sortedMatches, offlineAdvance, loadedTeam]);
  const livePointers = useMemo(() => {
    if (offlineMode) {
      const ourNextIdx = pointers.ourNextIdx;
      return {
        eventIdx: pointers.virtualIdx + 1,
        ourNextIdx,
        ourNextMatch: ourNextIdx != null ? sortedMatches[ourNextIdx] : null,
        matchesAway:
          ourNextIdx != null ? Math.max(0, ourNextIdx - (pointers.virtualIdx + 1)) : null,
      };
    }
    let eventIdx = 0;
    while (eventIdx < sortedMatches.length) {
      const match = sortedMatches[eventIdx];
      if (matchIsCompleted(match)) {
        eventIdx += 1;
        continue;
      }
      const t = getLiveCountdownUnix(match);
      if (t != null && t * 1000 < nowMs) {
        eventIdx += 1;
        continue;
      }
      break;
    }
    let ourNextIdx = null;
    if (loadedTeam != null) {
      const ourKey = tbaTeamKey(loadedTeam);
      for (let i = Math.max(0, eventIdx); i < sortedMatches.length; i += 1) {
        const match = sortedMatches[i];
        if (matchIsCompleted(match)) continue;
        if (!matchHasTeam(match, ourKey)) continue;
        const t = getLiveCountdownUnix(match);
        if (t != null && t * 1000 < nowMs) continue;
        ourNextIdx = i;
        break;
      }
    }
    return {
      eventIdx,
      ourNextIdx,
      ourNextMatch: ourNextIdx != null ? sortedMatches[ourNextIdx] : null,
      matchesAway: ourNextIdx != null ? Math.max(0, ourNextIdx - eventIdx) : null,
    };
  }, [offlineMode, pointers, sortedMatches, loadedTeam, nowMs]);
  const liveCountdownMs = useMemo(() => {
    const match = livePointers.ourNextMatch;
    if (!match) return null;
    const t = getLiveCountdownUnix(match);
    if (!t) return null;
    return Math.max(0, t * 1000 - nowMs);
  }, [livePointers, nowMs]);
  const queueState = useMemo(() => {
    if (offlineMode || !livePointers.ourNextMatch || livePointers.matchesAway == null)
      return 'NONE';
    if (livePointers.matchesAway <= 0 && liveCountdownMs != null && liveCountdownMs <= 0)
      return 'PLAYING_NOW';
    if (livePointers.matchesAway <= 1) return 'QUEUE_1';
    if (livePointers.matchesAway <= 2) return 'QUEUE_2';
    if (livePointers.matchesAway <= 5) return 'QUEUE_5';
    return 'NONE';
  }, [liveCountdownMs, livePointers.matchesAway, livePointers.ourNextMatch, offlineMode]);
  useEffect(() => {
    const previous = previousQueueStateRef.current;
    previousQueueStateRef.current = queueState;
    if (previous == null || previous === queueState || queueState === 'NONE') return;
    if (audioEnabled) {
      void playAudioPattern(queueState);
    }

    const eventKey = queueState === 'PLAYING_NOW' ? 'playing_now' : queueState.toLowerCase();
    const matchLabel = livePointers.ourNextMatch
      ? formatMatchLabel(livePointers.ourNextMatch)
      : '-';
    void sendDiscordWebhookEvent(
      eventKey,
      t(`webhook.event.${eventKey}.title`, queueState),
      `${matchLabel} | ${t('field.team', 'Team')} ${loadedTeam ?? '-'}`,
      matchLabel ? [{ name: 'Match', value: matchLabel }] : [],
    );
  }, [
    audioEnabled,
    livePointers.ourNextMatch,
    loadedTeam,
    playAudioPattern,
    queueState,
    sendDiscordWebhookEvent,
    t,
  ]);
  useEffect(() => {
    const previous = previousOfflineModeRef.current;
    previousOfflineModeRef.current = offlineMode;
    if (previous == null || previous === offlineMode) return;

    void sendDiscordWebhookEvent(
      'mode_changed',
      t('webhook.event.mode_changed.title', 'Mode changed'),
      offlineMode ? t('status.offline', 'Offline') : t('status.live', 'Live'),
    );
  }, [offlineMode, sendDiscordWebhookEvent, t]);
  const ourMatches = useMemo(() => {
    if (loadedTeam == null) return [];
    const ourKey = tbaTeamKey(loadedTeam);
    return sortedMatches.filter((m) => matchHasTeam(m, ourKey));
  }, [sortedMatches, loadedTeam]);
  const ourUpcomingMatches = useMemo(
    () =>
      ourMatches.filter(
        (m) => sortedMatches.findIndex((x) => x.key === m.key) > pointers.virtualIdx,
      ),
    [ourMatches, sortedMatches, pointers.virtualIdx],
  );
  const ourPastMatches = useMemo(
    () =>
      ourMatches.filter(
        (m) => sortedMatches.findIndex((x) => x.key === m.key) <= pointers.virtualIdx,
      ),
    [ourMatches, sortedMatches, pointers.virtualIdx],
  );
  const eventTeamRows = useMemo(() => {
    const tbaTeams = Array.isArray(snapshot?.tba?.teams) ? snapshot.tba.teams : [];
    const rankingMap = new Map();
    for (const row of rankingsDerived.rows) rankingMap.set(row.team_key, row);
    const baseRows = tbaTeams.map((team) => {
      const teamNumber = safeNumber(team.team_number, 0);
      const teamKey = `frc${teamNumber}`;
      const ranking = rankingMap.get(teamKey) ?? null;
      const sbTeamEvent = sbTeamEventMap.get(teamNumber) ?? null;
      const opr = snapshot?.tba?.oprs?.oprs?.[teamKey];
      const dpr = snapshot?.tba?.oprs?.dprs?.[teamKey];
      const ccwm = snapshot?.tba?.oprs?.ccwms?.[teamKey];
      const sortOrder = ranking?._rpAverage ?? null;
      const totalRp = ranking?._totalRp ?? null;
      const recordObj = ranking?.record;
      const record = recordObj
        ? `${recordObj.wins ?? 0}-${recordObj.losses ?? 0}-${recordObj.ties ?? 0}`
        : '—';
      return {
        teamKey,
        teamNumber,
        nickname: team.nickname ?? team.name ?? '',
        rank: ranking?.rank ?? null,
        compositeRank: null,
        matchesPlayed: safeNumber(ranking?.matches_played, 0),
        rpAverage: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : null,
        totalRp: Number.isFinite(Number(totalRp)) ? Number(totalRp) : null,
        overallEpa: getSbOverallEpa(sbTeamEvent),
        autoEpa: getSbAutoEpa(sbTeamEvent),
        teleopEpa: getSbTeleopEpa(sbTeamEvent),
        endgameEpa: getSbEndgameEpa(sbTeamEvent),
        opr: Number.isFinite(Number(opr)) ? Number(opr) : null,
        dpr: Number.isFinite(Number(dpr)) ? Number(dpr) : null,
        ccwm: Number.isFinite(Number(ccwm)) ? Number(ccwm) : null,
        record,
        composite: null,
        compositeRaw: null,
        playedSos: null,
        remainingSos: null,
        totalSos: null,
      };
    });
    const epaValues = baseRows
      .map((r) => r.overallEpa)
      .filter((v) => v != null && Number.isFinite(Number(v)))
      .map(Number);
    const oprValues = baseRows
      .map((r) => r.opr)
      .filter((v) => v != null && Number.isFinite(Number(v)))
      .map(Number);
    const epaMean = mean(epaValues);
    const epaStd = stddev(epaValues);
    const oprMean = mean(oprValues);
    const oprStd = stddev(oprValues);
    const withRaw = baseRows.map((row) => {
      const epa = row.overallEpa ?? epaMean;
      const opr = row.opr ?? oprMean;
      const zEpa = (epa - epaMean) / epaStd;
      const zOpr = clamp((opr - oprMean) / oprStd, -1.75, 1.75);
      const wOpr = clamp(0.1 + 0.03 * Math.max(0, row.matchesPlayed ?? 0), 0.1, 0.45);
      const wEpa = 1 - wOpr;
      return { ...row, compositeRaw: wEpa * zEpa + wOpr * zOpr };
    });
    const rawVals = withRaw
      .map((r) => r.compositeRaw)
      .filter((v) => Number.isFinite(Number(v)))
      .map(Number);
    const withComposite = withRaw.map((row) => ({
      ...row,
      composite: percentileRank(rawVals, row.compositeRaw) * 100,
    }));
    const sortedByComposite = [...withComposite].sort(
      (a, b) => safeNumber(b.compositeRaw, -999) - safeNumber(a.compositeRaw, -999),
    );
    const compositeRankMap = new Map();
    sortedByComposite.forEach((row, idx) => compositeRankMap.set(row.teamKey, idx + 1));
    const compScoreMap = new Map();
    withComposite.forEach((row) => compScoreMap.set(row.teamKey, row.composite));
    function getDifficulty(match, teamKey) {
      const isRed = match.alliances.red.team_keys.includes(teamKey);
      const isBlue = match.alliances.blue.team_keys.includes(teamKey);
      if (!isRed && !isBlue) return null;
      const oppKeys = isRed ? match.alliances.blue.team_keys : match.alliances.red.team_keys;
      const partnerKeys = (
        isRed ? match.alliances.red.team_keys : match.alliances.blue.team_keys
      ).filter((k) => k !== teamKey);
      const oppAvg = averageNullable(oppKeys.map((k) => compScoreMap.get(k) ?? null));
      const partnerAvg = averageNullable(partnerKeys.map((k) => compScoreMap.get(k) ?? null));
      if (oppAvg == null) return null;
      return oppAvg - (partnerAvg ?? 0);
    }
    return withComposite.map((row) => {
      const quals = sortedMatches.filter(
        (m) => m.comp_level === 'qm' && matchHasTeam(m, row.teamKey),
      );
      const played = quals.filter((m) => matchIsCompleted(m));
      const rem = quals.filter((m) => !matchIsCompleted(m));
      return {
        ...row,
        compositeRank: compositeRankMap.get(row.teamKey) ?? null,
        playedSos: averageNullable(played.map((m) => getDifficulty(m, row.teamKey))),
        remainingSos: averageNullable(rem.map((m) => getDifficulty(m, row.teamKey))),
        totalSos: averageNullable(quals.map((m) => getDifficulty(m, row.teamKey))),
      };
    });
  }, [snapshot, rankingsDerived, sbTeamEventMap, sortedMatches]);
  const afterQualNumber = useMemo(() => {
    const n = Number(eventAfterQualInput);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }, [eventAfterQualInput]);
  const eventViewRows = useMemo(() => {
    if (afterQualNumber <= 0) return eventTeamRows;
    const subsetQuals = sortedMatches.filter(
      (m) => m.comp_level === 'qm' && (parseQualMatchNumber(m) ?? 0) >= afterQualNumber,
    );
    const playedSubset = subsetQuals.filter((m) => matchIsCompleted(m));
    if (!playedSubset.length)
      return eventTeamRows.map((r) => ({
        ...r,
        rank: null,
        matchesPlayed: 0,
        rpAverage: null,
        totalRp: null,
        opr: null,
        dpr: null,
        ccwm: null,
        record: '0-0-0',
        playedSos: null,
        remainingSos: null,
        totalSos: null,
      }));
    const teamKeys = eventTeamRows.map((r) => r.teamKey);
    const { opr, dpr, ccwm, idx } = buildLinearStats(playedSubset, teamKeys);
    const compMap = new Map();
    eventTeamRows.forEach((r) => compMap.set(r.teamKey, r.composite ?? 0));
    function difficulty(match, teamKey) {
      const isRed = match.alliances.red.team_keys.includes(teamKey);
      const isBlue = match.alliances.blue.team_keys.includes(teamKey);
      if (!isRed && !isBlue) return null;
      const oppKeys = isRed ? match.alliances.blue.team_keys : match.alliances.red.team_keys;
      const partnerKeys = (
        isRed ? match.alliances.red.team_keys : match.alliances.blue.team_keys
      ).filter((k) => k !== teamKey);
      const oppAvg = averageNullable(oppKeys.map((k) => compMap.get(k) ?? null));
      const partnerAvg = averageNullable(partnerKeys.map((k) => compMap.get(k) ?? null));
      return oppAvg == null ? null : oppAvg - (partnerAvg ?? 0);
    }
    const rows = eventTeamRows.map((row) => {
      const teamPlayed = playedSubset.filter((m) => matchHasTeam(m, row.teamKey));
      let wins = 0,
        losses = 0,
        ties = 0,
        totalRp = 0;
      for (const m of teamPlayed) {
        const isRed = m.alliances.red.team_keys.includes(row.teamKey);
        const myScore = isRed ? Number(m.alliances.red.score) : Number(m.alliances.blue.score);
        const oppScore = isRed ? Number(m.alliances.blue.score) : Number(m.alliances.red.score);
        if (myScore > oppScore) wins += 1;
        else if (myScore < oppScore) losses += 1;
        else ties += 1;
        const rp = extractKnownRpFromMatch(m, isRed ? 'red' : 'blue');
        totalRp += Number(rp ?? 0);
      }
      const playedCount = teamPlayed.length;
      return {
        ...row,
        matchesPlayed: playedCount,
        rpAverage: playedCount ? totalRp / playedCount : null,
        totalRp: playedCount ? totalRp : null,
        opr: idx.get(row.teamKey) != null ? opr[idx.get(row.teamKey)] : null,
        dpr: idx.get(row.teamKey) != null ? dpr[idx.get(row.teamKey)] : null,
        ccwm: idx.get(row.teamKey) != null ? ccwm[idx.get(row.teamKey)] : null,
        record: `${wins}-${losses}-${ties}`,
        playedSos: averageNullable(teamPlayed.map((m) => difficulty(m, row.teamKey))),
        remainingSos: averageNullable(
          subsetQuals
            .filter((m) => !matchIsCompleted(m) && matchHasTeam(m, row.teamKey))
            .map((m) => difficulty(m, row.teamKey)),
        ),
        totalSos: averageNullable(
          subsetQuals
            .filter((m) => matchHasTeam(m, row.teamKey))
            .map((m) => difficulty(m, row.teamKey)),
        ),
      };
    });
    const epaValues2 = rows
      .map((r) => r.overallEpa)
      .filter((v) => v != null && Number.isFinite(Number(v)))
      .map(Number);
    const oprValues2 = rows
      .map((r) => r.opr)
      .filter((v) => v != null && Number.isFinite(Number(v)))
      .map(Number);
    const epaMean2 = mean(epaValues2);
    const epaStd2 = stddev(epaValues2);
    const oprMean2 = mean(oprValues2);
    const oprStd2 = stddev(oprValues2);
    const withRaw2 = rows.map((row) => {
      const epa = row.overallEpa ?? epaMean2;
      const oprv = row.opr ?? oprMean2;
      const zEpa = (epa - epaMean2) / epaStd2;
      const zOpr = clamp((oprv - oprMean2) / oprStd2, -1.75, 1.75);
      const wOpr = clamp(0.1 + 0.03 * Math.max(0, row.matchesPlayed ?? 0), 0.1, 0.45);
      const wEpa = 1 - wOpr;
      return { ...row, compositeRaw: wEpa * zEpa + wOpr * zOpr };
    });
    const rawVals2 = withRaw2
      .map((r) => r.compositeRaw)
      .filter((v) => Number.isFinite(Number(v)))
      .map(Number);
    const withComp2 = withRaw2.map((row) => ({
      ...row,
      composite: percentileRank(rawVals2, row.compositeRaw) * 100,
    }));
    const sortedByComposite2 = [...withComp2].sort(
      (a, b) => safeNumber(b.compositeRaw, -999) - safeNumber(a.compositeRaw, -999),
    );
    const compRankMap2 = new Map();
    sortedByComposite2.forEach((row, idx2) => compRankMap2.set(row.teamKey, idx2 + 1));
    const rankMap2 = rankRowsByRp(withComp2);
    return withComp2.map((row) => ({
      ...row,
      compositeRank: compRankMap2.get(row.teamKey) ?? null,
      rank: rankMap2.get(row.teamKey) ?? null,
    }));
  }, [afterQualNumber, eventTeamRows, sortedMatches]);
  const eventRowMap = useMemo(() => {
    const map = new Map();
    for (const row of eventTeamRows) map.set(row.teamKey, row);
    return map;
  }, [eventTeamRows]);
  const rivalBand = useMemo(() => {
    const ourTotal = rankingsDerived.ourTotalRp;
    if (ourTotal == null) return [];
    const ourKey = loadedTeam != null ? tbaTeamKey(loadedTeam) : '';
    return rankingsDerived.rows
      .filter((row) => typeof row._totalRp === 'number')
      .filter((row) => Math.abs(row._totalRp - ourTotal) <= 6)
      .map((row) => ({ ...row, _isUs: row.team_key === ourKey }))
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  }, [rankingsDerived, loadedTeam]);
  const rivalTeamsOnly = useMemo(() => rivalBand.filter((r) => !r._isUs), [rivalBand]);
  const keyMatches = useMemo(() => {
    const rivalKeys = new Set(rivalTeamsOnly.map((r) => r.team_key));
    if (!rivalKeys.size) return [];
    return sortedMatches.filter((match, idx) => {
      if (idx <= pointers.virtualIdx) return false;
      const teams = [...match.alliances.red.team_keys, ...match.alliances.blue.team_keys];
      return teams.some((k) => rivalKeys.has(k));
    });
  }, [rivalTeamsOnly, sortedMatches, pointers.virtualIdx]);
  const filteredEventRows = useMemo(() => {
    const q = teamSearch.trim().toLowerCase();
    const rows = eventViewRows.filter(
      (row) =>
        !q ||
        String(row.teamNumber).includes(q) ||
        row.teamKey.toLowerCase().includes(q) ||
        row.nickname.toLowerCase().includes(q),
    );
    rows.sort((a, b) => {
      if (eventSortMode === 'rank') return (a.rank ?? 9999) - (b.rank ?? 9999);
      if (eventSortMode === 'epa')
        return safeNumber(b.overallEpa, -999) - safeNumber(a.overallEpa, -999);
      if (eventSortMode === 'opr') return safeNumber(b.opr, -999) - safeNumber(a.opr, -999);
      return safeNumber(b.compositeRaw, -999) - safeNumber(a.compositeRaw, -999);
    });
    return rows;
  }, [eventViewRows, teamSearch, eventSortMode]);
  const selectedMatch = useMemo(() => {
    const target = selectedMatchKey ?? livePointers.ourNextMatch?.key ?? null;
    if (!target) return null;
    return sortedMatches.find((m) => m.key === target) ?? null;
  }, [selectedMatchKey, livePointers.ourNextMatch?.key, sortedMatches]);
  const nextMatchTeamNumbers = useMemo(() => {
    const match = livePointers.ourNextMatch;
    if (!match) return [];
    return [...match.alliances.red.team_keys, ...match.alliances.blue.team_keys]
      .map((key) => teamNumberFromKey(key))
      .filter((value) => value != null);
  }, [livePointers.ourNextMatch]);
  const selectedMatchTeamNumbers = useMemo(() => {
    if (!selectedMatch) return [];
    return [...selectedMatch.alliances.red.team_keys, ...selectedMatch.alliances.blue.team_keys]
      .map((key) => teamNumberFromKey(key))
      .filter((value) => value != null);
  }, [selectedMatch]);
  const selectedSbMatch = useMemo(
    () => (selectedMatch ? (sbMatchMap.get(selectedMatch.key) ?? null) : null),
    [selectedMatch, sbMatchMap],
  );
  const selectedTeamRow = useMemo(
    () =>
      selectedTeamNumber != null
        ? (eventViewRows.find((r) => r.teamNumber === selectedTeamNumber) ?? null)
        : null,
    [selectedTeamNumber, eventViewRows],
  );
  const strategyDefaultTarget = useMemo(() => {
    const matchKey =
      selectedMatch?.key ?? livePointers.ourNextMatch?.key ?? sortedMatches[0]?.key ?? null;
    if (!loadedEventKey || !matchKey) return null;
    return { eventKey: loadedEventKey, matchKey };
  }, [loadedEventKey, selectedMatch?.key, livePointers.ourNextMatch?.key, sortedMatches]);
  const effectiveStrategyTarget = strategyTarget ?? strategyDefaultTarget;
  const openStrategyTarget = useCallback(
    (nextTarget) => {
      if (majorTab === 'HISTORICAL') {
        setHistoricalStrategyTarget(nextTarget);
        setHistoricalSubTab('STRATEGY');
        return;
      }
      setStrategyTarget(nextTarget);
      if (nextTarget.eventKey === loadedEventKey) setSelectedMatchKey(nextTarget.matchKey);
      setTab('STRATEGY');
    },
    [loadedEventKey, majorTab, setTab],
  );
  const openStrategyForMatch = useCallback(
    (match, eventKey = loadedEventKey) => {
      if (!match?.key || !eventKey) return;
      openStrategyTarget({ eventKey, matchKey: match.key });
    },
    [loadedEventKey, openStrategyTarget],
  );
  const openTeamProfile = useCallback(
    (teamNumber) => {
      if (!teamNumber || !Number.isFinite(Number(teamNumber))) return;
      const normalized = Math.floor(Number(teamNumber));
      if (majorTab === 'HISTORICAL') {
        setHistoricalTeamProfileForcedTeamNumber(normalized);
        setHistoricalSubTab('TEAM_PROFILE');
        return;
      }
      setSelectedTeamNumber(normalized);
      setCurrentTeamProfileForcedTeamNumber(normalized);
      setTab('TEAM_PROFILE');
    },
    [majorTab, setTab],
  );
  const addTeamToCompare = useCallback(
    (teamNumber) => {
      if (!teamNumber || !Number.isFinite(Number(teamNumber))) return;
      const normalized = Math.floor(Number(teamNumber));
      const compareScope = majorTab === 'HISTORICAL' ? 'historical' : 'current';
      if (compareScope === 'historical') {
        setHistoricalSubTab('COMPARE');
        void addTeamToCompareDraftShared(
          normalized,
          loadedTeam ?? null,
          compareScope,
          activeWorkspaceKey,
        )
          .then(() => {
            setHistoricalCompareSyncKey((prev) => prev + 1);
          })
          .catch((error) => {
            setErrorText(error?.message ?? 'Failed to update shared compare draft.');
          });
        return;
      }
      setTab('COMPARE');
      void addTeamToCompareDraftShared(
        normalized,
        loadedTeam ?? null,
        compareScope,
        activeWorkspaceKey,
      )
        .then(() => {
          setCurrentCompareSyncKey((prev) => prev + 1);
        })
        .catch((error) => {
          setErrorText(error?.message ?? 'Failed to update shared compare draft.');
        });
    },
    [activeWorkspaceKey, loadedTeam, majorTab, setTab],
  );
  const compositeRankMap = useMemo(() => {
    const map = new Map();
    for (const row of eventTeamRows) map.set(row.teamKey, row.compositeRank);
    return map;
  }, [eventTeamRows]);
  const likelyCaptains = useMemo(
    () =>
      [...eventTeamRows]
        .sort((a, b) => safeNumber(b.compositeRaw, -999) - safeNumber(a.compositeRaw, -999))
        .slice(0, 8),
    [eventTeamRows],
  );
  const topByEpa = useMemo(
    () =>
      [...eventTeamRows]
        .sort((a, b) => safeNumber(b.overallEpa, -999) - safeNumber(a.overallEpa, -999))
        .slice(0, 12),
    [eventTeamRows],
  );
  const topByOpr = useMemo(
    () =>
      [...eventTeamRows]
        .sort((a, b) => safeNumber(b.opr, -999) - safeNumber(a.opr, -999))
        .slice(0, 12),
    [eventTeamRows],
  );
  const topByComposite = useMemo(
    () =>
      [...eventTeamRows]
        .sort((a, b) => safeNumber(b.compositeRaw, -999) - safeNumber(a.compositeRaw, -999))
        .slice(0, 12),
    [eventTeamRows],
  );
  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
    setCommandPaletteQuery('');
    setCommandPaletteIndex(0);
  }, []);
  const openCommandPalette = useCallback((prefill = '') => {
    setCommandPaletteOpen(true);
    setCommandPaletteQuery(prefill);
    setCommandPaletteIndex(0);
  }, []);
  const executeCommandPaletteAction = useCallback(
    (action) => {
      if (!action?.run) return;
      closeCommandPalette();
      action.run();
    },
    [closeCommandPalette],
  );
  const commandPaletteActions = useMemo(() => {
    const actions = [];
    const pushAction = (key, label, description, tokens, run) => {
      actions.push({
        key,
        label,
        description,
        search: [label, description, ...(tokens ?? [])].filter(Boolean).join(' ').toLowerCase(),
        run,
      });
    };

    pushAction('tab_now', 'Open NOW', 'Jump to the live mission-control view.', ['current'], () =>
      setTab('NOW'),
    );
    pushAction(
      'tab_schedule',
      'Open SCHEDULE',
      'Review the active event schedule.',
      ['matches', 'queue'],
      () => setTab('SCHEDULE'),
    );
    pushAction('tab_match', 'Open MATCH', 'Jump to match detail.', ['selected match'], () =>
      setTab('MATCH'),
    );
    pushAction(
      'tab_strategy',
      'Open STRATEGY',
      'Open the strategy workspace for the currently relevant match.',
      ['boards', 'plan'],
      () => {
        if (strategyDefaultTarget) {
          openStrategyTarget(strategyDefaultTarget);
          return;
        }
        setTab('STRATEGY');
      },
    );
    pushAction(
      'tab_team_profile',
      'Open TEAM_PROFILE',
      'Jump to team history and scouting context.',
      ['team profile', 'history'],
      () => {
        if (loadedTeam != null) {
          openTeamProfile(loadedTeam);
          return;
        }
        setTab('TEAM_PROFILE');
      },
    );
    pushAction('tab_compare', 'Open COMPARE', 'Jump to side-by-side team comparison.', [], () =>
      setTab('COMPARE'),
    );
    pushAction('tab_event', 'Open EVENT', 'Open live ops, media, and validation.', [], () =>
      setTab('EVENT'),
    );
    pushAction('tab_predict', 'Open PREDICT', 'Jump to prediction and scenario tools.', [], () =>
      setTab('PREDICT'),
    );
    pushAction(
      'tab_alliance',
      'Open ALLIANCE',
      'Jump to alliance-selection tools.',
      ['pick list', 'captains'],
      () => setTab('ALLIANCE'),
    );
    pushAction(
      'tab_settings',
      'Open SETTINGS',
      'Review shortcuts, diagnostics, and desk configuration.',
      ['diagnostics'],
      () => setTab('SETTINGS'),
    );

    if (loadedTeam != null) {
      pushAction(
        `loaded_team_profile_${loadedTeam}`,
        `TEAM_PROFILE: ${loadedTeam}`,
        'Open the loaded team in TEAM_PROFILE.',
        ['loaded team'],
        () => openTeamProfile(loadedTeam),
      );
      pushAction(
        `loaded_team_compare_${loadedTeam}`,
        `COMPARE: ${loadedTeam}`,
        'Add the loaded team to COMPARE.',
        ['loaded team', 'compare'],
        () => addTeamToCompare(loadedTeam),
      );
    }

    if (selectedMatch) {
      pushAction(
        `selected_match_${selectedMatch.key}`,
        `Selected Match: ${formatMatchLabel(selectedMatch)}`,
        'Open the selected match detail.',
        [selectedMatch.key, selectedMatch.comp_level],
        () => {
          setSelectedMatchKey(selectedMatch.key);
          setTab('MATCH');
        },
      );
      pushAction(
        `selected_strategy_${selectedMatch.key}`,
        `Strategy: ${formatMatchLabel(selectedMatch)}`,
        'Open STRATEGY for the selected match.',
        [selectedMatch.key, 'strategy'],
        () => openStrategyForMatch(selectedMatch),
      );
    }

    if (livePointers.ourNextMatch) {
      pushAction(
        `next_match_${livePointers.ourNextMatch.key}`,
        `Next Match: ${formatMatchLabel(livePointers.ourNextMatch)}`,
        'Open the next scheduled match detail.',
        ['next match', livePointers.ourNextMatch.key],
        () => {
          setSelectedMatchKey(livePointers.ourNextMatch.key);
          setTab('MATCH');
        },
      );
      pushAction(
        `next_strategy_${livePointers.ourNextMatch.key}`,
        `Next Strategy: ${formatMatchLabel(livePointers.ourNextMatch)}`,
        'Open STRATEGY for the next scheduled match.',
        ['next match', 'strategy'],
        () => openStrategyForMatch(livePointers.ourNextMatch),
      );
    }

    for (const match of sortedMatches.slice(0, 8)) {
      pushAction(
        `match_${match.key}`,
        `Match ${formatMatchLabel(match)}`,
        'Open match detail from the current event.',
        [match.key, match.comp_level, String(match.match_number ?? '')],
        () => {
          setSelectedMatchKey(match.key);
          setTab('MATCH');
        },
      );
      pushAction(
        `match_strategy_${match.key}`,
        `Strategy ${formatMatchLabel(match)}`,
        'Open STRATEGY for this event match.',
        [match.key, 'strategy'],
        () => openStrategyForMatch(match),
      );
    }

    for (const row of eventViewRows.slice(0, 12)) {
      pushAction(
        `team_${row.teamNumber}`,
        `Team ${row.teamNumber} ${row.nickname}`,
        'Open TEAM_PROFILE for this event team.',
        [row.teamKey, row.record, String(row.rank ?? '')],
        () => openTeamProfile(row.teamNumber),
      );
    }

    return actions;
  }, [
    addTeamToCompare,
    eventViewRows,
    livePointers.ourNextMatch,
    loadedTeam,
    openStrategyForMatch,
    openStrategyTarget,
    openTeamProfile,
    selectedMatch,
    setTab,
    sortedMatches,
    strategyDefaultTarget,
  ]);
  const filteredCommandPaletteActions = useMemo(() => {
    const query = commandPaletteQuery.trim().toLowerCase();
    return commandPaletteActions
      .filter((action) => !query || action.search.includes(query))
      .slice(0, 18);
  }, [commandPaletteActions, commandPaletteQuery]);
  const activeCommandPaletteAction =
    filteredCommandPaletteActions[
      clamp(commandPaletteIndex, 0, Math.max(0, filteredCommandPaletteActions.length - 1))
    ] ?? null;
  useEffect(() => {
    if (!commandPaletteOpen) return undefined;
    const id = window.setTimeout(() => {
      commandPaletteInputRef.current?.focus();
      commandPaletteInputRef.current?.select?.();
    }, 0);
    return () => window.clearTimeout(id);
  }, [commandPaletteOpen]);
  useEffect(() => {
    setCommandPaletteIndex((prev) =>
      clamp(prev, 0, Math.max(0, filteredCommandPaletteActions.length - 1)),
    );
  }, [filteredCommandPaletteActions.length]);
  useEffect(() => {
    function handleGlobalShortcut(event) {
      const key = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'k') {
        event.preventDefault();
        if (commandPaletteOpen) {
          closeCommandPalette();
        } else {
          openCommandPalette();
        }
        return;
      }

      if (commandPaletteOpen) {
        if (key === 'escape') {
          event.preventDefault();
          closeCommandPalette();
          return;
        }
        if (key === 'arrowdown') {
          event.preventDefault();
          setCommandPaletteIndex((prev) =>
            clamp(prev + 1, 0, Math.max(0, filteredCommandPaletteActions.length - 1)),
          );
          return;
        }
        if (key === 'arrowup') {
          event.preventDefault();
          setCommandPaletteIndex((prev) =>
            clamp(prev - 1, 0, Math.max(0, filteredCommandPaletteActions.length - 1)),
          );
          return;
        }
        if (key === 'enter' && activeCommandPaletteAction) {
          event.preventDefault();
          executeCommandPaletteAction(activeCommandPaletteAction);
          return;
        }
      }

      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTypingTarget(event.target)) return;

      if (key === '1') {
        event.preventDefault();
        setMajorTab('CURRENT');
        return;
      }
      if (key === '2') {
        event.preventDefault();
        setMajorTab('HISTORICAL');
        return;
      }
      if (key === '3') {
        event.preventDefault();
        setMajorTab('PREDICT');
        return;
      }
      if (key === '4') {
        event.preventDefault();
        setMajorTab('SETTINGS');
        return;
      }
      if (key === 'n') {
        event.preventDefault();
        setMajorTab('CURRENT');
        setCurrentSubTab('NOW');
        return;
      }
      if (key === 's') {
        event.preventDefault();
        setMajorTab('CURRENT');
        setCurrentSubTab('SCHEDULE');
        return;
      }
      if (key === 'm') {
        event.preventDefault();
        setMajorTab('CURRENT');
        setCurrentSubTab('MATCH');
        return;
      }
      if (key === 't') {
        event.preventDefault();
        if (majorTab === 'HISTORICAL') {
          setMajorTab('HISTORICAL');
          setHistoricalSubTab('STRATEGY');
        } else {
          setMajorTab('CURRENT');
          setCurrentSubTab('STRATEGY');
        }
        return;
      }
      if (key === 'r') {
        event.preventDefault();
        if (majorTab === 'HISTORICAL') {
          setMajorTab('HISTORICAL');
          setHistoricalSubTab('RANKINGS');
        } else {
          setMajorTab('CURRENT');
          setCurrentSubTab('RANKINGS');
        }
        return;
      }
      if (key === 'e') {
        event.preventDefault();
        if (majorTab === 'HISTORICAL') {
          setMajorTab('HISTORICAL');
          setHistoricalSubTab('EVENT');
        } else {
          setMajorTab('CURRENT');
          setCurrentSubTab('EVENT');
        }
        return;
      }
      if (key === 'd') {
        event.preventDefault();
        if (majorTab === 'HISTORICAL') {
          setMajorTab('HISTORICAL');
          setHistoricalSubTab('DATA');
        } else {
          setMajorTab('CURRENT');
          setCurrentSubTab('DATA');
        }
        return;
      }
      if (key === 'p') {
        event.preventDefault();
        setMajorTab('PREDICT');
        setPredictSubTab('PREDICT');
      }
    }

    window.addEventListener('keydown', handleGlobalShortcut);
    return () => window.removeEventListener('keydown', handleGlobalShortcut);
  }, [
    activeCommandPaletteAction,
    closeCommandPalette,
    commandPaletteOpen,
    executeCommandPaletteAction,
    filteredCommandPaletteActions.length,
    majorTab,
    openCommandPalette,
  ]);
  useEffect(() => {
    if (!loadedTeam) return;
    const nextQual = ourUpcomingMatches.find((m) => m.comp_level === 'qm');
    if (nextQual?.key && !impactSelectedMatchKey) setImpactSelectedMatchKey(nextQual.key);
  }, [loadedTeam, ourUpcomingMatches, impactSelectedMatchKey]);
  // Predict baseline/prefill
  const predictBaseMap = useMemo(() => {
    const map = {};
    for (const match of sortedMatches.filter((m) => m.comp_level === 'qm')) {
      map[match.key] = {
        redRp: extractKnownRpFromMatch(match, 'red'),
        blueRp: extractKnownRpFromMatch(match, 'blue'),
      };
    }
    return map;
  }, [sortedMatches]);
  useEffect(() => {
    if (!loadedEventKey) return;
    const matchKeys = Object.keys(predictBaseMap);
    if (!matchKeys.length) return;
    const eventPrefix = `${loadedEventKey}_`;
    if (!matchKeys.every((key) => key.startsWith(eventPrefix))) return;
    setPredictOverrides((prev) => {
      let changed = false;
      const nextOverrides = {};
      Object.entries(predictBaseMap).forEach(([key, value]) => {
        if (Object.prototype.hasOwnProperty.call(prev, key)) {
          nextOverrides[key] = prev[key];
          return;
        }
        nextOverrides[key] = { redRp: value.redRp, blueRp: value.blueRp };
        changed = true;
      });
      if (
        Object.keys(prev).length !== matchKeys.length ||
        Object.keys(prev).some((key) => !Object.prototype.hasOwnProperty.call(predictBaseMap, key))
      ) {
        changed = true;
      }
      return changed ? nextOverrides : prev;
    });
  }, [loadedEventKey, predictBaseMap]);
  const predictMatchRows = useMemo(() => {
    let rows = sortedMatches.filter((m) =>
      predictFilter === 'playoffs' ? m.comp_level !== 'qm' : m.comp_level === 'qm',
    );
    if (predictFilter === 'future') rows = rows.filter((m) => !matchIsCompleted(m));
    if (predictFilter === 'our') {
      const ourKey = loadedTeam != null ? tbaTeamKey(loadedTeam) : '';
      rows = rows.filter((m) => matchHasTeam(m, ourKey));
    }
    return rows;
  }, [sortedMatches, predictFilter, loadedTeam]);
  const currentTotalsMap = useMemo(() => {
    const map = new Map();
    eventTeamRows.forEach((row) => map.set(row.teamKey, Number(row.totalRp ?? 0)));
    return map;
  }, [eventTeamRows]);
  const projectedRows = useMemo(() => {
    const totals = new Map(currentTotalsMap);
    for (const match of sortedMatches.filter((m) => m.comp_level === 'qm')) {
      const override = predictOverrides[match.key] ?? {
        redRp: null,
        blueRp: null,
      };
      const base = predictBaseMap[match.key] ?? { redRp: null, blueRp: null };
      const redDelta = (override.redRp ?? 0) - (base.redRp ?? 0);
      const blueDelta = (override.blueRp ?? 0) - (base.blueRp ?? 0);
      for (const k of match.alliances.red.team_keys) totals.set(k, (totals.get(k) ?? 0) + redDelta);
      for (const k of match.alliances.blue.team_keys)
        totals.set(k, (totals.get(k) ?? 0) + blueDelta);
    }
    const rows = eventTeamRows
      .map((row) => ({
        ...row,
        projectedTotalRp: totals.get(row.teamKey) ?? Number(row.totalRp ?? 0),
      }))
      .sort((a, b) => safeNumber(b.projectedTotalRp, -999) - safeNumber(a.projectedTotalRp, -999));
    rows.forEach((row, idx) => {
      row.projectedRank = idx + 1;
    });
    return rows;
  }, [eventTeamRows, currentTotalsMap, sortedMatches, predictOverrides, predictBaseMap]);
  const ourProjected = useMemo(() => {
    const ourKey = loadedTeam != null ? tbaTeamKey(loadedTeam) : '';
    return projectedRows.find((r) => r.teamKey === ourKey) ?? null;
  }, [projectedRows, loadedTeam]);
  const getMatchPredictionProfile = useCallback(
    (match) => {
      const pred = getSbPred(sbMatchMap.get(match.key));
      const redWinProb = pred?.red_win_prob != null ? Number(pred.red_win_prob) : 0.5;
      const blueWinProb = 1 - redWinProb;
      return {
        redWinProb,
        blueWinProb,
        redRpAvg:
          pred?.red_rp_1 != null || pred?.red_rp_2 != null
            ? Number(pred.red_rp_1 ?? 0) + Number(pred.red_rp_2 ?? 0) + redWinProb * 2
            : 2 * redWinProb,
        blueRpAvg:
          pred?.blue_rp_1 != null || pred?.blue_rp_2 != null
            ? Number(pred?.blue_rp_1 ?? 0) + Number(pred?.blue_rp_2 ?? 0) + blueWinProb * 2
            : 2 * blueWinProb,
      };
    },
    [sbMatchMap],
  );
  const deterministicRows = useMemo(() => {
    const totals = new Map(currentTotalsMap);
    for (const match of sortedMatches.filter((m) => m.comp_level === 'qm')) {
      const override = predictOverrides[match.key];
      if (override && (override.redRp != null || override.blueRp != null)) {
        const base = predictBaseMap[match.key] ?? { redRp: 0, blueRp: 0 };
        const redDelta = Number(override.redRp ?? 0) - Number(base.redRp ?? 0);
        const blueDelta = Number(override.blueRp ?? 0) - Number(base.blueRp ?? 0);
        for (const k of match.alliances.red.team_keys)
          totals.set(k, (totals.get(k) ?? 0) + redDelta);
        for (const k of match.alliances.blue.team_keys)
          totals.set(k, (totals.get(k) ?? 0) + blueDelta);
      } else if (!matchIsCompleted(match)) {
        const p = getMatchPredictionProfile(match);
        for (const k of match.alliances.red.team_keys)
          totals.set(k, (totals.get(k) ?? 0) + p.redRpAvg);
        for (const k of match.alliances.blue.team_keys)
          totals.set(k, (totals.get(k) ?? 0) + p.blueRpAvg);
      }
    }
    const rows = eventTeamRows
      .map((row) => ({
        ...row,
        deterministicTotalRp: totals.get(row.teamKey) ?? Number(row.totalRp ?? 0),
      }))
      .sort(
        (a, b) =>
          safeNumber(b.deterministicTotalRp, -999) - safeNumber(a.deterministicTotalRp, -999),
      );
    rows.forEach((row, idx) => {
      row.deterministicRank = idx + 1;
    });
    return rows;
  }, [
    currentTotalsMap,
    sortedMatches,
    predictOverrides,
    predictBaseMap,
    eventTeamRows,
    getMatchPredictionProfile,
  ]);
  const computeMonteCarloProjection = useCallback(() => {
    const futureQuals = sortedMatches.filter((m) => m.comp_level === 'qm' && !matchIsCompleted(m));
    const totalsBase = new Map(currentTotalsMap);
    for (const match of sortedMatches.filter((m) => m.comp_level === 'qm')) {
      const override = predictOverrides[match.key];
      const base = predictBaseMap[match.key] ?? { redRp: 0, blueRp: 0 };
      if (override && (override.redRp != null || override.blueRp != null)) {
        const redDelta = Number(override.redRp ?? 0) - Number(base.redRp ?? 0);
        const blueDelta = Number(override.blueRp ?? 0) - Number(base.blueRp ?? 0);
        for (const k of match.alliances.red.team_keys)
          totalsBase.set(k, (totalsBase.get(k) ?? 0) + redDelta);
        for (const k of match.alliances.blue.team_keys)
          totalsBase.set(k, (totalsBase.get(k) ?? 0) + blueDelta);
      }
    }
    const rankCounts = new Map();
    const avgTotals = new Map();
    eventTeamRows.forEach((row) => {
      rankCounts.set(row.teamKey, []);
      avgTotals.set(row.teamKey, 0);
    });
    const ourKey = loadedTeam != null ? tbaTeamKey(loadedTeam) : '';
    const ourSeeds = [];
    const topSeedCounts = new Map();
    for (let run = 0; run < Math.max(1, simRuns); run += 1) {
      const totals = new Map(totalsBase);
      for (const match of futureQuals) {
        const override = predictOverrides[match.key];
        if (override && (override.redRp != null || override.blueRp != null)) continue;
        const pred = getSbPred(sbMatchMap.get(match.key));
        const redWin = pred?.red_win_prob != null ? Number(pred.red_win_prob) : 0.5;
        const redWon = Math.random() < redWin;
        const redExtra1 = Math.random() < Number(pred?.red_rp_1 ?? 0);
        const redExtra2 = Math.random() < Number(pred?.red_rp_2 ?? 0);
        const blueExtra1 = Math.random() < Number(pred?.blue_rp_1 ?? 0);
        const blueExtra2 = Math.random() < Number(pred?.blue_rp_2 ?? 0);
        const redRp = (redWon ? 2 : 0) + (redExtra1 ? 1 : 0) + (redExtra2 ? 1 : 0);
        const blueRp = (!redWon ? 2 : 0) + (blueExtra1 ? 1 : 0) + (blueExtra2 ? 1 : 0);
        for (const k of match.alliances.red.team_keys) totals.set(k, (totals.get(k) ?? 0) + redRp);
        for (const k of match.alliances.blue.team_keys)
          totals.set(k, (totals.get(k) ?? 0) + blueRp);
      }
      const ranked = eventTeamRows
        .map((row) => ({
          teamKey: row.teamKey,
          total: totals.get(row.teamKey) ?? 0,
        }))
        .sort((a, b) => b.total - a.total);
      ranked.forEach((r, idx) => {
        rankCounts.get(r.teamKey).push(idx + 1);
        avgTotals.set(r.teamKey, (avgTotals.get(r.teamKey) ?? 0) + r.total);
        if (r.teamKey === ourKey) ourSeeds.push(idx + 1);
      });
      const topSeedKey = ranked
        .slice(0, MONTE_CARLO_SCENARIO_DEPTH)
        .map((r) => r.teamKey)
        .join(',');
      topSeedCounts.set(topSeedKey, (topSeedCounts.get(topSeedKey) ?? 0) + 1);
    }
    const summaryRows = eventTeamRows
      .map((row) => {
        const ranks = rankCounts.get(row.teamKey) ?? [];
        const avgRank = ranks.length ? mean(ranks) : null;
        const sortedRanks = [...ranks].sort((a, b) => a - b);
        const p10 = sortedRanks.length
          ? sortedRanks[Math.floor(0.1 * (sortedRanks.length - 1))]
          : null;
        const p90 = sortedRanks.length
          ? sortedRanks[Math.floor(0.9 * (sortedRanks.length - 1))]
          : null;
        return {
          ...row,
          mcAvgRank: avgRank,
          mcTop1: ranks.filter((x) => x === 1).length / Math.max(1, ranks.length),
          mcTop4: ranks.filter((x) => x <= 4).length / Math.max(1, ranks.length),
          mcTop8: ranks.filter((x) => x <= 8).length / Math.max(1, ranks.length),
          mcLikelyBand: p10 != null && p90 != null ? `${p10}-${p90}` : '—',
          mcAvgTotalRp: (avgTotals.get(row.teamKey) ?? 0) / Math.max(1, simRuns),
        };
      })
      .sort((a, b) => safeNumber(a.mcAvgRank, 999) - safeNumber(b.mcAvgRank, 999));
    const ourSorted = [...ourSeeds].sort((a, b) => a - b);
    return {
      rows: summaryRows,
      ourAvgSeed: ourSeeds.length ? mean(ourSeeds) : null,
      ourMostLikelySeed: ourSeeds.length
        ? [...ourSeeds]
            .sort(
              (a, b) =>
                ourSeeds.filter((x) => x === a).length - ourSeeds.filter((x) => x === b).length,
            )
            .pop()
        : null,
      ourTop1: ourSeeds.filter((x) => x === 1).length / Math.max(1, ourSeeds.length),
      ourTop4: ourSeeds.filter((x) => x <= 4).length / Math.max(1, ourSeeds.length),
      ourTop8: ourSeeds.filter((x) => x <= 8).length / Math.max(1, ourSeeds.length),
      ourLikelyBand: ourSorted.length
        ? `${ourSorted[Math.floor(0.1 * (ourSorted.length - 1))]}-${ourSorted[Math.floor(0.9 * (ourSorted.length - 1))]}`
        : '—',
      ourObservedHighest: ourSorted.length ? ourSorted[0] : null,
      ourObservedLowest: ourSorted.length ? ourSorted[ourSorted.length - 1] : null,
      ourTheoreticalHighest: 1,
      ourTheoreticalLowest: eventTeamRows.length || null,
      uniqueScenarioCount: topSeedCounts.size,
      top16Scenarios: Array.from(topSeedCounts.entries())
        .map(([key, count]) => ({
          id: `mc_${key}`,
          teams: key.split(',').filter(Boolean),
          count,
          probability: count / Math.max(1, simRuns),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 25),
    };
  }, [
    currentTotalsMap,
    eventTeamRows,
    loadedTeam,
    predictBaseMap,
    predictOverrides,
    sbMatchMap,
    simRuns,
    sortedMatches,
  ]);
  const completedQualCount = useMemo(
    () => sortedMatches.filter((m) => m.comp_level === 'qm' && matchIsCompleted(m)).length,
    [sortedMatches],
  );
  const emptyMonteCarloProjection = useMemo(
    () => ({
      rows: eventTeamRows.map((row) => ({
        ...row,
        mcAvgRank: row.rank ?? null,
        mcTop1: 0,
        mcTop4: 0,
        mcTop8: 0,
        mcLikelyBand: '—',
        mcAvgTotalRp: row.totalRp ?? 0,
      })),
      ourAvgSeed: null,
      ourMostLikelySeed: null,
      ourTop1: 0,
      ourTop4: 0,
      ourTop8: 0,
      ourLikelyBand: '—',
      ourObservedHighest: null,
      ourObservedLowest: null,
      ourTheoreticalHighest: 1,
      ourTheoreticalLowest: eventTeamRows.length || null,
      uniqueScenarioCount: 0,
      top16Scenarios: [],
    }),
    [eventTeamRows],
  );
  const monteCarloProjection = mcProjectionSnapshot ?? emptyMonteCarloProjection;
  const monteCarloScenarioSpace = useMemo(() => {
    const teamCount = eventTeamRows.length;
    const depth = Math.min(MONTE_CARLO_SCENARIO_DEPTH, teamCount);
    return {
      depth,
      orderedCount: permutationCount(teamCount, depth),
      unorderedCount: combinationCount(teamCount, depth),
    };
  }, [MONTE_CARLO_SCENARIO_DEPTH, eventTeamRows.length]);
  useEffect(() => {
    if (!mcProjectionSnapshot && eventTeamRows.length) {
      const computed = computeMonteCarloProjection();
      setMcProjectionSnapshot(computed);
      setLastMcCompletedQualCount(completedQualCount);
      setMcProjectionDirty(false);
    }
  }, [
    completedQualCount,
    computeMonteCarloProjection,
    eventTeamRows.length,
    loadedEventKey,
    mcProjectionSnapshot,
  ]);
  useEffect(() => {
    if (!mcProjectionSnapshot) return;
    setMcProjectionDirty(true);
  }, [mcProjectionSnapshot, predictOverrides, simRuns]);
  useEffect(() => {
    if (!mcProjectionSnapshot) return;
    if (completedQualCount !== lastMcCompletedQualCount) setMcProjectionDirty(true);
  }, [completedQualCount, lastMcCompletedQualCount, mcProjectionSnapshot]);
  function recomputeMonteCarloProjection() {
    const computed = computeMonteCarloProjection();
    setMcProjectionSnapshot(computed);
    setLastMcCompletedQualCount(completedQualCount);
    setMcProjectionDirty(false);
  }
  function saveCurrentFullScenario() {
    const name = window.prompt('Scenario name', `Scenario ${savedPredictScenarios.length + 1}`);
    if (!name) return;
    const scenario = {
      id: `predict_${Date.now()}`,
      name,
      eventKey: loadedEventKey,
      createdAt: Date.now(),
      overrides: predictOverrides,
      manualRows: projectedRows.map((r) => ({
        teamKey: r.teamKey,
        teamNumber: r.teamNumber,
        nickname: r.nickname,
        simRank: r.projectedRank,
        simTotalRp: r.projectedTotalRp,
        realRank: r.rank,
        overallEpa: r.overallEpa,
        opr: r.opr,
        composite: r.composite,
        totalSos: r.totalSos,
        record: r.record,
      })),
      deterministicRows: deterministicRows.map((r) => ({
        teamKey: r.teamKey,
        teamNumber: r.teamNumber,
        nickname: r.nickname,
        simRank: r.deterministicRank,
        simTotalRp: r.deterministicTotalRp,
        realRank: r.rank,
        overallEpa: r.overallEpa,
        opr: r.opr,
        composite: r.composite,
        totalSos: r.totalSos,
        record: r.record,
      })),
      monteCarloRows: monteCarloProjection.rows.map((r, idx) => ({
        teamKey: r.teamKey,
        teamNumber: r.teamNumber,
        nickname: r.nickname,
        simRank: idx + 1,
        simTotalRp: r.mcAvgTotalRp,
        realRank: r.rank,
        overallEpa: r.overallEpa,
        opr: r.opr,
        composite: r.composite,
        totalSos: r.totalSos,
        record: r.record,
        mcAvgRank: r.mcAvgRank,
        mcTop1: r.mcTop1,
        mcTop4: r.mcTop4,
        mcTop8: r.mcTop8,
        mcLikelyBand: r.mcLikelyBand,
      })),
      top16Scenarios: monteCarloProjection.top16Scenarios ?? [],
      summary: {
        manualOurRank: ourProjected?.projectedRank ?? null,
        deterministicOurRank:
          deterministicRows.find(
            (r) => r.teamKey === (loadedTeam != null ? tbaTeamKey(loadedTeam) : ''),
          )?.deterministicRank ?? null,
        mcOurAvgSeed: monteCarloProjection.ourAvgSeed ?? null,
      },
    };
    setSavedPredictScenarios((prev) => [scenario, ...prev]);
    setSelectedPredictScenarioId(scenario.id);
  }
  const chosenPredictScenario = useMemo(
    () => savedPredictScenarios.find((s) => s.id === selectedPredictScenarioId) ?? null,
    [savedPredictScenarios, selectedPredictScenarioId],
  );
  // Alliance source rows
  const allianceSourceRows = useMemo(() => {
    if (allianceSourceType === 'live') {
      return [...eventTeamRows]
        .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
        .map((r) => ({
          teamKey: r.teamKey,
          teamNumber: r.teamNumber,
          nickname: r.nickname,
          simRank: r.rank,
          simTotalRp: r.totalRp,
          realRank: r.rank,
          overallEpa: r.overallEpa,
          opr: r.opr,
          composite: r.composite,
          totalSos: r.totalSos,
          record: r.record,
        }));
    }
    if (allianceSourceType === 'predict') {
      const currentInlineScenario =
        allianceSourceId === '__current_mc__'
          ? {
              manualRows: projectedRows,
              deterministicRows,
              monteCarloRows: monteCarloProjection.rows,
              top16Scenarios: monteCarloProjection.top16Scenarios ?? [],
            }
          : null;
      const scenario =
        currentInlineScenario ??
        savedPredictScenarios.find((s) => s.id === allianceSourceId) ??
        chosenPredictScenario;
      if (!scenario) return [];
      if (predictScenarioMode === 'deterministic')
        return scenario.deterministicRows ?? scenario.manualRows ?? [];
      if (predictScenarioMode === 'montecarlo') {
        const mcRows = scenario.monteCarloRows ?? scenario.manualRows ?? [];
        if (mcScenarioSelection !== 'most_likely' && scenario.top16Scenarios?.length) {
          const picked = scenario.top16Scenarios.find((s) => s.id === mcScenarioSelection);
          if (picked) {
            const map = new Map(mcRows.map((r) => [r.teamKey, r]));
            const ordered = picked.teams.map((k, idx) => ({
              ...(map.get(k) ?? eventRowMap.get(k) ?? { teamKey: k }),
              simRank: idx + 1,
            }));
            const remainder = mcRows.filter((r) => !picked.teams.includes(r.teamKey));
            return [...ordered, ...remainder];
          }
        }
        return mcRows;
      }
      return scenario.manualRows ?? scenario.projectedRows ?? [];
    }
    const allianceScenario = savedAllianceScenarios.find((s) => s.id === allianceSourceId);
    return allianceScenario?.sourceRows ?? [];
  }, [
    allianceSourceType,
    allianceSourceId,
    eventTeamRows,
    savedPredictScenarios,
    savedAllianceScenarios,
    chosenPredictScenario,
    predictScenarioMode,
    mcScenarioSelection,
    eventRowMap,
    projectedRows,
    deterministicRows,
    monteCarloProjection,
  ]);
  const top8LiveOrScenario = useMemo(() => allianceSourceRows.slice(0, 8), [allianceSourceRows]);
  function freshAllianceStateFromSource(sourceRows) {
    const captains = sourceRows.slice(0, 8).map((r) => r.teamKey);
    return {
      sourceRows,
      captainSlots: captains.map((teamKey, idx) => ({
        seed: idx + 1,
        captain: teamKey,
        picks: [],
      })),
      round: 1,
      currentIndex: 0,
      direction: 1,
      declined: [],
      chosen: [],
      complete: false,
    };
  }
  const [allianceRuntime, setAllianceRuntime] = useState(null);
  useEffect(() => {
    const sourceRows = allianceSourceRows.length ? allianceSourceRows : top8LiveOrScenario;
    if (allianceLiveLocked) return;
    setAllianceRuntime(freshAllianceStateFromSource(sourceRows));
    setAlliancePickTarget('');
  }, [allianceSourceRows, top8LiveOrScenario, allianceLiveLocked]);
  const allianceCurrentCaptain = useMemo(() => {
    if (!allianceRuntime?.captainSlots?.length) return null;
    return allianceRuntime.captainSlots[allianceRuntime.currentIndex] ?? null;
  }, [allianceRuntime]);
  const availableTeams = useMemo(() => {
    const sourceRows = allianceRuntime?.sourceRows ?? [];
    const declined = new Set(allianceRuntime?.declined ?? []);
    const captainSlots = allianceRuntime?.captainSlots ?? [];
    const currentCaptain = allianceCurrentCaptain?.captain;
    const currentIndex = allianceRuntime?.currentIndex ?? 0;
    const pickedTeams = new Set(captainSlots.flatMap((s) => s.picks ?? []));
    const captainIndexMap = new Map();
    captainSlots.forEach((slot, idx) => captainIndexMap.set(slot.captain, idx));
    const rows = sourceRows.filter((r) => {
      const teamKey = r.teamKey;
      if (!teamKey) return false;
      if (declined.has(teamKey)) return false;
      if (teamKey === currentCaptain) return false;
      if (pickedTeams.has(teamKey)) return false;
      const captainIdx = captainIndexMap.get(teamKey);
      if (captainIdx != null) {
        if ((allianceRuntime?.round ?? 1) !== 1) return false;
        return captainIdx > currentIndex && (captainSlots[captainIdx]?.picks?.length ?? 0) === 0;
      }
      return true;
    });
    const sorter =
      {
        composite: (r) => -Number(r.composite ?? -999),
        epa: (r) => -Number(r.overallEpa ?? -999),
        rank: (r) => Number(r.realRank ?? r.simRank ?? 9999),
        opr: (r) => -Number(r.opr ?? -999),
      }[allianceSortMode] ?? ((r) => -Number(r.composite ?? -999));
    return [...rows].sort((a, b) => sorter(a) - sorter(b));
  }, [allianceRuntime, allianceCurrentCaptain, allianceSortMode]);
  const allianceCandidateInsights = useMemo(
    () =>
      buildAllianceCandidateInsights({
        availableRows: availableTeams,
        captainSlots: allianceRuntime?.captainSlots ?? [],
        currentCaptainKey: allianceCurrentCaptain?.captain ?? null,
        eventRowMap,
      }),
    [allianceCurrentCaptain?.captain, allianceRuntime?.captainSlots, availableTeams, eventRowMap],
  );
  const allianceAvailableRows = useMemo(() => {
    if (allianceSortMode === 'pickValue') {
      return [...allianceCandidateInsights].sort((a, b) => b.pickValueScore - a.pickValueScore);
    }
    if (allianceSortMode === 'denialValue') {
      return [...allianceCandidateInsights].sort((a, b) => b.denialValueScore - a.denialValueScore);
    }
    if (allianceSortMode === 'chemistry') {
      return [...allianceCandidateInsights].sort((a, b) => b.chemistryScore - a.chemistryScore);
    }
    if (allianceSortMode === 'playoffReady') {
      return [...allianceCandidateInsights].sort(
        (a, b) => b.playoffReadyScore - a.playoffReadyScore,
      );
    }
    if (allianceSortMode === 'ceiling') {
      return [...allianceCandidateInsights].sort((a, b) => b.ceilingScore - a.ceilingScore);
    }
    if (allianceSortMode === 'stability') {
      return [...allianceCandidateInsights].sort((a, b) => b.stabilityScore - a.stabilityScore);
    }
    const insightMap = new Map(allianceCandidateInsights.map((row) => [row.teamKey, row]));
    return availableTeams.map((row) => insightMap.get(row.teamKey) ?? row);
  }, [allianceCandidateInsights, allianceSortMode, availableTeams]);
  const allianceRecommendationRows = useMemo(
    () => [
      {
        label: 'Build Us',
        key: 'pickValueScore',
        row: topInsightRows(allianceCandidateInsights, 'pickValueScore')[0] ?? null,
      },
      {
        label: 'Best Fit',
        key: 'chemistryScore',
        row: topInsightRows(allianceCandidateInsights, 'chemistryScore')[0] ?? null,
      },
      {
        label: 'Deny Rival',
        key: 'denialValueScore',
        row: topInsightRows(allianceCandidateInsights, 'denialValueScore')[0] ?? null,
      },
      {
        label: 'Playoff Ready',
        key: 'playoffReadyScore',
        row: topInsightRows(allianceCandidateInsights, 'playoffReadyScore')[0] ?? null,
      },
      {
        label: 'Highest Ceiling',
        key: 'ceilingScore',
        row: topInsightRows(allianceCandidateInsights, 'ceilingScore')[0] ?? null,
      },
    ],
    [allianceCandidateInsights],
  );
  function reseedCaptainSlots(slots) {
    return slots.map((slot, idx) => ({ ...slot, seed: idx + 1 }));
  }
  function advanceAllianceTurn(state) {
    if (state.complete) return state;
    let { currentIndex, round } = state;
    const len = state.captainSlots.length;
    if (round === 1) {
      if (currentIndex >= len - 1) {
        round = 2;
        currentIndex = len - 1;
      } else {
        currentIndex += 1;
      }
      return { ...state, currentIndex, round };
    }
    if (currentIndex <= 0) {
      return { ...state, currentIndex: 0, round: 2, complete: true };
    }
    return { ...state, currentIndex: currentIndex - 1, round: 2 };
  }
  function handleAllianceDecline() {
    if (!alliancePickTarget || !allianceRuntime || allianceRuntime.complete) return;
    setAllianceLiveLocked(true);
    setAllianceRuntime((prev) => ({
      ...prev,
      declined: [...prev.declined, alliancePickTarget],
    }));
    setAlliancePickTarget('');
  }
  function handleAllianceAccept() {
    if (!alliancePickTarget || !allianceRuntime || !allianceCurrentCaptain) return;
    setAllianceLiveLocked(true);
    let next = structuredClone(allianceRuntime);
    const target = alliancePickTarget;
    const targetCaptainIndex = next.captainSlots.findIndex((s) => s.captain === target);
    if (targetCaptainIndex >= 0) {
      next.captainSlots[next.currentIndex].picks.push(target);
      next.captainSlots.splice(targetCaptainIndex, 1);
      const unavailable = new Set(next.captainSlots.flatMap((s) => [s.captain, ...s.picks]));
      (next.declined ?? []).forEach((k) => unavailable.add(k));
      unavailable.add(target);
      const replacement = next.sourceRows.find((r) => !unavailable.has(r.teamKey));
      if (replacement)
        next.captainSlots.push({
          seed: next.captainSlots.length + 1,
          captain: replacement.teamKey,
          picks: [],
        });
      if (targetCaptainIndex < next.currentIndex)
        next.currentIndex = Math.max(0, next.currentIndex - 1);
    } else {
      next.captainSlots[next.currentIndex].picks.push(target);
    }
    next.chosen = [...(next.chosen ?? []), target];
    next.captainSlots = reseedCaptainSlots(next.captainSlots);
    next = advanceAllianceTurn(next);
    setAllianceRuntime(next);
    setAlliancePickTarget('');
  }
  function resetAllianceRuntimeUnlock() {
    const sourceRows = allianceSourceRows.length ? allianceSourceRows : top8LiveOrScenario;
    setAllianceRuntime(freshAllianceStateFromSource(sourceRows));
    setAlliancePickTarget('');
    setAllianceLiveLocked(false);
  }
  function saveAllianceScenario() {
    if (!allianceRuntime) return;
    const name = window.prompt(
      'Alliance scenario name',
      `Alliance ${savedAllianceScenarios.length + 1}`,
    );
    if (!name) return;
    const scenario = {
      id: `alliance_${Date.now()}`,
      name,
      eventKey: loadedEventKey,
      createdAt: Date.now(),
      sourceType: allianceSourceType,
      sourceId: allianceSourceId,
      sourceRows: allianceRuntime.sourceRows,
      allianceState: allianceRuntime,
    };
    setSavedAllianceScenarios((prev) => [scenario, ...prev]);
  }
  // Playoff lab
  const playoffLabAllianceState = useMemo(() => {
    if (playoffLabSourceType === 'alliance') {
      const scenario = savedAllianceScenarios.find((s) => s.id === playoffLabSourceId);
      return scenario?.allianceState ?? null;
    }
    return allianceRuntime;
  }, [playoffLabSourceType, playoffLabSourceId, savedAllianceScenarios, allianceRuntime]);
  const playoffLabAlliances = useMemo(() => {
    const slots = playoffLabAllianceState?.captainSlots ?? [];
    return slots.map((slot) => ({
      seed: slot.seed,
      teams: [slot.captain, ...slot.picks],
    }));
  }, [playoffLabAllianceState]);
  const impactSelectedMatch = useMemo(
    () => sortedMatches.find((m) => m.key === impactSelectedMatchKey) ?? null,
    [sortedMatches, impactSelectedMatchKey],
  );
  const impactScenarios = useMemo(() => {
    if (!impactSelectedMatch) return [];
    const ourKey = loadedTeam != null ? tbaTeamKey(loadedTeam) : '';
    const isRed = impactSelectedMatch.alliances.red.team_keys.includes(ourKey);
    const currentRank = rankingsDerived.ourRow?.rank ?? null;
    const currentTotal = rankingsDerived.ourTotalRp ?? null;
    const scenarios = [];
    for (let rp = 0; rp <= 6; rp += 1) {
      const local = structuredClone(predictOverrides);
      local[impactSelectedMatch.key] = {
        redRp: isRed ? rp : 0,
        blueRp: isRed ? 0 : rp,
      };
      const totals = new Map(currentTotalsMap);
      for (const match of sortedMatches.filter((m) => m.comp_level === 'qm')) {
        const base = predictBaseMap[match.key] ?? { redRp: 0, blueRp: 0 };
        const override = local[match.key] ??
          predictOverrides[match.key] ?? {
            redRp: base.redRp,
            blueRp: base.blueRp,
          };
        const redDelta = Number(override.redRp ?? 0) - Number(base.redRp ?? 0);
        const blueDelta = Number(override.blueRp ?? 0) - Number(base.blueRp ?? 0);
        for (const k of match.alliances.red.team_keys)
          totals.set(k, (totals.get(k) ?? 0) + redDelta);
        for (const k of match.alliances.blue.team_keys)
          totals.set(k, (totals.get(k) ?? 0) + blueDelta);
      }
      const ranked = eventTeamRows
        .map((row) => ({
          teamKey: row.teamKey,
          total: totals.get(row.teamKey) ?? 0,
        }))
        .sort((a, b) => b.total - a.total);
      const ourRank = ranked.findIndex((r) => r.teamKey === ourKey) + 1;
      const aboveKey = ourRank > 1 ? ranked[ourRank - 2]?.teamKey : null;
      const belowKey = ourRank < ranked.length ? ranked[ourRank]?.teamKey : null;
      scenarios.push({
        rp,
        ourRank,
        total: totals.get(ourKey) ?? 0,
        rankDelta: currentRank != null && ourRank ? currentRank - ourRank : null,
        totalDelta: currentTotal != null ? (totals.get(ourKey) ?? 0) - currentTotal : null,
        top1: ourRank === 1,
        top4: ourRank > 0 && ourRank <= 4,
        top8: ourRank > 0 && ourRank <= 8,
        aboveTeam: aboveKey ? (eventRowMap.get(aboveKey) ?? null) : null,
        belowTeam: belowKey ? (eventRowMap.get(belowKey) ?? null) : null,
      });
    }
    return scenarios;
  }, [
    impactSelectedMatch,
    loadedTeam,
    predictOverrides,
    currentTotalsMap,
    predictBaseMap,
    sortedMatches,
    eventTeamRows,
    rankingsDerived,
    eventRowMap,
  ]);
  const activePickList = useMemo(
    () => pickLists.find((p) => p.id === activePickListId) ?? pickLists[0] ?? null,
    [pickLists, activePickListId],
  );
  const activePlayoffResult = useMemo(
    () =>
      savedPlayoffResults.find((p) => p.id === activePlayoffResultId) ??
      savedPlayoffResults[0] ??
      null,
    [savedPlayoffResults, activePlayoffResultId],
  );
  function strengthForTeam(teamKey, model) {
    const row = eventRowMap.get(teamKey);
    return Number(
      model === 'epa'
        ? (row?.overallEpa ?? row?.opr ?? 0)
        : (row?.composite ?? row?.overallEpa ?? 0),
    );
  }
  function strengthForAllianceTeams(teams, model) {
    const vals = teams.map((k) => strengthForTeam(k, model)).filter((v) => Number.isFinite(v));
    return vals.length ? mean(vals) : 0;
  }
  function buildPlayoffLabBracket(alliances, winners) {
    const getAlliance = (seed) => alliances.find((x) => x.seed === seed) ?? { seed, teams: [] };
    const mk = (key, title, red, blue) => ({ key, title, red, blue });
    const pickWinnerAlliance = (match) => {
      const winner = winners[match.key];
      if (winner === 'red') return match.red;
      if (winner === 'blue') return match.blue;
      return null;
    };
    const pickLoserAlliance = (match) => {
      const winner = winners[match.key];
      if (winner === 'red') return match.blue;
      if (winner === 'blue') return match.red;
      return null;
    };
    const U1 = mk('U1', 'Upper 1', getAlliance(1), getAlliance(8));
    const U2 = mk('U2', 'Upper 2', getAlliance(4), getAlliance(5));
    const U3 = mk('U3', 'Upper 3', getAlliance(2), getAlliance(7));
    const U4 = mk('U4', 'Upper 4', getAlliance(3), getAlliance(6));
    const L1 = mk(
      'L1',
      'Lower 1',
      pickLoserAlliance(U1) ?? { seed: 'TBD', teams: [] },
      pickLoserAlliance(U2) ?? { seed: 'TBD', teams: [] },
    );
    const L2 = mk(
      'L2',
      'Lower 2',
      pickLoserAlliance(U3) ?? { seed: 'TBD', teams: [] },
      pickLoserAlliance(U4) ?? { seed: 'TBD', teams: [] },
    );
    const U5 = mk(
      'U5',
      'Upper 5',
      pickWinnerAlliance(U1) ?? { seed: 'TBD', teams: [] },
      pickWinnerAlliance(U2) ?? { seed: 'TBD', teams: [] },
    );
    const U6 = mk(
      'U6',
      'Upper 6',
      pickWinnerAlliance(U3) ?? { seed: 'TBD', teams: [] },
      pickWinnerAlliance(U4) ?? { seed: 'TBD', teams: [] },
    );
    const L3 = mk(
      'L3',
      'Lower 3',
      pickLoserAlliance(U5) ?? { seed: 'TBD', teams: [] },
      winners['L1'] ? pickWinnerAlliance(L1) : { seed: 'TBD', teams: [] },
    );
    const L4 = mk(
      'L4',
      'Lower 4',
      pickLoserAlliance(U6) ?? { seed: 'TBD', teams: [] },
      winners['L2'] ? pickWinnerAlliance(L2) : { seed: 'TBD', teams: [] },
    );
    const U7 = mk(
      'U7',
      'Upper Final',
      winners['U5'] ? pickWinnerAlliance(U5) : { seed: 'TBD', teams: [] },
      winners['U6'] ? pickWinnerAlliance(U6) : { seed: 'TBD', teams: [] },
    );
    const L5 = mk(
      'L5',
      'Lower 5',
      winners['L3'] ? pickWinnerAlliance(L3) : { seed: 'TBD', teams: [] },
      winners['L4'] ? pickWinnerAlliance(L4) : { seed: 'TBD', teams: [] },
    );
    const L6 = mk(
      'L6',
      'Lower Final',
      pickLoserAlliance(U7) ?? { seed: 'TBD', teams: [] },
      winners['L5'] ? pickWinnerAlliance(L5) : { seed: 'TBD', teams: [] },
    );
    const F1 = mk(
      'F1',
      'Final',
      winners['U7'] ? pickWinnerAlliance(U7) : { seed: 'TBD', teams: [] },
      winners['L6'] ? pickWinnerAlliance(L6) : { seed: 'TBD', teams: [] },
    );
    return { U1, U2, U3, U4, L1, L2, U5, U6, L3, L4, U7, L5, L6, F1 };
  }
  function playoffWinProb(match, model) {
    const redStrength = strengthForAllianceTeams(match.red?.teams ?? [], model);
    const blueStrength = strengthForAllianceTeams(match.blue?.teams ?? [], model);
    if (redStrength + blueStrength <= 0) return 0.5;
    const logistic = 1 / (1 + Math.exp(-(redStrength - blueStrength) / 8));
    return Math.min(0.97, Math.max(0.03, logistic));
  }
  function simulatePlayoffScenario(allianceState, runs, model) {
    const alliances = (allianceState?.captainSlots ?? []).map((slot) => ({
      seed: slot.seed,
      teams: [slot.captain, ...slot.picks],
    }));
    const ourKey = loadedTeam != null ? tbaTeamKey(loadedTeam) : '';
    const ourAlliance = alliances.find((a) => a.teams.includes(ourKey));
    let champ = 0,
      finals = 0,
      upperFinal = 0;
    const furthest = {
      'Upper R1': 0,
      'Lower R1': 0,
      'Upper SF': 0,
      'Lower SF': 0,
      'Upper Final': 0,
      'Lower Final': 0,
      Final: 0,
      Champion: 0,
    };
    const keys = [
      'U1',
      'U2',
      'U3',
      'U4',
      'L1',
      'L2',
      'U5',
      'U6',
      'L3',
      'L4',
      'U7',
      'L5',
      'L6',
      'F1',
    ];
    for (let i = 0; i < Math.max(1, runs); i += 1) {
      const winners = {};
      const roundNameFor = (key) =>
        ({
          U1: 'Upper R1',
          U2: 'Upper R1',
          U3: 'Upper R1',
          U4: 'Upper R1',
          L1: 'Lower R1',
          L2: 'Lower R1',
          U5: 'Upper SF',
          U6: 'Upper SF',
          L3: 'Lower SF',
          L4: 'Lower SF',
          U7: 'Upper Final',
          L5: 'Lower Final',
          L6: 'Final',
          F1: 'Champion',
        })[key] || key;
      let lastRound = 'Upper R1';
      for (const key of keys) {
        const match = buildPlayoffLabBracket(alliances, winners)[key];
        if (!match?.red?.teams?.length || !match?.blue?.teams?.length) continue;
        const redProb = playoffWinProb(match, model);
        winners[key] = Math.random() < redProb ? 'red' : 'blue';
        if (
          ourAlliance &&
          (match.red.seed === ourAlliance.seed || match.blue.seed === ourAlliance.seed)
        )
          lastRound = roundNameFor(key);
      }
      if (ourAlliance) {
        const final = buildPlayoffLabBracket(alliances, winners).F1;
        const finalWinner = winners['F1'];
        const inFinal = final.red.seed === ourAlliance.seed || final.blue.seed === ourAlliance.seed;
        if (inFinal) finals += 1;
        if (
          inFinal &&
          ((finalWinner === 'red' && final.red.seed === ourAlliance.seed) ||
            (finalWinner === 'blue' && final.blue.seed === ourAlliance.seed))
        )
          champ += 1;
        const upper = buildPlayoffLabBracket(alliances, winners).U7;
        if (upper.red.seed === ourAlliance.seed || upper.blue.seed === ourAlliance.seed)
          upperFinal += 1;
      }
      furthest[lastRound] = (furthest[lastRound] ?? 0) + 1;
    }
    const bestRound = Object.entries(furthest).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
    return {
      champ: champ / Math.max(1, runs),
      finals: finals / Math.max(1, runs),
      upperFinal: upperFinal / Math.max(1, runs),
      bestRound,
      furthest,
    };
  }
  const PLAYOFF_MATCH_KEYS = [
    'U1',
    'U2',
    'U3',
    'U4',
    'L1',
    'L2',
    'U5',
    'U6',
    'L3',
    'L4',
    'U7',
    'L5',
    'L6',
    'F1',
  ];
  function playoffStageLabel(key) {
    return (
      {
        U1: 'Upper R1',
        U2: 'Upper R1',
        U3: 'Upper R1',
        U4: 'Upper R1',
        L1: 'Lower R1',
        L2: 'Lower R1',
        U5: 'Upper SF',
        U6: 'Upper SF',
        L3: 'Lower SF',
        L4: 'Lower SF',
        U7: 'Upper Final',
        L5: 'Lower Bracket',
        L6: 'Lower Final',
        F1: 'Final',
      }[key] || key
    );
  }
  function playoffStageIndex(key) {
    return (
      {
        U1: 1,
        U2: 1,
        U3: 1,
        U4: 1,
        L1: 2,
        L2: 2,
        U5: 3,
        U6: 3,
        L3: 4,
        L4: 4,
        U7: 5,
        L5: 6,
        L6: 7,
        F1: 8,
      }[key] || 0
    );
  }
  function summarizeManualPlayoffOutcome(allianceState, winners) {
    const alliances = (allianceState?.captainSlots ?? []).map((slot) => ({
      seed: slot.seed,
      teams: [slot.captain, ...slot.picks],
    }));
    const ourKey = loadedTeam != null ? tbaTeamKey(loadedTeam) : '';
    const ourAlliance = alliances.find((a) => a.teams.includes(ourKey));
    if (!ourAlliance) return { bestRound: '—', champ: false, finals: false, upperFinal: false };
    let bestIdx = 0;
    let bestRound = 'Not Qualified';
    for (const key of PLAYOFF_MATCH_KEYS) {
      const bracket = buildPlayoffLabBracket(alliances, winners);
      const match = bracket[key];
      if (!match?.red?.teams?.length || !match?.blue?.teams?.length) continue;
      if (match.red.seed === ourAlliance.seed || match.blue.seed === ourAlliance.seed) {
        const idx = playoffStageIndex(key);
        if (idx > bestIdx) {
          bestIdx = idx;
          bestRound = playoffStageLabel(key);
        }
      }
    }
    const final = buildPlayoffLabBracket(alliances, winners).F1;
    const upper = buildPlayoffLabBracket(alliances, winners).U7;
    const finals =
      !!final && (final.red.seed === ourAlliance.seed || final.blue.seed === ourAlliance.seed);
    const upperFinal =
      !!upper && (upper.red.seed === ourAlliance.seed || upper.blue.seed === ourAlliance.seed);
    const finalWinner = winners['F1'];
    const champ =
      finals &&
      ((finalWinner === 'red' && final.red.seed === ourAlliance.seed) ||
        (finalWinner === 'blue' && final.blue.seed === ourAlliance.seed));
    return {
      bestRound: champ ? 'Champion' : finals ? 'Final' : bestRound,
      champ,
      finals,
      upperFinal,
    };
  }
  function simulatePlayoffAlliancesSummary(allianceState, runs, model) {
    const alliances = (allianceState?.captainSlots ?? []).map((slot) => ({
      seed: slot.seed,
      teams: [slot.captain, ...slot.picks],
    }));
    const ourKey = loadedTeam != null ? tbaTeamKey(loadedTeam) : '';
    const initialRows = alliances.map((a) => ({
      seed: a.seed,
      teams: a.teams,
      isUs: a.teams.includes(ourKey),
      champ: 0,
      finals: 0,
      upperFinal: 0,
      furthestCounts: {
        'Upper R1': 0,
        'Lower R1': 0,
        'Upper SF': 0,
        'Lower SF': 0,
        'Upper Final': 0,
        'Lower Bracket': 0,
        'Lower Final': 0,
        Final: 0,
        Champion: 0,
      },
      epaStrength: strengthForAllianceTeams(a.teams, 'epa'),
      compositeStrength: strengthForAllianceTeams(a.teams, 'composite'),
    }));
    const seedMap = new Map(initialRows.map((r) => [r.seed, r]));
    const labelRank = [
      'Upper R1',
      'Lower R1',
      'Upper SF',
      'Lower SF',
      'Upper Final',
      'Lower Bracket',
      'Lower Final',
      'Final',
      'Champion',
    ];
    for (let i = 0; i < Math.max(1, runs); i += 1) {
      const winners = {};
      const bestIdxBySeed = new Map();
      for (const key of PLAYOFF_MATCH_KEYS) {
        const bracket = buildPlayoffLabBracket(alliances, winners);
        const match = bracket[key];
        if (!match?.red?.teams?.length || !match?.blue?.teams?.length) continue;
        for (const side of [match.red, match.blue]) {
          if (typeof side?.seed === 'number')
            bestIdxBySeed.set(
              side.seed,
              Math.max(bestIdxBySeed.get(side.seed) ?? 0, playoffStageIndex(key)),
            );
        }
        const redProb = playoffWinProb(match, model);
        winners[key] = Math.random() < redProb ? 'red' : 'blue';
      }
      const final = buildPlayoffLabBracket(alliances, winners).F1;
      const upper = buildPlayoffLabBracket(alliances, winners).U7;
      if (upper?.red?.seed != null && seedMap.has(upper.red.seed))
        seedMap.get(upper.red.seed).upperFinal += 1;
      if (upper?.blue?.seed != null && seedMap.has(upper.blue.seed))
        seedMap.get(upper.blue.seed).upperFinal += 1;
      if (final?.red?.seed != null && seedMap.has(final.red.seed))
        seedMap.get(final.red.seed).finals += 1;
      if (final?.blue?.seed != null && seedMap.has(final.blue.seed))
        seedMap.get(final.blue.seed).finals += 1;
      const finalWinner = winners['F1'];
      const champSeed =
        finalWinner === 'red'
          ? final?.red?.seed
          : finalWinner === 'blue'
            ? final?.blue?.seed
            : null;
      if (champSeed != null && seedMap.has(champSeed)) seedMap.get(champSeed).champ += 1;
      initialRows.forEach((row) => {
        let label = 'Upper R1';
        const idx = bestIdxBySeed.get(row.seed) ?? 0;
        if (champSeed === row.seed) label = 'Champion';
        else if (final?.red?.seed === row.seed || final?.blue?.seed === row.seed) label = 'Final';
        else if (idx > 0)
          label = playoffStageLabel(
            PLAYOFF_MATCH_KEYS.find((k) => playoffStageIndex(k) === idx) ?? 'U1',
          );
        row.furthestCounts[label] = (row.furthestCounts[label] ?? 0) + 1;
      });
    }
    return initialRows
      .map((row) => {
        const bestRound =
          Object.entries(row.furthestCounts).sort(
            (a, b) =>
              b[1] - a[1] || labelRank.indexOf(String(b[0])) - labelRank.indexOf(String(a[0])),
          )[0]?.[0] ?? '—';
        return {
          ...row,
          champ: row.champ / Math.max(1, runs),
          finals: row.finals / Math.max(1, runs),
          upperFinal: row.upperFinal / Math.max(1, runs),
          bestRound,
        };
      })
      .sort((a, b) => Number(a.seed) - Number(b.seed));
  }
  function savePlayoffResult() {
    if (!playoffLabAllianceState) return;
    const name = window.prompt('Playoff result name', `Playoff ${savedPlayoffResults.length + 1}`);
    if (!name) return;
    const allAllianceRows = simulatePlayoffAlliancesSummary(
      playoffLabAllianceState,
      playoffSimRuns,
      playoffSimModel,
    );
    const ourRow = allAllianceRows.find((r) => r.isUs) ?? null;
    const manual = summarizeManualPlayoffOutcome(playoffLabAllianceState, playoffLabWinners);
    const scenario = {
      id: `playoff_${Date.now()}`,
      name,
      createdAt: Date.now(),
      sourceType: playoffLabSourceType,
      sourceId: playoffLabSourceId,
      simModel: playoffSimModel,
      simRuns: playoffSimRuns,
      allianceState: structuredClone(playoffLabAllianceState),
      manualWinners: structuredClone(playoffLabWinners),
      manualSummary: manual,
      ourSummary: ourRow,
      allAllianceRows,
    };
    setSavedPlayoffResults((prev) => [scenario, ...prev]);
    setActivePlayoffResultId(scenario.id);
  }
  function savePickList() {
    const name = window.prompt('Pick list name', `Pick List ${pickLists.length + 1}`);
    if (!name) return;
    const scenario = {
      id: `pick_${Date.now()}`,
      name,
      createdAt: Date.now(),
      first: [],
      second: [],
      avoid: [],
    };
    setPickLists((prev) => [scenario, ...prev]);
    setActivePickListId(scenario.id);
  }
  function updateActivePickList(mutator) {
    if (!activePickList) return;
    setPickLists((prev) =>
      prev.map((p) => (p.id === activePickList.id ? mutator(structuredClone(p)) : p)),
    );
  }
  function addPickListEntry() {
    if (!activePickList || !pickListEntry) return;
    const row = eventRowMap.get(pickListEntry);
    const entry = {
      teamKey: pickListEntry,
      comment: pickListComment,
      tag: pickListTag,
      teamNumber: row?.teamNumber ?? null,
      nickname: row?.nickname ?? '',
    };
    updateActivePickList((list) => {
      list.first = list.first.filter((e) => e.teamKey !== pickListEntry);
      list.second = list.second.filter((e) => e.teamKey !== pickListEntry);
      list.avoid = list.avoid.filter((e) => e.teamKey !== pickListEntry);
      list[pickListTarget].push(entry);
      return list;
    });
    setPickListEntry('');
    setPickListComment('');
    setPickListTag('');
  }
  function pullLiveAllianceBoard() {
    const sourceRows = [...eventTeamRows]
      .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
      .map((r) => ({
        teamKey: r.teamKey,
        teamNumber: r.teamNumber,
        nickname: r.nickname,
        simRank: r.rank,
        simTotalRp: r.totalRp,
        realRank: r.rank,
        overallEpa: r.overallEpa,
        opr: r.opr,
        composite: r.composite,
        totalSos: r.totalSos,
        record: r.record,
      }));
    setLiveAllianceRuntime(freshAllianceStateFromSource(sourceRows));
    setLiveAlliancePickTarget('');
    setLiveAlliancePulledAt(Date.now());
  }
  const liveAllianceAvailableTeams = useMemo(() => {
    const sourceRows = liveAllianceRuntime?.sourceRows ?? [];
    const used = new Set(
      liveAllianceRuntime?.captainSlots?.flatMap((s) => [s.captain, ...s.picks]) ?? [],
    );
    const declined = new Set(liveAllianceRuntime?.declined ?? []);
    const currentCaptain =
      liveAllianceRuntime?.captainSlots?.[liveAllianceRuntime?.currentIndex ?? 0]?.captain;
    return sourceRows
      .filter((r) => r.teamKey !== currentCaptain)
      .filter((r) => !used.has(r.teamKey))
      .filter((r) => !declined.has(r.teamKey));
  }, [liveAllianceRuntime]);
  const liveAllianceCurrentCaptain = useMemo(
    () =>
      liveAllianceRuntime?.captainSlots?.[liveAllianceRuntime?.currentIndex ?? 0]?.captain ?? null,
    [liveAllianceRuntime],
  );
  const liveAllianceCandidateInsights = useMemo(
    () =>
      buildAllianceCandidateInsights({
        availableRows: liveAllianceAvailableTeams,
        captainSlots: liveAllianceRuntime?.captainSlots ?? [],
        currentCaptainKey: liveAllianceCurrentCaptain,
        eventRowMap,
      }),
    [
      eventRowMap,
      liveAllianceAvailableTeams,
      liveAllianceCurrentCaptain,
      liveAllianceRuntime?.captainSlots,
    ],
  );
  const pickDeskRuntime = useMemo(() => {
    if (liveAllianceRuntime?.captainSlots?.length) return liveAllianceRuntime;
    if (allianceRuntime?.captainSlots?.length) return allianceRuntime;
    return freshAllianceStateFromSource(
      [...eventTeamRows].sort((a, b) => Number(a.rank ?? 9999) - Number(b.rank ?? 9999)),
    );
  }, [allianceRuntime, eventTeamRows, liveAllianceRuntime]);
  const pickDeskTakenTeams = useMemo(() => {
    const taken = new Set();
    (pickDeskRuntime?.captainSlots ?? []).forEach((slot) =>
      [slot.captain, ...(slot.picks ?? [])].forEach((teamKey) => taken.add(teamKey)),
    );
    return taken;
  }, [pickDeskRuntime]);
  const pickListCandidateInsights = useMemo(
    () =>
      buildAllianceCandidateInsights({
        availableRows: eventTeamRows.filter((row) => !pickDeskTakenTeams.has(row.teamKey)),
        captainSlots: pickDeskRuntime?.captainSlots ?? [],
        currentCaptainKey:
          pickDeskRuntime?.captainSlots?.[pickDeskRuntime?.currentIndex ?? 0]?.captain ?? null,
        eventRowMap,
      }),
    [eventRowMap, eventTeamRows, pickDeskRuntime, pickDeskTakenTeams],
  );
  const pickListInsightMap = useMemo(
    () => new Map(pickListCandidateInsights.map((row) => [row.teamKey, row])),
    [pickListCandidateInsights],
  );
  function handleLiveAllianceAccept() {
    if (!liveAllianceRuntime || !liveAlliancePickTarget) return;
    let next = structuredClone(liveAllianceRuntime);
    const currentCaptain = next.captainSlots[next.currentIndex];
    const target = liveAlliancePickTarget;
    const targetCaptainIndex = next.captainSlots.findIndex((s) => s.captain === target);
    if (targetCaptainIndex >= 0) {
      currentCaptain.picks.push(target);
      next.captainSlots.splice(targetCaptainIndex, 1);
      const unavailable = new Set(next.captainSlots.flatMap((s) => [s.captain, ...s.picks]));
      (next.declined ?? []).forEach((k) => unavailable.add(k));
      unavailable.add(target);
      const replacement = next.sourceRows.find((r) => !unavailable.has(r.teamKey));
      if (replacement)
        next.captainSlots.push({
          seed: next.captainSlots.length + 1,
          captain: replacement.teamKey,
          picks: [],
        });
      if (targetCaptainIndex < next.currentIndex)
        next.currentIndex = Math.max(0, next.currentIndex - 1);
    } else currentCaptain.picks.push(target);
    next.captainSlots = reseedCaptainSlots(next.captainSlots);
    next = advanceAllianceTurn(next);
    setLiveAllianceRuntime(next);
    setLiveAlliancePickTarget('');
  }
  function handleLiveAllianceDecline() {
    if (!liveAllianceRuntime || !liveAlliancePickTarget) return;
    setLiveAllianceRuntime((prev) => ({
      ...prev,
      declined: [...(prev.declined ?? []), liveAlliancePickTarget],
    }));
    setLiveAlliancePickTarget('');
  }
  function renderProductBar() {
    return (
      <header className="dashboard-productbar" aria-label="Primary sections">
        <div className="dashboard-productbar-inner">
          <div className="dashboard-brand" aria-label="Strategy Desk">
            <div className="dashboard-brand-mark">TBSB</div>
          </div>
          <nav className="dashboard-major-nav" aria-label="Primary sections">
            {['CURRENT', 'HISTORICAL', 'PREDICT', 'SETTINGS'].map((name) => (
              <button
                key={name}
                className={`tab-button major-nav-button ${majorTab === name ? 'active' : ''}`}
                aria-label={name}
                aria-pressed={majorTab === name}
                onClick={() => setMajorTab(name)}
              >
                <span className="major-nav-button-title">
                  {t(`nav.major.${normalizeTranslationKey(name)}`, name)}
                </span>
              </button>
            ))}
          </nav>
          <div className="dashboard-product-meta">
            <span className={`badge ${offlineMode ? 'badge-red' : 'badge-green'}`}>
              {offlineMode ? t('status.offline', 'Offline') : t('status.live', 'Live')}
            </span>
            <div className="dashboard-product-statuses" aria-label="Live source health">
              <span
                className={`badge dashboard-inline-chip dashboard-sync-pill ${isLoading ? 'badge-green' : ''}`}
              >
                {t('status.sync_short', 'Sync')}
              </span>
              <span
                className={`badge dashboard-inline-chip ${snapshot?.tba?.event ? 'badge-green' : ''}`}
              >
                TBA{' '}
                {snapshot?.tba?.event
                  ? t('status.working', 'Working')
                  : t('status.waiting', 'Waiting')}
              </span>
              {sourceValidation ? (
                <span
                  className={`badge dashboard-inline-chip ${sourceStatusBadgeClass(
                    sourceValidation.firstStatus,
                  )}`}
                >
                  FIRST {sourceStatusLabel(sourceValidation.firstStatus)}
                </span>
              ) : null}
              {nexusSnapshot ? (
                <span
                  className={`badge dashboard-inline-chip ${sourceStatusBadgeClass(
                    nexusSnapshot.status,
                  )}`}
                >
                  Nexus {sourceStatusLabel(nexusSnapshot.status)}
                </span>
              ) : null}
            </div>
            {competitionHeaderMeta ? (
              <div
                className="dashboard-product-event"
                title={
                  competitionHeaderMeta.competitionDayText
                    ? `${competitionHeaderMeta.competitionName} | ${competitionHeaderMeta.competitionDayText}`
                    : competitionHeaderMeta.competitionName
                }
              >
                <span className="dashboard-product-event-name">
                  {competitionHeaderMeta.competitionName}
                </span>
                {competitionHeaderMeta.competitionDayText ? (
                  <span className="dashboard-product-event-day">
                    {competitionHeaderMeta.competitionDayText}
                  </span>
                ) : null}
              </div>
            ) : null}
            <ProductClock nowMs={nowMs} />
          </div>
        </div>
      </header>
    );
  }
  function renderTopControls() {
    const normalizedLoadedEventKey = normalizeEventKey(loadedEventKey);
    const lastUpdateMs =
      lastSnapshotMeta &&
      Number(lastSnapshotMeta.team) === Number(loadedTeam) &&
      normalizeEventKey(lastSnapshotMeta.eventKey) === normalizedLoadedEventKey
        ? lastSnapshotMeta.generatedAtMs
        : (snapshot?.generatedAtMs ?? null);
    const lastUpdateText = lastUpdateMs
      ? formatLocalizedDateTime(lastUpdateMs, language, {
          hour: '2-digit',
          minute: '2-digit',
        })
      : t('status.waiting_first_load', 'Waiting for first load');

    return (
      <header className="dashboard-topbar">
        <div className="dashboard-topbar-row">
          <div className="dashboard-subnav-shell">
            {majorTab !== 'SETTINGS' ? (
              <nav className="dashboard-subnav" aria-label={`${majorTab} subsections`}>
                <div className="dashboard-subnav-track">
                  {subTabs.map((name) => (
                    <button
                      key={name}
                      className={`tab-button dashboard-subtab-button ${tab === name ? 'active' : ''}`}
                      aria-pressed={tab === name}
                      onClick={() => {
                        if (majorTab === 'CURRENT') setCurrentSubTab(name);
                        if (majorTab === 'HISTORICAL') setHistoricalSubTab(name);
                        if (majorTab === 'PREDICT') setPredictSubTab(name);
                      }}
                    >
                      {t(subTabTranslationKey(majorTab, name), name)}
                    </button>
                  ))}
                </div>
              </nav>
            ) : (
              <div className="dashboard-subnav-label">{localizedPageMeta.title}</div>
            )}
          </div>
          <div className="dashboard-contextbar">
            <input
              className="input mono dashboard-inline-input"
              type="number"
              value={draftTeam}
              onChange={(e) => setDraftTeam(Number(e.target.value))}
              onKeyDown={(event) => handleActionInputKeyDown(event, handleLoad)}
              aria-label={t('field.team', 'Team')}
              placeholder={t('field.team', 'Team')}
            />
            <div
              className="dashboard-event-search-shell"
              onBlur={(event) => {
                if (event.currentTarget.contains(event.relatedTarget)) return;
                window.setTimeout(() => setEventSearchOpen(false), 90);
              }}
            >
              <input
                ref={eventSearchInputRef}
                className="input mono dashboard-inline-input dashboard-inline-input-event"
                value={draftEventKey}
                onChange={(e) => {
                  setDraftEventKey(e.target.value);
                  setEventSearchOpen(true);
                }}
                onFocus={() => setEventSearchOpen(true)}
                onKeyDown={(event) => handleActionInputKeyDown(event, handleLoad)}
                aria-label={t('field.event', 'Event')}
                placeholder={t('field.event', 'Event')}
                autoComplete="off"
              />
              {showEventSearchResults ? (
                <div className="dashboard-event-search-results panel">
                  <div className="dashboard-event-search-results-header">
                    {eventSearchLoading
                      ? t('field.searching', 'Searching...')
                      : teamScopedEventSearch
                        ? `Team ${Math.floor(Number(draftTeam))} ${EVENT_SEARCH_YEAR} events`
                        : `${EVENT_SEARCH_YEAR} events`}
                  </div>
                  {eventSearchLoading ? (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {t('field.searching_events', 'Searching events...')}
                    </div>
                  ) : visibleEventSearchOptions.length ? (
                    <div className="stack-8">
                      {visibleEventSearchOptions.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          className="button button-subtle dashboard-event-option"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            chooseEventSearchOption(option);
                          }}
                        >
                          <div style={{ fontWeight: 800 }}>{option.shortName || option.name}</div>
                          <div className="muted mono" style={{ fontSize: 11 }}>
                            {option.key}
                          </div>
                          {option.location ? (
                            <div className="muted" style={{ fontSize: 11 }}>
                              {option.location}
                            </div>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {teamScopedEventSearch
                        ? `No ${EVENT_SEARCH_YEAR} events found for Team ${Math.floor(Number(draftTeam))}.`
                        : `No ${EVENT_SEARCH_YEAR} events matched.`}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            <button className="button button-primary dashboard-inline-button" onClick={handleLoad}>
              {t('field.load', 'Load')}
            </button>
            <button
              type="button"
              className={`button dashboard-inline-button ${offlineMode ? 'button-danger' : 'button-subtle'}`}
              onClick={() => setOfflineMode((v) => !v)}
            >
              {offlineMode ? t('status.offline', 'Offline') : t('field.go_offline', 'Go Offline')}
            </button>
            <button
              type="button"
              className="button button-subtle dashboard-inline-button"
              onClick={() => setOfflineAdvance((v) => v + 1)}
              disabled={!offlineMode}
              aria-label={t('field.advance_match', '+1 Match')}
              title={t('field.advance_match', '+1 Match')}
            >
              {t('field.advance_match', '+1 Match')}
            </button>
            <button
              type="button"
              className={`button dashboard-inline-button ${audioEnabled ? 'button-primary' : 'button-subtle'}`}
              onClick={() => void toggleAudio()}
              aria-label={t('field.audio', 'Audio')}
              title={t('field.audio', 'Audio')}
            >
              {audioEnabled ? t('field.audio_on', 'Audio On') : t('field.audio_off', 'Audio Off')}
            </button>
            <div className="dashboard-status-strip">
              <span className="badge badge-blue dashboard-inline-chip">
                {t('field.event', 'Event')} {loadedEventKey || '-'}
              </span>
              <span className="badge dashboard-inline-chip">
                {t('field.team', 'Team')} {loadedTeam ?? '-'}
              </span>
              <span className="badge dashboard-inline-chip">
                {t('field.poll', 'Poll {{value}}s', {
                  value: Math.round(settings.pollMs / 1000),
                })}
              </span>
              <span className="badge dashboard-inline-chip">
                {t('field.updated', 'Updated')} {lastUpdateText}
              </span>
              {nexusSnapshot?.queueText ? (
                <span className="badge dashboard-inline-chip">{nexusSnapshot.queueText}</span>
              ) : null}
              {errorText ? (
                <span className="badge badge-red dashboard-inline-chip">{errorText}</span>
              ) : null}
            </div>
          </div>
        </div>
      </header>
    );
  }
  function renderTabs() {
    return renderProductBar();
  }
  function renderCommandPalette() {
    if (!commandPaletteOpen) return null;
    return (
      <div
        role="presentation"
        onClick={() => closeCommandPalette()}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(2, 6, 23, 0.72)',
          backdropFilter: 'blur(10px)',
          zIndex: 90,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '10vh 16px 16px',
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command Palette"
          className="panel"
          onClick={(event) => event.stopPropagation()}
          style={{
            width: 'min(720px, 100%)',
            padding: 16,
            border: '1px solid rgba(148, 163, 184, 0.24)',
            boxShadow: '0 28px 80px rgba(15, 23, 42, 0.55)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
              marginBottom: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>Command Palette</div>
              <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                Jump to tabs, matches, strategy targets, and team profiles from one place.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="badge">Ctrl/Cmd+K</span>
              <span className="badge">Arrow Keys + Enter</span>
              <span className="badge">Esc to close</span>
            </div>
          </div>
          <input
            ref={commandPaletteInputRef}
            className="input"
            value={commandPaletteQuery}
            onChange={(event) => {
              setCommandPaletteQuery(event.target.value);
              setCommandPaletteIndex(0);
            }}
            placeholder="Jump to tab, team, match, or strategy target..."
            aria-label="Command Palette Search"
            style={{ width: '100%', marginBottom: 12 }}
          />
          <div className="stack-8" style={{ maxHeight: '60vh', overflow: 'auto' }}>
            {filteredCommandPaletteActions.map((action, index) => {
              const active = index === commandPaletteIndex;
              return (
                <button
                  key={action.key}
                  type="button"
                  className="panel-2"
                  onMouseEnter={() => setCommandPaletteIndex(index)}
                  onClick={() => executeCommandPaletteAction(action)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: 12,
                    borderColor: active ? '#4bb3fd' : 'rgba(148, 163, 184, 0.18)',
                    background: active ? 'rgba(75, 179, 253, 0.12)' : undefined,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 900 }}>{action.label}</div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    {action.description}
                  </div>
                </button>
              );
            })}
            {!filteredCommandPaletteActions.length ? (
              <div className="muted" style={{ padding: 12 }}>
                No quick-jump results match the current search.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
  function renderTeamIntelCard(teamKey, label) {
    const row = eventRowMap.get(teamKey);
    const teamNumber = row?.teamNumber ?? teamNumberFromKey(teamKey);
    if (!row)
      return (
        <div className="panel-2" style={{ padding: 10 }}>
          <div style={{ fontWeight: 900 }}>{label ?? teamKey}</div>
          <div className="mono">{teamKey}</div>
          {teamNumber != null ? (
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 8,
                flexWrap: 'wrap',
              }}
            >
              <button className="button" onClick={() => openTeamProfile(teamNumber)}>
                TEAM_PROFILE
              </button>
              <button className="button" onClick={() => addTeamToCompare(teamNumber)}>
                COMPARE
              </button>
            </div>
          ) : null}
        </div>
      );
    return (
      <div className="panel-2" style={{ padding: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontWeight: 900 }}>{label ?? `${row.teamNumber} ${row.nickname}`}</div>
          <div className="mono">{teamKey}</div>
        </div>
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          Real Rank {row.rank ?? '—'} | Comp Rank {row.compositeRank ?? '—'} | TOTAL RP{' '}
          {fmt(row.totalRp, 1)} | Record {row.record}
        </div>
        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          EPA {fmt(row.overallEpa, 1)} | Auto {fmt(row.autoEpa, 1)} | Tele {fmt(row.teleopEpa, 1)} |
          End {fmt(row.endgameEpa, 1)}
        </div>
        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          OPR {fmt(row.opr, 1)} | DPR {fmt(row.dpr, 1)} | CCWM {fmt(row.ccwm, 1)} | Composite{' '}
          {fmt(row.composite, 1)}
        </div>
        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          Played SOS {fmt(row.playedSos, 1)} | Rem SOS {fmt(row.remainingSos, 1)} | Total SOS{' '}
          {fmt(row.totalSos, 1)}
        </div>
        {renderTeamOpsBadges(row.teamNumber, {
          emphasizeLoaded: loadedTeam != null && Number(row.teamNumber) === Number(loadedTeam),
        })}
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="button" onClick={() => openTeamProfile(row.teamNumber)}>
            TEAM_PROFILE
          </button>
          <button className="button" onClick={() => addTeamToCompare(row.teamNumber)}>
            COMPARE
          </button>
        </div>
      </div>
    );
  }
  function renderKeyMatchCard(match) {
    const teams = [...match.alliances.red.team_keys, ...match.alliances.blue.team_keys];
    const rival =
      teams.find((teamKey) => rivalTeamsOnly.some((r) => r.team_key === teamKey)) ?? null;
    const pred = getSbPred(sbMatchMap.get(match.key));
    const redWin = pred?.red_win_prob != null ? Number(pred.red_win_prob) : null;
    const blueWin = redWin != null ? 1 - redWin : null;
    const redScore = pred?.red_score != null ? fmt(pred.red_score, 0) : '—';
    const blueScore = pred?.blue_score != null ? fmt(pred.blue_score, 0) : '—';
    return (
      <div
        key={match.key}
        className="panel-2"
        style={{ padding: 10, cursor: 'pointer' }}
        onClick={() => {
          setSelectedMatchKey(match.key);
          setTab('MATCH');
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontWeight: 900 }}>{formatMatchLabel(match)}</div>
          <div>
            Red {pct(redWin)} | Blue {pct(blueWin)}
          </div>
        </div>
        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          Predicted Score — Red: {redScore}, Blue: {blueScore}
        </div>
        <div
          style={{
            marginTop: 8,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
          }}
        >
          <div className="panel-2" style={{ padding: 8, borderColor: '#7a2323' }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>
              Red Alliance
            </div>
            {match.alliances.red.team_keys.map((k) => (
              <div
                key={k}
                style={{
                  fontWeight: k === rival ? 900 : 500,
                  color: k === rival ? '#ffb3b3' : undefined,
                }}
              >
                {k}
              </div>
            ))}
          </div>
          <div className="panel-2" style={{ padding: 8, borderColor: '#214d84' }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>
              Blue Alliance
            </div>
            {match.alliances.blue.team_keys.map((k) => (
              <div
                key={k}
                style={{
                  fontWeight: k === rival ? 900 : 500,
                  color: k === rival ? '#9dcfff' : undefined,
                }}
              >
                {k}
              </div>
            ))}
          </div>
        </div>
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          {buildKeyMatchNarrative(
            match,
            rival,
            rankingsDerived.ourTotalRp,
            eventRowMap,
            sbMatchMap,
            loadedTeam,
          )}
        </div>
      </div>
    );
  }
  function renderNowTab() {
    const nextMatch = livePointers.ourNextMatch;
    const sbMatch = nextMatch ? (sbMatchMap.get(nextMatch.key) ?? null) : null;
    const pred = getSbPred(sbMatch);
    const ourAlliance =
      nextMatch && loadedTeam != null ? allianceForTeam(nextMatch, tbaTeamKey(loadedTeam)) : null;
    const redWinProb = pred?.red_win_prob != null ? Number(pred.red_win_prob) : null;
    const ourWinProb =
      redWinProb != null && ourAlliance
        ? ourAlliance === 'red'
          ? redWinProb
          : 1 - redWinProb
        : null;
    return (
      <div className="stack-12" style={{ marginTop: 12 }}>
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Next Match
            </div>
            <div style={{ fontSize: 30, fontWeight: 900, marginTop: 4 }}>
              {nextMatch ? formatMatchLabel(nextMatch) : '—'}
            </div>
            <div className="mono muted" style={{ marginTop: 6 }}>
              {nextMatch?.key ?? 'No upcoming match found'}
            </div>
            <div className="grid-3" style={{ marginTop: 16 }}>
              <div className="panel-2" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  Matches Away
                </div>
                <div style={{ fontSize: 24, fontWeight: 900 }}>
                  {livePointers.matchesAway ?? '—'}
                </div>
              </div>
              <div className="panel-2" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  Countdown
                </div>
                <div style={{ fontSize: 24, fontWeight: 900 }}>
                  {liveCountdownMs == null ? '—' : formatCountdown(liveCountdownMs)}
                </div>
              </div>
              <div className="panel-2" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  Our Win %
                </div>
                <div style={{ fontSize: 24, fontWeight: 900 }}>{pct(ourWinProb)}</div>
              </div>
            </div>
            <div className="grid-2" style={{ marginTop: 16 }}>
              <div className="panel-2" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  Predicted Score
                </div>
                <div style={{ fontWeight: 900, marginTop: 6 }}>
                  Red: {pred?.red_score != null ? fmt(pred.red_score, 0) : '—'} | Blue:{' '}
                  {pred?.blue_score != null ? fmt(pred.blue_score, 0) : '—'}
                </div>
              </div>
              <div className="panel-2" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  Alliance Context
                </div>
                <div style={{ fontWeight: 900, marginTop: 6 }}>
                  Our color: {ourAlliance ?? '—'} | Red {pct(redWinProb)} | Blue{' '}
                  {redWinProb != null ? pct(1 - redWinProb) : '—'}
                </div>
              </div>
            </div>
            {loadedTeamOps || lastLiveSignal || sourceValidation ? (
              <div className="grid-3" style={{ marginTop: 16 }}>
                {loadedTeamOps ? (
                  <>
                    <div className="panel-2" style={{ padding: 12 }}>
                      <div className="muted" style={{ fontSize: 12 }}>
                        Loaded Team Ops
                      </div>
                      <div style={{ fontWeight: 900, marginTop: 6 }}>
                        {loadedTeamOps.queueState ?? 'No active Nexus team queue context'}
                      </div>
                      <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                        Pit {loadedTeamOps.pitAddress ?? '-'} | Inspection{' '}
                        {loadedTeamOps.inspectionStatus ?? '-'}
                      </div>
                    </div>
                    <div className="panel-2" style={{ padding: 12 }}>
                      <div className="muted" style={{ fontSize: 12 }}>
                        Bumper + Timing
                      </div>
                      <div style={{ fontWeight: 900, marginTop: 6 }}>
                        {loadedTeamOps.bumperColor ?? '-'} | Away{' '}
                        {loadedTeamOps.queueMatchesAway ?? '-'}
                      </div>
                      <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                        Queue {formatOpsTime(loadedTeamOps.estimatedQueueTimeMs)}
                      </div>
                    </div>
                  </>
                ) : null}
                {lastLiveSignal ? (
                  <div className="panel-2" style={{ padding: 12 }}>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {['alliance_selection', 'broadcast'].includes(
                        String(lastLiveSignal.signalType ?? ''),
                      )
                        ? 'Live Desk Prompt'
                        : 'Last Live Signal'}
                    </div>
                    <div style={{ fontWeight: 900, marginTop: 6 }}>{lastLiveSignal.title}</div>
                    <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                      {lastLiveSignal.body || lastLiveSignal.signalType}
                    </div>
                  </div>
                ) : sourceValidation ? (
                  <div className="panel-2" style={{ padding: 12 }}>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Source Trust
                    </div>
                    <div style={{ fontWeight: 900, marginTop: 6 }}>
                      {validationCounts.mismatch} mismatch / {validationCounts.missing} missing
                    </div>
                    <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                      Stale{' '}
                      {sourceValidation.staleSeconds != null
                        ? `${sourceValidation.staleSeconds}s`
                        : '-'}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {featuredLiveSignal ? (
              <div
                className="panel-2"
                style={{
                  padding: 14,
                  marginTop: 16,
                  borderColor:
                    featuredLiveSignal.signalType === 'alliance_selection' ? '#f3be3b' : '#4bb3fd',
                }}
              >
                <div className="muted" style={{ fontSize: 12 }}>
                  Live Desk Prompt
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6 }}>
                  {featuredLiveSignal.title}
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  {featuredLiveSignal.body || featuredLiveSignal.signalType}
                </div>
              </div>
            ) : null}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Next Match — Team Intel</div>
              <div className="stack-8">
                {nextMatch?.alliances.red.team_keys.map((k) => (
                  <div key={k}>{renderTeamIntelCard(k, `Red — ${k}`)}</div>
                ))}
                {nextMatch?.alliances.blue.team_keys.map((k) => (
                  <div key={k}>{renderTeamIntelCard(k, `Blue — ${k}`)}</div>
                ))}
              </div>
            </div>
          </div>
          <div className="stack-12">
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Rival Band (±6 TOTAL RP)</div>
              <div className="stack-8" style={{ maxHeight: 250, overflow: 'auto' }}>
                {rivalBand.map((row) => (
                  <div
                    key={row.team_key}
                    className="panel-2"
                    style={{
                      padding: 10,
                      background: row._isUs ? '#132033' : undefined,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 10,
                      }}
                    >
                      <div className="mono">{row.team_key}</div>
                      <div>Rank {row.rank}</div>
                    </div>
                    <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                      TOTAL RP {fmt(row._totalRp, 1)} {row._isUs ? '| US' : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Key Matches</div>
              <div className="stack-8" style={{ maxHeight: 650, overflow: 'auto' }}>
                {keyMatches.slice(0, 12).map((match) => renderKeyMatchCard(match))}
                {!keyMatches.length ? <div className="muted">No key matches found.</div> : null}
              </div>
            </div>
          </div>
        </div>
        {nextMatchTeamNumbers.length ? (
          <DisclosureSection
            storageKey="ui.current.now.match_context"
            title="Next Match Context Analytics"
            description="Trend pack, breakdown matrix, and partner/opponent context for the next match."
          >
            <TeamContextAnalyticsBlock
              title="Next Match Context Analytics"
              subtitle="Current-event-only trend pack for our next match."
              teamNumbers={nextMatchTeamNumbers}
              loadedEventKey={loadedEventKey}
              baselineTeamNumber={loadedTeam ?? null}
              currentMetricKeys={[
                'event_match_rp',
                'event_match_epa',
                'event_match_my_score',
                'event_match_opp_score',
                'event_match_margin',
                'event_match_auto',
                'event_match_teleop',
                'event_match_endgame',
                'event_match_rolling_opr',
                'event_match_rolling_copr',
                'event_match_rolling_dpr',
                'event_match_rolling_ccwm',
              ]}
              historicalMetricKeys={[
                'season_match_epa',
                'season_match_my_score',
                'season_match_opp_score',
                'season_match_margin',
                'season_match_auto',
                'season_match_teleop',
                'season_match_endgame',
              ]}
              showBreakdownMatrix
              onOpenTeamProfile={openTeamProfile}
              scope="current"
            />
          </DisclosureSection>
        ) : null}
        {nexusSnapshot || recentLiveSignals.length || preferredWebcast ? (
          <DisclosureSection
            storageKey="ui.current.now.live_ops"
            title="Live Ops Feed"
            description="Queue context, webhook/live signals, and webcast access for the active event."
            defaultOpen
          >
            <div className="grid-2">
              <div className="stack-12">
                <div className="panel" style={{ padding: 16 }}>
                  <div style={{ fontWeight: 900, marginBottom: 10 }}>Desk Ops Summary</div>
                  <div className="grid-3">
                    <div className="panel-2" style={{ padding: 12 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        Queue
                      </div>
                      <div style={{ fontWeight: 900, fontSize: 20 }}>
                        {nexusSnapshot?.queueText ?? 'No Nexus queue feed'}
                      </div>
                    </div>
                    <div className="panel-2" style={{ padding: 12 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        Announcements
                      </div>
                      <div style={{ fontWeight: 900, fontSize: 20 }}>
                        {nexusSnapshot?.announcements?.length ?? 0}
                      </div>
                    </div>
                    <div className="panel-2" style={{ padding: 12 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        Live Signals
                      </div>
                      <div style={{ fontWeight: 900, fontSize: 20 }}>{liveSignals.length}</div>
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: 12 }}>
                    <div className="panel-2" style={{ padding: 12 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        Parts Requests
                      </div>
                      <div style={{ fontWeight: 900 }}>
                        {nexusSnapshot?.partsRequests?.length ?? 0}
                      </div>
                    </div>
                    <div className="panel-2" style={{ padding: 12 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        Inspection
                      </div>
                      <div style={{ fontWeight: 900 }}>
                        {nexusSnapshot?.inspectionSummary
                          ? `P ${nexusSnapshot.inspectionSummary.passed ?? 0} / Pending ${
                              nexusSnapshot.inspectionSummary.pending ?? 0
                            } / F ${nexusSnapshot.inspectionSummary.failed ?? 0}`
                          : 'No inspection feed'}
                      </div>
                    </div>
                  </div>
                </div>
                <AnalyticsChartBlock
                  title="Ops Readiness Board"
                  description="Quick ops pressure view for queue, announcements, parts, inspections, and live signals."
                  data={[
                    {
                      label: 'Signals',
                      value: liveSignals.length,
                    },
                    {
                      label: 'Queue Away',
                      value: Math.max(0, Number(nexusSnapshot?.queueMatchesAway ?? 0)),
                    },
                    {
                      label: 'Announcements',
                      value: Number(nexusSnapshot?.announcements?.length ?? 0),
                    },
                    {
                      label: 'Parts',
                      value: Number(nexusSnapshot?.partsRequests?.length ?? 0),
                    },
                    {
                      label: 'Pending Insp',
                      value: Number(nexusSnapshot?.inspectionSummary?.pending ?? 0),
                    },
                  ]}
                  chartFamily="bar"
                  series={[{ key: 'value', label: 'Count', color: '#4bb3fd' }]}
                  valueFormatter={(value) => fmt(value, 0)}
                />
              </div>
              <div className="stack-12">
                <div className="panel" style={{ padding: 16 }}>
                  <div style={{ fontWeight: 900, marginBottom: 10 }}>Recent Event Signals</div>
                  <div className="stack-8" style={{ maxHeight: 300, overflow: 'auto' }}>
                    {recentLiveSignals.map((signal) => (
                      <div key={signal.id} className="panel-2" style={{ padding: 12 }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                            alignItems: 'flex-start',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 800 }}>{signal.title}</div>
                            <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                              {signal.body || signal.signalType}
                            </div>
                          </div>
                          <span className="badge dashboard-inline-chip">{signal.source}</span>
                        </div>
                        <div className="muted mono" style={{ marginTop: 8, fontSize: 11 }}>
                          {formatLocalizedDateTime(signal.createdAtMs, language, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                    ))}
                    {!recentLiveSignals.length ? (
                      <div className="muted">No live signals have been received yet.</div>
                    ) : null}
                  </div>
                </div>
                <div className="panel" style={{ padding: 16 }}>
                  <div style={{ fontWeight: 900, marginBottom: 10 }}>Live Webcast</div>
                  {preferredYouTubeVideoId ? (
                    <div className="stack-8">
                      <div className="muted">
                        Watch the preferred webcast directly in NOW. If it is actively playing and
                        you leave NOW, it will follow the desk as a floating mini-player.
                      </div>
                      {webcastPlaybackSuppressed ? (
                        <div className="panel" style={{ padding: 16 }}>
                          <div style={{ fontWeight: 800, marginBottom: 8 }}>
                            Webcast paused for this desk
                          </div>
                          <div className="muted" style={{ marginBottom: 12 }}>
                            The floating mini-player was closed. Resume it here when you want the
                            webcast back on screen.
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button
                              className="button button-primary"
                              type="button"
                              onClick={handleInlineWebcastPlayIntent}
                            >
                              Resume Webcast
                            </button>
                            {preferredYouTubeWebcast?.url ? (
                              <a
                                className="button"
                                href={preferredYouTubeWebcast.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open Webcast
                              </a>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <div
                          ref={inlineWebcastAnchorRef}
                          data-webcast-inline-anchor="true"
                          className="webcast-inline-anchor"
                        >
                          {showInlineWebcast ? (
                            <YouTubeWebcastPlayer
                              key={`now-webcast-${loadedEventKey}-${preferredYouTubeVideoId}`}
                              webcast={preferredYouTubeWebcast}
                              eventKey={loadedEventKey}
                              eventName={currentEventName}
                              variant="inline"
                              initialTimeSeconds={webcastPlayerState.currentTime}
                              shouldAutoplay={
                                (webcastPlaybackContinuing || webcastPlayerState.floatingVisible) &&
                                !webcastPlaybackSuppressed
                              }
                              onSnapshotChange={handleWebcastSnapshotChange}
                            />
                          ) : (
                            <div className="webcast-pip-placeholder">
                              <div style={{ fontWeight: 800 }}>Webcast is floating</div>
                              <div className="muted" style={{ fontSize: 12 }}>
                                Scroll back to the webcast or use the floating player.
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : preferredWebcast?.url ? (
                    <div className="stack-8">
                      <div className="muted">
                        This event surfaced a webcast, but it does not expose a YouTube embed that
                        can stay in-app.
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <a
                          className="button button-primary"
                          href={preferredWebcast.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open Webcast
                        </a>
                        <span className="badge dashboard-inline-chip">{preferredWebcast.type}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="muted">No webcast surfaced for this event yet.</div>
                  )}
                </div>
              </div>
            </div>
          </DisclosureSection>
        ) : null}
      </div>
    );
  }
  function renderScheduleTable(matches, mode) {
    const ourKey = loadedTeam != null ? tbaTeamKey(loadedTeam) : '';
    return (
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Match</th>
              <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>
                {mode === 'ourPast' ? 'Ended' : 'Countdown'}
              </th>
              <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Red %</th>
              <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Blue %</th>
              <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Red Alliance</th>
              <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Blue Alliance</th>
              <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Score</th>
              <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((match) => {
              const pred = getSbPred(sbMatchMap.get(match.key));
              const redWin = pred?.red_win_prob != null ? Number(pred.red_win_prob) : null;
              const alliance = allianceForTeam(match, ourKey);
              const t = getLiveCountdownUnix(match);
              const countdown = t ? Math.max(0, t * 1000 - nowMs) : null;
              const timeCell =
                mode === 'ourPast'
                  ? match.actual_time ||
                    match.post_result_time ||
                    match.predicted_time ||
                    match.time
                    ? new Date(
                        Number(
                          match.actual_time ||
                            match.post_result_time ||
                            match.predicted_time ||
                            match.time,
                        ) * 1000,
                      ).toLocaleString()
                    : '—'
                  : matchIsCompleted(match)
                    ? 'Done'
                    : countdown == null
                      ? '—'
                      : formatCountdown(countdown);
              return (
                <tr
                  key={match.key}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setSelectedMatchKey(match.key);
                    setTab('MATCH');
                  }}
                >
                  <td
                    style={{
                      padding: 8,
                      borderBottom: '1px solid #1a2333',
                      fontWeight: 700,
                    }}
                  >
                    {formatMatchLabel(match)}
                  </td>
                  <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>{timeCell}</td>
                  <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>{pct(redWin)}</td>
                  <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                    {redWin != null ? pct(1 - redWin) : '—'}
                  </td>
                  <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>
                      {alliance === 'red' && mode !== 'all' ? 'Red Alliance (Us)' : 'Red Alliance'}
                    </div>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {match.alliances.red.team_keys.join(' ')}
                    </span>
                  </td>
                  <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>
                      {alliance === 'blue' && mode !== 'all'
                        ? 'Blue Alliance (Us)'
                        : 'Blue Alliance'}
                    </div>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {match.alliances.blue.team_keys.join(' ')}
                    </span>
                  </td>
                  <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                    {match.alliances.red.score != null && match.alliances.blue.score != null
                      ? `Red: ${match.alliances.red.score}, Blue: ${match.alliances.blue.score}`
                      : pred?.red_score != null && pred?.blue_score != null
                        ? `Pred — Red: ${fmt(pred.red_score, 0)}, Blue: ${fmt(pred.blue_score, 0)}`
                        : '—'}
                  </td>
                  <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                    <button
                      className="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openStrategyForMatch(match);
                      }}
                    >
                      STRATEGY
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  function renderScheduleTab() {
    const list =
      scheduleView === 'ourUpcoming'
        ? ourUpcomingMatches
        : scheduleView === 'ourPast'
          ? [...ourPastMatches].reverse()
          : sortedMatches;
    const title =
      scheduleView === 'ourUpcoming'
        ? 'Our Upcoming Matches'
        : scheduleView === 'ourPast'
          ? 'Our Past Matches'
          : 'All Event Matches';
    const scheduleAnalyticsRows = list.slice(0, 24).map((match, index) => {
      const pred = getSbPred(sbMatchMap.get(match.key));
      const redTeams = match?.alliances?.red?.team_keys ?? [];
      const blueTeams = match?.alliances?.blue?.team_keys ?? [];
      const redAvgEpa = averageNullable(
        redTeams.map((key) => eventRowMap.get(key)?.overallEpa ?? null),
      );
      const blueAvgEpa = averageNullable(
        blueTeams.map((key) => eventRowMap.get(key)?.overallEpa ?? null),
      );
      const countdownUnix = getLiveCountdownUnix(match);
      const countdownMinutes =
        countdownUnix != null ? Math.max(0, (countdownUnix * 1000 - nowMs) / 60000) : null;
      return {
        label: formatMatchLabel(match),
        order: index + 1,
        redWin: pred?.red_win_prob != null ? Number(pred.red_win_prob) : null,
        redScore: pred?.red_score != null ? Number(pred.red_score) : null,
        blueScore: pred?.blue_score != null ? Number(pred.blue_score) : null,
        redAvgEpa,
        blueAvgEpa,
        epaDelta: redAvgEpa != null && blueAvgEpa != null ? redAvgEpa - blueAvgEpa : null,
        expectedTotalScore:
          pred?.red_score != null && pred?.blue_score != null
            ? Number(pred.red_score) + Number(pred.blue_score)
            : null,
        countdownMinutes,
      };
    });
    return (
      <div className="stack-12" style={{ marginTop: 12 }}>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="button"
              onClick={() => setScheduleView('ourUpcoming')}
              style={{
                background: scheduleView === 'ourUpcoming' ? '#182336' : undefined,
              }}
            >
              Our Upcoming
            </button>
            <button
              className="button"
              onClick={() => setScheduleView('ourPast')}
              style={{
                background: scheduleView === 'ourPast' ? '#182336' : undefined,
              }}
            >
              Our Past
            </button>
            <button
              className="button"
              onClick={() => setScheduleView('all')}
              style={{
                background: scheduleView === 'all' ? '#182336' : undefined,
              }}
            >
              All Event Matches
            </button>
          </div>
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 12 }}>{title}</div>
          {renderScheduleTable(list, scheduleView)}
        </div>
        <DisclosureSection
          storageKey="ui.current.schedule.analytics"
          title="Schedule Analytics"
          description="Projected edge, countdown pressure, and strength context for the matches in view."
        >
          <div className="grid-2">
            <AnalyticsChartBlock
              title="Expected Win + Countdown"
              description="Keep schedule context tied to timing and projected edge."
              data={scheduleAnalyticsRows}
              chartFamily="line"
              series={[
                { key: 'redWin', label: 'Red Win Prob', color: '#ff6b6b' },
                {
                  key: 'countdownMinutes',
                  label: 'Countdown Min',
                  color: '#f3be3b',
                },
              ]}
              valueFormatter={(value, name) =>
                name === 'Red Win Prob' ? pct(value) : fmt(value, 1)
              }
            />
            <AnalyticsChartBlock
              title="Alliance Strength + Expected Score"
              description="Projected scores and average EPA for the matches in view."
              data={scheduleAnalyticsRows}
              chartFamily="composed"
              series={[
                { key: 'redAvgEpa', label: 'Red Avg EPA', color: '#ff9f68' },
                { key: 'blueAvgEpa', label: 'Blue Avg EPA', color: '#4bb3fd' },
                { key: 'redScore', label: 'Red Score', color: '#ff6b6b' },
                { key: 'blueScore', label: 'Blue Score', color: '#2dd4bf' },
              ]}
              valueFormatter={(value) => fmt(value, 1)}
            />
          </div>
          <AnalyticsChartBlock
            title="EPA Delta + Expected Total"
            description="How lopsided the matches in view look right now."
            data={scheduleAnalyticsRows}
            chartFamily="line"
            series={[
              { key: 'epaDelta', label: 'Red EPA Delta', color: '#f97316' },
              {
                key: 'expectedTotalScore',
                label: 'Expected Total Score',
                color: '#2dd4bf',
              },
            ]}
            valueFormatter={(value) => fmt(value, 1)}
          />
        </DisclosureSection>
      </div>
    );
  }
  function renderMatchTab() {
    if (!selectedMatch)
      return (
        <div className="panel" style={{ padding: 16, marginTop: 12 }}>
          <div className="muted">Pick a match from Schedule, Key Matches, or Now.</div>
        </div>
      );
    const pred = getSbPred(selectedSbMatch);
    const ourAlliance =
      loadedTeam != null && matchHasTeam(selectedMatch, tbaTeamKey(loadedTeam))
        ? allianceForTeam(selectedMatch, tbaTeamKey(loadedTeam))
        : null;
    const redTeams = selectedMatch.alliances.red.team_keys;
    const blueTeams = selectedMatch.alliances.blue.team_keys;
    const redAvg = averageNullable(redTeams.map((k) => eventRowMap.get(k)?.overallEpa ?? null));
    const blueAvg = averageNullable(blueTeams.map((k) => eventRowMap.get(k)?.overallEpa ?? null));
    const redComp = averageNullable(redTeams.map((k) => eventRowMap.get(k)?.composite ?? null));
    const blueComp = averageNullable(blueTeams.map((k) => eventRowMap.get(k)?.composite ?? null));
    return (
      <div className="stack-12" style={{ marginTop: 12 }}>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontSize: 28, fontWeight: 900 }}>{formatMatchLabel(selectedMatch)}</div>
          <div className="mono muted" style={{ marginTop: 4 }}>
            {selectedMatch.key}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button className="button" onClick={() => openStrategyForMatch(selectedMatch)}>
              Open in STRATEGY
            </button>
          </div>
          <div className="grid-3" style={{ marginTop: 16 }}>
            <div className="panel-2" style={{ padding: 12 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                Our Color
              </div>
              <div style={{ fontWeight: 900, marginTop: 6 }}>{ourAlliance ?? '—'}</div>
            </div>
            <div className="panel-2" style={{ padding: 12 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                Predicted Score
              </div>
              <div style={{ fontWeight: 900, marginTop: 6 }}>
                Red: {pred?.red_score != null ? fmt(pred.red_score, 0) : '—'} | Blue:{' '}
                {pred?.blue_score != null ? fmt(pred.blue_score, 0) : '—'}
              </div>
            </div>
            <div className="panel-2" style={{ padding: 12 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                Win %
              </div>
              <div style={{ fontWeight: 900, marginTop: 6 }}>
                Red {pct(pred?.red_win_prob)} | Blue{' '}
                {pred?.red_win_prob != null ? pct(1 - Number(pred.red_win_prob)) : '—'}
              </div>
            </div>
          </div>
          <div className="grid-2" style={{ marginTop: 16 }}>
            <div className="panel-2" style={{ padding: 12 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                Red Alliance Aggregate
              </div>
              <div style={{ marginTop: 6 }}>
                Avg EPA {fmt(redAvg, 1)} | Avg Composite {fmt(redComp, 1)}
              </div>
            </div>
            <div className="panel-2" style={{ padding: 12 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                Blue Alliance Aggregate
              </div>
              <div style={{ marginTop: 6 }}>
                Avg EPA {fmt(blueAvg, 1)} | Avg Composite {fmt(blueComp, 1)}
              </div>
            </div>
          </div>
        </div>
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>
              {ourAlliance === 'red' ? 'Red Alliance (Us)' : 'Red Alliance'} Team Intel
            </div>
            <div className="stack-8">
              {redTeams.map((k) => (
                <div key={k}>{renderTeamIntelCard(k)}</div>
              ))}
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>
              {ourAlliance === 'blue' ? 'Blue Alliance (Us)' : 'Blue Alliance'} Team Intel
            </div>
            <div className="stack-8">
              {blueTeams.map((k) => (
                <div key={k}>{renderTeamIntelCard(k)}</div>
              ))}
            </div>
          </div>
        </div>
        <DisclosureSection
          storageKey="ui.current.match.raw_breakdown"
          title="Raw Score Breakdown"
          description="Official score-breakdown JSON for the selected match."
        >
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Raw 2026 Score Breakdown</div>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>
              {selectedMatch.score_breakdown
                ? JSON.stringify(selectedMatch.score_breakdown, null, 2)
                : 'No score breakdown for this match yet.'}
            </pre>
          </div>
        </DisclosureSection>
        {selectedMatchTeamNumbers.length ? (
          <DisclosureSection
            storageKey="ui.current.match.context_analytics"
            title="Match Context Analytics"
            description="Partner and opponent trend packs for the selected match."
          >
            <TeamContextAnalyticsBlock
              title="Selected Match Context Analytics"
              subtitle="Partner/opponent current-event form for the selected match."
              teamNumbers={selectedMatchTeamNumbers}
              loadedEventKey={loadedEventKey}
              baselineTeamNumber={loadedTeam ?? null}
              currentMetricKeys={[
                'event_match_rp',
                'event_match_epa',
                'event_match_my_score',
                'event_match_opp_score',
                'event_match_margin',
                'event_match_auto',
                'event_match_teleop',
                'event_match_endgame',
                'event_match_rolling_opr',
                'event_match_rolling_copr',
                'event_match_rolling_dpr',
                'event_match_rolling_ccwm',
              ]}
              historicalMetricKeys={[
                'season_match_epa',
                'season_match_my_score',
                'season_match_opp_score',
                'season_match_margin',
                'season_match_auto',
                'season_match_teleop',
                'season_match_endgame',
              ]}
              showBreakdownMatrix
              onOpenTeamProfile={openTeamProfile}
              scope="current"
            />
          </DisclosureSection>
        ) : null}
      </div>
    );
  }
  function renderRankingsTab() {
    const rankingDistributionRows = rankingsDerived.rows.map((row) => ({
      label: `${teamNumberFromKey(row.team_key) ?? row.team_key}`,
      totalRp: row._totalRp,
      rpAverage: row._rpAverage,
    }));
    const strengthDistributionRows = eventTeamRows.map((row) => ({
      label: `${row.teamNumber}`,
      epa: row.overallEpa,
      opr: row.opr,
      comp: row.composite,
      sos: row.totalSos,
      rank: row.rank,
      compRank: row.compositeRank,
    }));
    return (
      <div className="stack-12" style={{ marginTop: 12 }}>
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Official Rankings</div>
            <div style={{ overflow: 'auto', maxHeight: 650 }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Rank</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Comp Rank</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Team</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>MP</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>RP Avg</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>TOTAL RP</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rankingsDerived.rows.map((row) => {
                    const isUs = loadedTeam != null && row.team_key === tbaTeamKey(loadedTeam);
                    const teamNumber = teamNumberFromKey(row.team_key);
                    return (
                      <tr
                        key={row.team_key}
                        style={{ background: isUs ? '#132033' : 'transparent' }}
                      >
                        <td
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #1a2333',
                          }}
                        >
                          {row.rank}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #1a2333',
                          }}
                        >
                          {compositeRankMap.get(row.team_key) ?? '—'}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #1a2333',
                          }}
                          className="mono"
                        >
                          {row.team_key}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #1a2333',
                          }}
                        >
                          {row.matches_played}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #1a2333',
                          }}
                        >
                          {fmt(row._rpAverage, 2)}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #1a2333',
                            fontWeight: 900,
                          }}
                        >
                          {fmt(row._totalRp, 1)}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #1a2333',
                          }}
                        >
                          <button
                            className="button"
                            onClick={() => openTeamProfile(teamNumber)}
                            disabled={teamNumber == null}
                          >
                            TEAM_PROFILE
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Key Matches</div>
            <div className="stack-8" style={{ maxHeight: 650, overflow: 'auto' }}>
              {keyMatches.slice(0, 12).map((match) => renderKeyMatchCard(match))}
            </div>
          </div>
        </div>
        <DisclosureSection
          storageKey="ui.current.rankings.distributions"
          title="Ranking Distribution Charts"
          description="Strength, RP pace, and model disagreement views for the current event."
        >
          <div className="grid-2">
            <AnalyticsChartBlock
              title="Current Event RP Distribution"
              description="Rank-context charts stay ranking-focused: RP pace and accumulation."
              data={rankingDistributionRows}
              chartFamily="bar"
              series={[
                { key: 'totalRp', label: 'Total RP', color: '#4bb3fd' },
                { key: 'rpAverage', label: 'RP Avg', color: '#f3be3b' },
              ]}
              valueFormatter={(value) => fmt(value, 1)}
            />
            <AnalyticsChartBlock
              title="Current Event Strength Distribution"
              description="EPA, OPR, and composite in the same ranking context."
              data={strengthDistributionRows}
              chartFamily="bar"
              series={[
                { key: 'epa', label: 'EPA', color: '#ff9f68' },
                { key: 'opr', label: 'OPR', color: '#ff6b6b' },
                { key: 'comp', label: 'Composite', color: '#f3be3b' },
              ]}
              valueFormatter={(value) => fmt(value, 1)}
            />
          </div>
          <div className="grid-2">
            <AnalyticsChartBlock
              title="Current Event SOS Distribution"
              description="Ranking context for strength-of-schedule."
              data={strengthDistributionRows}
              chartFamily="bar"
              series={[{ key: 'sos', label: 'SOS', color: '#94a3b8' }]}
              valueFormatter={(value) => fmt(value, 1)}
            />
            <AnalyticsChartBlock
              title="Rank vs Composite Rank"
              description="See where the official table and the model disagree."
              data={strengthDistributionRows}
              chartFamily="line"
              series={[
                { key: 'rank', label: 'Official Rank', color: '#4bb3fd' },
                { key: 'compRank', label: 'Composite Rank', color: '#f3be3b' },
              ]}
              valueFormatter={(value) => fmt(value, 0)}
            />
          </div>
        </DisclosureSection>
      </div>
    );
  }
  function renderBracketTile(tileKey, title, match, redLabel, blueLabel, redWin, blueWin) {
    return (
      <div
        key={tileKey}
        className="panel-2"
        style={{
          width: 240,
          padding: 0,
          overflow: 'hidden',
          borderColor: '#223048',
        }}
      >
        <div
          style={{
            background: '#d9d9d9',
            color: '#111826',
            padding: '8px 10px',
            fontWeight: 900,
            fontSize: 14,
          }}
        >
          {title}
        </div>
        <div
          style={{
            background: '#ff1f2d',
            color: '#fff',
            padding: '8px 10px',
            fontWeight: 800,
          }}
        >
          {redLabel}
        </div>
        <div
          style={{
            background: '#0b6eb6',
            color: '#fff',
            padding: '8px 10px',
            fontWeight: 800,
          }}
        >
          {blueLabel}
        </div>
        <div
          style={{
            padding: '8px 10px',
            fontSize: 12,
            background: '#0f1520',
            borderTop: '1px solid #223048',
          }}
        >
          <div>
            Red {pct(redWin)} | Blue {pct(blueWin)}
          </div>
          <div style={{ marginTop: 4 }}>
            {match?.alliances?.red?.score != null && match?.alliances?.blue?.score != null
              ? `Score ${match.alliances.red.score} - ${match.alliances.blue.score}`
              : 'Score —'}
          </div>
        </div>
      </div>
    );
  }
  function renderDoubleElimBoard(blocks) {
    return (
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 1820 }}>
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>Upper Bracket</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '280px 280px 280px 280px 280px',
              gap: 28,
              alignItems: 'start',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Round 1</div>
              <div className="stack-16">
                {blocks.upperR1[0]}
                {blocks.upperR1[1]}
              </div>
              <div style={{ height: 26 }} />
              <div className="stack-16">
                {blocks.upperR1[2]}
                {blocks.upperR1[3]}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 46 }}>Round 2</div>
              <div className="stack-16">
                {blocks.upperR2[0]}
                {blocks.upperR2[1]}
              </div>
            </div>
            <div />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontWeight: 900, marginBottom: 120 }}>Upper Final</div>
              <div>{blocks.upperFinal[0]}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontWeight: 900, marginBottom: 120 }}>Finals</div>
              <div>{blocks.finals[0]}</div>
            </div>
          </div>

          <div style={{ height: 56 }} />
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>Lower Bracket</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '280px 280px 280px 280px',
              gap: 28,
              alignItems: 'start',
              marginLeft: 308,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Round 2</div>
              <div className="stack-16">
                {blocks.lowerR2[0]}
                {blocks.lowerR2[1]}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Round 3</div>
              <div className="stack-16">
                {blocks.lowerR3[0]}
                {blocks.lowerR3[1]}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontWeight: 900, marginBottom: 52 }}>Round 4</div>
              <div>{blocks.lowerR4[0]}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontWeight: 900, marginBottom: 52 }}>Round 5</div>
              <div>{blocks.lowerR5[0]}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  function renderPlayoffsTab() {
    const playoffTypeString =
      snapshot?.tba?.event?.playoff_type_string ?? 'Double Elimination Bracket (8 Alliances)';
    const elimMatches = sortedMatches.filter((m) => m.comp_level !== 'qm');
    const finals = elimMatches.filter((m) => m.comp_level === 'f');
    const sf = elimMatches.filter((m) => m.comp_level === 'sf');
    const playoffProbabilityRows = elimMatches.slice(0, 16).map((match) => {
      const pred = getSbPred(sbMatchMap.get(match?.key));
      return {
        label: formatMatchLabel(match),
        redWin: pred?.red_win_prob != null ? Number(pred.red_win_prob) : null,
        blueWin: pred?.red_win_prob != null ? 1 - Number(pred.red_win_prob) : null,
        redScore: pred?.red_score != null ? Number(pred.red_score) : null,
        blueScore: pred?.blue_score != null ? Number(pred.blue_score) : null,
      };
    });
    const sfBySet = new Map();
    sf.forEach((m) => sfBySet.set(m.set_number, m));
    const tileForSet = (setNum, label) => {
      const match = sfBySet.get(setNum);
      const pred = getSbPred(sbMatchMap.get(match?.key));
      return renderBracketTile(
        `sf_${setNum}`,
        label,
        match,
        match?.alliances?.red?.team_keys?.join(' ') || 'Red TBD',
        match?.alliances?.blue?.team_keys?.join(' ') || 'Blue TBD',
        pred?.red_win_prob ?? null,
        pred?.red_win_prob != null ? 1 - Number(pred.red_win_prob) : null,
      );
    };
    const finalTile = finals.length ? finals[0] : null;
    const predFinal = getSbPred(sbMatchMap.get(finalTile?.key));
    return (
      <div className="stack-12" style={{ marginTop: 12 }}>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Playoff Bracket</div>
          <div className="muted" style={{ marginBottom: 12 }}>
            {playoffTypeString}
          </div>
          {renderDoubleElimBoard({
            upperR1: [
              tileForSet(1, 'Match 1'),
              tileForSet(2, 'Match 2'),
              tileForSet(3, 'Match 3'),
              tileForSet(4, 'Match 4'),
            ],
            upperR2: [tileForSet(7, 'Match 7'), tileForSet(8, 'Match 8')],
            upperFinal: [tileForSet(11, 'Match 11')],
            lowerR2: [tileForSet(5, 'Match 5'), tileForSet(6, 'Match 6')],
            lowerR3: [tileForSet(9, 'Match 9'), tileForSet(10, 'Match 10')],
            lowerR4: [tileForSet(12, 'Match 12')],
            lowerR5: [tileForSet(13, 'Match 13')],
            finals: [
              renderBracketTile(
                'final_1',
                'Finals',
                finalTile,
                finalTile?.alliances?.red?.team_keys?.join(' ') || 'Red TBD',
                finalTile?.alliances?.blue?.team_keys?.join(' ') || 'Blue TBD',
                predFinal?.red_win_prob ?? null,
                predFinal?.red_win_prob != null ? 1 - Number(predFinal.red_win_prob) : null,
              ),
            ],
          })}
        </div>
        <div className="grid-2">
          <AnalyticsChartBlock
            title="Playoff Probability Board"
            description="Bracket tab stays focused on elimination win odds."
            data={playoffProbabilityRows}
            chartFamily="bar"
            series={[
              { key: 'redWin', label: 'Red Win', color: '#ff6b6b' },
              { key: 'blueWin', label: 'Blue Win', color: '#4bb3fd' },
            ]}
            valueFormatter={(value) => pct(value)}
          />
          <AnalyticsChartBlock
            title="Playoff Expected Score Board"
            description="Projected elimination scores by match."
            data={playoffProbabilityRows}
            chartFamily="line"
            series={[
              { key: 'redScore', label: 'Red Score', color: '#ff9f68' },
              { key: 'blueScore', label: 'Blue Score', color: '#2dd4bf' },
            ]}
            valueFormatter={(value) => fmt(value, 1)}
          />
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Elimination Match Table</div>
          <div style={{ overflow: 'auto', maxHeight: 420 }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Match</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Red</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Blue</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Red Win</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Blue Win</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Pred Score</th>
                </tr>
              </thead>
              <tbody>
                {elimMatches.map((match) => {
                  const pred = getSbPred(sbMatchMap.get(match?.key));
                  return (
                    <tr key={match.key}>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {formatMatchLabel(match)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                        className="mono"
                      >
                        {match?.alliances?.red?.team_keys?.join(' ') ?? '-'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                        className="mono"
                      >
                        {match?.alliances?.blue?.team_keys?.join(' ') ?? '-'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {pct(pred?.red_win_prob)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {pred?.red_win_prob != null ? pct(1 - Number(pred.red_win_prob)) : '-'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {pred?.red_score != null
                          ? `R ${fmt(pred.red_score, 0)} / B ${fmt(pred.blue_score, 0)}`
                          : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }
  function renderEventTab() {
    const eventDistributionRows = filteredEventRows.slice(0, 32).map((row) => ({
      label: `${row.teamNumber}`,
      rank: row.rank,
      epa: row.overallEpa,
      opr: row.opr,
      comp: row.composite,
      sos: row.totalSos,
      auto: row.autoEpa,
      teleop: row.teleopEpa,
      endgame: row.endgameEpa,
    }));
    const validationChartRows = [
      { label: 'Aligned', value: validationCounts.match },
      { label: 'Mismatch', value: validationCounts.mismatch },
      { label: 'Missing', value: validationCounts.missing },
      {
        label: 'Signals',
        value: liveSignals.length,
      },
      {
        label: 'Stale Sec',
        value: Number(sourceValidation?.staleSeconds ?? 0),
      },
    ];
    const opsChartRows = [
      {
        label: 'Queue Away',
        value: Math.max(0, Number(nexusSnapshot?.queueMatchesAway ?? 0)),
      },
      {
        label: 'Announce',
        value: Number(nexusSnapshot?.announcements?.length ?? 0),
      },
      {
        label: 'Parts',
        value: Number(nexusSnapshot?.partsRequests?.length ?? 0),
      },
      {
        label: 'Inspect Pending',
        value: Number(nexusSnapshot?.inspectionSummary?.pending ?? 0),
      },
      {
        label: 'Signals',
        value: liveSignals.length,
      },
    ];
    const officialRankingsCount = Array.isArray(officialSnapshot?.rankings?.Rankings)
      ? officialSnapshot.rankings.Rankings.length
      : Array.isArray(officialSnapshot?.rankings?.rankings)
        ? officialSnapshot.rankings.rankings.length
        : 0;
    const mediaEntries = Array.isArray(mediaSnapshot?.media)
      ? mediaSnapshot.media.slice(0, 12)
      : [];
    const externalToolLinks = [
      {
        label: 'TBA Event',
        href: loadedEventKey ? `https://www.thebluealliance.com/event/${loadedEventKey}` : null,
        detail: 'Working live event page',
      },
      {
        label: 'Statbotics Event',
        href: loadedEventKey ? `https://www.statbotics.io/event/${loadedEventKey}` : null,
        detail: 'EPA and predictive context',
      },
      {
        label: 'Chief Delphi Search',
        href: loadedEventKey
          ? `https://www.chiefdelphi.com/search?q=${encodeURIComponent(loadedEventKey)}`
          : null,
        detail: 'Research and event intel',
      },
      {
        label: 'AdvantageScope Docs',
        href: 'https://docs.advantagescope.org/',
        detail: 'Robot diagnostics and replay tooling',
      },
      {
        label: 'FIRST Manual + Q&A',
        href: 'https://www.firstinspires.org/resource-library/frc/competition-manual-qa-system',
        detail: 'Official rules, updates, and Q&A',
      },
      {
        label: settings.scoutingUrl ? 'Scouting Workspace' : 'Scoutradioz',
        href: settings.scoutingUrl || 'https://scoutradioz.com/',
        detail: settings.scoutingUrl
          ? 'Team-configured scouting link'
          : 'External scouting platform',
      },
    ].filter((item) => item.href);
    return (
      <div className="stack-12" style={{ marginTop: 12 }}>
        <div className="panel" style={{ padding: 16 }}>
          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              alignItems: 'flex-end',
            }}
          >
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                Search Teams
              </div>
              <input
                className="input"
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                style={{ width: 260 }}
              />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                After Qual
              </div>
              <input
                className="input"
                type="number"
                min="0"
                value={eventAfterQualInput}
                onChange={(e) => setEventAfterQualInput(e.target.value)}
                style={{ width: 120 }}
              />
            </div>
            <button
              className="button"
              onClick={() => setEventSortMode('rank')}
              style={{
                background: eventSortMode === 'rank' ? '#182336' : undefined,
              }}
            >
              Sort by Rank
            </button>
            <button
              className="button"
              onClick={() => setEventSortMode('epa')}
              style={{
                background: eventSortMode === 'epa' ? '#182336' : undefined,
              }}
            >
              Sort by EPA
            </button>
            <button
              className="button"
              onClick={() => setEventSortMode('opr')}
              style={{
                background: eventSortMode === 'opr' ? '#182336' : undefined,
              }}
            >
              Sort by OPR
            </button>
            <button
              className="button"
              onClick={() => setEventSortMode('composite')}
              style={{
                background: eventSortMode === 'composite' ? '#182336' : undefined,
              }}
            >
              Sort by Composite
            </button>
            <button className="button button-subtle" onClick={() => window.print()}>
              Print Event Summary
            </button>
          </div>
          <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            {afterQualNumber > 0
              ? `Showing event stats recomputed from completed quals at or after Q${afterQualNumber}. EPA stays as the live anchor; RP / OPR / DPR / CCWM / SOS / ranks are recomputed from that slice.`
              : 'Showing full-event stats.'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <span
              className={`badge ${sourceValidation ? sourceStatusBadgeClass(sourceValidation.firstStatus) : ''}`}
            >
              FIRST{' '}
              {sourceValidation ? sourceStatusLabel(sourceValidation.firstStatus) : 'Disabled'}
            </span>
            <span
              className={`badge ${nexusSnapshot ? sourceStatusBadgeClass(nexusSnapshot.status) : ''}`}
            >
              Nexus {nexusSnapshot ? sourceStatusLabel(nexusSnapshot.status) : 'Disabled'}
            </span>
            <span className="badge">Signals {liveSignals.length}</span>
            <span className="badge">
              Discrepancies {validationCounts.mismatch} / Missing {validationCounts.missing}
            </span>
            {nexusSnapshot?.queueText ? (
              <span className="badge">{nexusSnapshot.queueText}</span>
            ) : null}
          </div>
        </div>
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>
              {afterQualNumber > 0
                ? `All Event Teams — After Q${afterQualNumber}`
                : 'All Event Teams'}
            </div>
            <div style={{ overflow: 'auto', maxHeight: 700 }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Team</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Event Rank</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Comp Rank</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>TOTAL RP</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>
                      {afterQualNumber > 0 ? 'EPA (Live)' : 'EPA'}
                    </th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>
                      {afterQualNumber > 0 ? 'OPR (Slice)' : 'OPR'}
                    </th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>SOS</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Composite</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEventRows.map((row) => (
                    <tr
                      key={row.teamKey}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelectedTeamNumber(row.teamNumber)}
                    >
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        <span className="mono">{row.teamNumber}</span> {row.nickname}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.rank ?? '—'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.compositeRank ?? '—'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(row.totalRp, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(row.overallEpa, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(row.opr, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(row.totalSos, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(row.composite, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            className="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openTeamProfile(row.teamNumber);
                            }}
                          >
                            TEAM_PROFILE
                          </button>
                          <button
                            className="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              addTeamToCompare(row.teamNumber);
                            }}
                          >
                            COMPARE
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Team Detail Card</div>
            {!selectedTeamRow ? (
              <div className="muted">Click a team on the left.</div>
            ) : (
              <div style={{ maxHeight: 700, overflow: 'auto' }}>
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                    marginBottom: 8,
                  }}
                >
                  <button
                    className="button"
                    onClick={() => openTeamProfile(selectedTeamRow.teamNumber)}
                  >
                    Open TEAM_PROFILE
                  </button>
                  <button
                    className="button"
                    onClick={() => addTeamToCompare(selectedTeamRow.teamNumber)}
                  >
                    Add To COMPARE
                  </button>
                </div>
                {renderTeamIntelCard(
                  selectedTeamRow.teamKey,
                  `${selectedTeamRow.teamNumber} ${selectedTeamRow.nickname}`,
                )}
                <div className="panel-2" style={{ padding: 12, marginTop: 8 }}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>Schedule / Rival Intel</div>
                  <div>
                    Nearest real rivals:{' '}
                    {rivalBand
                      .slice(0, 6)
                      .map((r) => r.team_key)
                      .join(', ') || '—'}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    Next scheduled match:{' '}
                    {sortedMatches.find(
                      (m) => matchHasTeam(m, selectedTeamRow.teamKey) && !matchIsCompleted(m),
                    )?.key ?? '—'}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    Public prediction summary: strong EPA + event-local OPR + SOS snapshot.
                  </div>
                </div>
                <div className="panel-2" style={{ padding: 12, marginTop: 8 }}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>More Metrics</div>
                  <div>Played SOS: {fmt(selectedTeamRow.playedSos, 1)}</div>
                  <div>Remaining SOS: {fmt(selectedTeamRow.remainingSos, 1)}</div>
                  <div>Total SOS: {fmt(selectedTeamRow.totalSos, 1)}</div>
                  <div>Auto EPA: {fmt(selectedTeamRow.autoEpa, 1)}</div>
                  <div>Teleop EPA: {fmt(selectedTeamRow.teleopEpa, 1)}</div>
                  <div>Endgame EPA: {fmt(selectedTeamRow.endgameEpa, 1)}</div>
                  <div>Composite Rank: {selectedTeamRow.compositeRank ?? '—'}</div>
                </div>
              </div>
            )}
          </div>
        </div>
        <DisclosureSection
          storageKey="ui.current.event.distributions"
          title="Event Distribution Boards"
          description="Event-wide strength, rank, SOS, and phase context for the loaded field."
        >
          <div className="grid-2">
            <AnalyticsChartBlock
              title="Event-Wide Strength Board"
              description="Current-event team board by EPA, OPR, and composite."
              data={eventDistributionRows}
              chartFamily="bar"
              series={[
                { key: 'epa', label: 'EPA', color: '#ff9f68' },
                { key: 'opr', label: 'OPR', color: '#ff6b6b' },
                { key: 'comp', label: 'Composite', color: '#f3be3b' },
              ]}
              valueFormatter={(value) => fmt(value, 1)}
            />
            <AnalyticsChartBlock
              title="Event-Wide Rank / SOS Context"
              description="Percentile/rank context stays in EVENT rather than being pushed into every tab."
              data={eventDistributionRows}
              chartFamily="bar"
              series={[
                { key: 'rank', label: 'Rank', color: '#4bb3fd' },
                { key: 'sos', label: 'SOS', color: '#94a3b8' },
              ]}
              valueFormatter={(value) => fmt(value, 1)}
            />
          </div>
          <div className="grid-2">
            <AnalyticsChartBlock
              title="Event-Wide Phase EPA Board"
              description="Auto, teleop, and endgame EPA by team."
              data={eventDistributionRows}
              chartFamily="bar"
              series={[
                { key: 'auto', label: 'Auto', color: '#8ad17d' },
                { key: 'teleop', label: 'Teleop', color: '#2dd4bf' },
                { key: 'endgame', label: 'Endgame', color: '#c084fc' },
              ]}
              valueFormatter={(value) => fmt(value, 1)}
            />
            <AnalyticsChartBlock
              title="Event-Wide EPA vs SOS"
              description="Compare raw strength against event schedule pressure."
              data={eventDistributionRows}
              chartFamily="line"
              series={[
                { key: 'epa', label: 'EPA', color: '#ff9f68' },
                { key: 'sos', label: 'SOS', color: '#94a3b8' },
              ]}
              valueFormatter={(value) => fmt(value, 1)}
            />
          </div>
        </DisclosureSection>
        <DisclosureSection
          storageKey="ui.current.event.ops"
          title="Ops + Live Signals"
          description="Event-conditional Nexus operations, queue drift, and recent live event signals."
          defaultOpen
        >
          <div className="grid-2">
            <AnalyticsChartBlock
              title="Ops Pressure Board"
              description="Queue, announcements, parts, inspection pressure, and signal volume."
              data={opsChartRows}
              chartFamily="bar"
              series={[{ key: 'value', label: 'Count', color: '#2dd4bf' }]}
              valueFormatter={(value) => fmt(value, 0)}
            />
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Nexus Event Ops</div>
              <div className="stack-8">
                <div className="panel-2" style={{ padding: 12 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    Queue
                  </div>
                  <div style={{ fontWeight: 900 }}>
                    {nexusSnapshot?.queueText ?? 'Nexus not configured for this event'}
                  </div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    Current {nexusSnapshot?.currentMatchKey ?? '-'} | Next{' '}
                    {nexusSnapshot?.nextMatchKey ?? '-'}
                  </div>
                </div>
                <div className="grid-2">
                  <div className="panel-2" style={{ padding: 12 }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                      Announcements
                    </div>
                    <div style={{ fontWeight: 900 }}>
                      {nexusSnapshot?.announcements?.length ?? 0}
                    </div>
                  </div>
                  <div className="panel-2" style={{ padding: 12 }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                      Parts Requests
                    </div>
                    <div style={{ fontWeight: 900 }}>
                      {nexusSnapshot?.partsRequests?.length ?? 0}
                    </div>
                  </div>
                </div>
                {loadedTeamOps ? (
                  <div className="panel-2" style={{ padding: 12 }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>Loaded Team Ops</div>
                    <div style={{ fontWeight: 900 }}>
                      {loadedTeamOps.queueState ?? 'No loaded-team queue context'}
                    </div>
                    <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                      Pit {loadedTeamOps.pitAddress ?? '-'} | Inspection{' '}
                      {loadedTeamOps.inspectionStatus ?? '-'} | Bumper{' '}
                      {loadedTeamOps.bumperColor ?? '-'}
                    </div>
                    <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                      Queue {formatOpsTime(loadedTeamOps.estimatedQueueTimeMs)} | On Deck{' '}
                      {formatOpsTime(loadedTeamOps.estimatedOnDeckTimeMs)}
                    </div>
                  </div>
                ) : null}
                <div className="panel-2" style={{ padding: 12 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Recent Signals</div>
                  <div className="stack-8" style={{ maxHeight: 280, overflow: 'auto' }}>
                    {recentLiveSignals.map((signal) => (
                      <div key={signal.id} className="panel-2" style={{ padding: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ fontWeight: 700 }}>{signal.title}</div>
                          <span className="badge dashboard-inline-chip">{signal.source}</span>
                        </div>
                        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                          {signal.body || signal.signalType}
                        </div>
                        <div className="mono muted" style={{ marginTop: 6, fontSize: 11 }}>
                          {formatLocalizedDateTime(signal.createdAtMs, language, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                    ))}
                    {!recentLiveSignals.length ? (
                      <div className="muted">No live signals captured for this event yet.</div>
                    ) : null}
                  </div>
                </div>
                {nexusSnapshot?.pitMapUrl ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <a
                      className="button"
                      href={nexusSnapshot.pitMapUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Pit Map
                    </a>
                    <span className="badge">
                      Pits {sourceStatusLabel(nexusSnapshot?.pitsStatus ?? 'unsupported')}
                    </span>
                    <span className="badge">
                      Inspection{' '}
                      {sourceStatusLabel(nexusSnapshot?.inspectionStatus ?? 'unsupported')}
                    </span>
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Pit map {sourceStatusLabel(nexusSnapshot?.pitMapStatus ?? 'unsupported')}.
                    Optional Nexus map data is not available for this event.
                  </div>
                )}
              </div>
            </div>
          </div>
          {pitAddressRows.length || inspectionRows.length ? (
            <div className="grid-2" style={{ marginTop: 12 }}>
              <div className="panel" style={{ padding: 16 }}>
                <div style={{ fontWeight: 900, marginBottom: 10 }}>Pit Addresses</div>
                {pitAddressRows.length ? (
                  <div style={{ overflow: 'auto', maxHeight: 320 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ textAlign: 'left' }}>
                          <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Team</th>
                          <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Pit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pitAddressRows.map((row) => (
                          <tr key={`pit-${row.teamNumber}`}>
                            <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                              {row.teamNumber} {row.teamNumber === loadedTeam ? '(Loaded)' : ''}
                            </td>
                            <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                              {row.pitAddress}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="muted">
                    Pit addresses {sourceStatusLabel(nexusSnapshot?.pitsStatus ?? 'unsupported')}.
                  </div>
                )}
              </div>
              <div className="panel" style={{ padding: 16 }}>
                <div style={{ fontWeight: 900, marginBottom: 10 }}>Inspection Board</div>
                {inspectionRows.length ? (
                  <div style={{ overflow: 'auto', maxHeight: 320 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ textAlign: 'left' }}>
                          <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Team</th>
                          <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inspectionRows.map((row) => (
                          <tr key={`inspection-${row.teamNumber}`}>
                            <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                              {row.teamNumber} {row.teamNumber === loadedTeam ? '(Loaded)' : ''}
                            </td>
                            <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                              {row.status}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="muted">
                    Inspection data{' '}
                    {sourceStatusLabel(nexusSnapshot?.inspectionStatus ?? 'unsupported')}.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DisclosureSection>
        <DisclosureSection
          storageKey="ui.current.event.validation"
          title="Official Validation"
          description="FIRST official overlap checks, source freshness, and visible discrepancy review."
          badge={
            <span className="badge">
              {sourceValidation?.summary ?? 'No official validation yet'}
            </span>
          }
          defaultOpen
        >
          <div className="grid-2">
            <AnalyticsChartBlock
              title="Validation Coverage"
              description="At-a-glance count of aligned, mismatched, and missing source checks."
              data={validationChartRows}
              chartFamily="bar"
              series={[{ key: 'value', label: 'Count', color: '#38bdf8' }]}
              valueFormatter={(value) => fmt(value, 0)}
            />
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Source Comparison</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <span
                  className={`badge ${sourceValidation ? sourceStatusBadgeClass(sourceValidation.firstStatus) : ''}`}
                >
                  FIRST{' '}
                  {sourceValidation ? sourceStatusLabel(sourceValidation.firstStatus) : 'Disabled'}
                </span>
                <span
                  className={`badge ${nexusSnapshot ? sourceStatusBadgeClass(nexusSnapshot.status) : ''}`}
                >
                  Nexus {nexusSnapshot ? sourceStatusLabel(nexusSnapshot.status) : 'Disabled'}
                </span>
                <span className="badge">
                  Official{' '}
                  {sourceValidation?.officialAvailability
                    ? sourceValidation.officialAvailability
                    : 'unavailable'}
                </span>
                <span className="badge">Official rankings {officialRankingsCount}</span>
                <span className="badge">
                  Official matches {sourceValidation?.officialCounts?.matches ?? 0}
                </span>
                <span className="badge">
                  Official awards {sourceValidation?.officialCounts?.awards ?? 0}
                </span>
                <span className="badge">
                  Stale{' '}
                  {sourceValidation?.staleSeconds != null
                    ? `${sourceValidation.staleSeconds}s`
                    : '-'}
                </span>
              </div>
              <div style={{ overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ textAlign: 'left' }}>
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Check</th>
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Status</th>
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Working</th>
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Official</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sourceValidation?.discrepancies ?? []).map((item) => (
                      <tr key={item.key}>
                        <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                          <div style={{ fontWeight: 700 }}>{item.label}</div>
                          {item.detail ? (
                            <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>
                              {item.detail}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                          <span
                            className={`badge ${
                              item.status === 'mismatch'
                                ? 'badge-red'
                                : item.status === 'match'
                                  ? 'badge-green'
                                  : ''
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                          {item.workingValue ?? '-'}
                        </td>
                        <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                          {item.officialValue ?? '-'}
                        </td>
                      </tr>
                    ))}
                    {!sourceValidation?.discrepancies?.length ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="muted"
                          style={{ padding: 8, borderBottom: '1px solid #1a2333' }}
                        >
                          No official comparison rows available yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </DisclosureSection>
        <DisclosureSection
          storageKey="ui.current.event.media"
          title="Webcast + Media"
          description="NOW-hosted webcast access plus surfaced event media from TBA."
          defaultOpen
        >
          <div className="grid-2">
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Preferred Webcast</div>
              {preferredWebcast?.url ? (
                <div className="stack-8">
                  <div className="muted">
                    The full in-app webcast player lives in NOW. If it is actively playing and you
                    leave NOW, the desk keeps it visible here as a floating mini-player.
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <a
                      className="button button-primary"
                      href={preferredWebcast.url ?? preferredWebcast.embedUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Webcast
                    </a>
                    <span className="badge">{preferredWebcast.type}</span>
                    {showFloatingWebcast ? (
                      <span className="badge badge-green">Mini-player active</span>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="muted">No webcast surfaced for the loaded event.</div>
              )}
            </div>
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Media Feed</div>
              <div className="stack-8" style={{ maxHeight: 420, overflow: 'auto' }}>
                {mediaEntries.map((item, index) => {
                  const label =
                    String(item?.type ?? item?.media_type ?? 'Media') +
                    (item?.foreign_key ? ` | ${String(item.foreign_key)}` : '');
                  const href =
                    (typeof item?.direct_url === 'string' && item.direct_url) ||
                    (typeof item?.view_url === 'string' && item.view_url) ||
                    (typeof item?.details === 'string' && /^https?:\/\//i.test(item.details)
                      ? item.details
                      : null);
                  return (
                    <div key={`${label}_${index}`} className="panel-2" style={{ padding: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ fontWeight: 700 }}>{label}</div>
                        {item?.preferred ? <span className="badge">Preferred</span> : null}
                      </div>
                      {item?.details ? (
                        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                          {String(item.details)}
                        </div>
                      ) : null}
                      {href ? (
                        <div style={{ marginTop: 8 }}>
                          <a className="button" href={href} target="_blank" rel="noreferrer">
                            Open Media
                          </a>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {!mediaEntries.length ? (
                  <div className="muted">No additional event media surfaced by TBA yet.</div>
                ) : null}
              </div>
            </div>
          </div>
        </DisclosureSection>
        <DisclosureSection
          storageKey="ui.current.event.external_tools"
          title="External Tools"
          description="Curated companion tools and official references that help the desk without replacing native analytics."
        >
          <div className="panel" style={{ padding: 16 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12,
              }}
            >
              {externalToolLinks.map((item) => (
                <a
                  key={item.label}
                  className="panel-2"
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  style={{ padding: 14, textDecoration: 'none', color: 'inherit' }}
                >
                  <div style={{ fontWeight: 800 }}>{item.label}</div>
                  <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                    {item.detail}
                  </div>
                </a>
              ))}
            </div>
          </div>
        </DisclosureSection>
      </div>
    );
  }
  function _renderPreEventTab() {
    return (
      <div className="stack-12" style={{ marginTop: 12 }}>
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Likely Captains</div>
            <div className="stack-8">
              {likelyCaptains.map((row, idx) => (
                <div key={row.teamKey} className="panel-2" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 900 }}>
                    #{idx + 1} {row.teamNumber} {row.nickname}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Real Rank {row.rank ?? '—'} | EPA {fmt(row.overallEpa, 1)} | OPR{' '}
                    {fmt(row.opr, 1)} | Composite {fmt(row.composite, 1)}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Our Schedule + Threats</div>
            <div className="panel-2" style={{ padding: 12 }}>
              <div>
                Our upcoming quals:{' '}
                {ourUpcomingMatches
                  .filter((m) => m.comp_level === 'qm')
                  .slice(0, 6)
                  .map((m) => formatMatchLabel(m))
                  .join(', ') || '—'}
              </div>
              <div style={{ marginTop: 6 }}>
                Top threats by EPA:{' '}
                {topByEpa
                  .slice(0, 8)
                  .map((r) => r.teamNumber)
                  .join(', ')}
              </div>
              <div style={{ marginTop: 6 }}>
                Top threats by OPR:{' '}
                {topByOpr
                  .slice(0, 8)
                  .map((r) => r.teamNumber)
                  .join(', ')}
              </div>
              <div style={{ marginTop: 6 }}>
                Top threats by Composite:{' '}
                {topByComposite
                  .slice(0, 8)
                  .map((r) => r.teamNumber)
                  .join(', ')}
              </div>
            </div>
          </div>
        </div>
        <div className="grid-3">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Strongest EPA Teams</div>
            <div className="stack-8">
              {topByEpa.map((row, idx) => (
                <div key={row.teamKey} className="panel-2" style={{ padding: 8 }}>
                  {idx + 1}. {row.teamNumber} {row.nickname} — EPA {fmt(row.overallEpa, 1)}
                </div>
              ))}
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Strongest OPR Teams</div>
            <div className="stack-8">
              {topByOpr.map((row, idx) => (
                <div key={row.teamKey} className="panel-2" style={{ padding: 8 }}>
                  {idx + 1}. {row.teamNumber} {row.nickname} — OPR {fmt(row.opr, 1)}
                </div>
              ))}
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Strongest Composite Teams</div>
            <div className="stack-8">
              {topByComposite.map((row, idx) => (
                <div key={row.teamKey} className="panel-2" style={{ padding: 8 }}>
                  {idx + 1}. {row.teamNumber} {row.nickname} — Comp {fmt(row.composite, 1)}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Key Matches Watchlist</div>
          <div className="stack-8" style={{ maxHeight: 500, overflow: 'auto' }}>
            {keyMatches.slice(0, 10).map((match) => renderKeyMatchCard(match))}
          </div>
        </div>
      </div>
    );
  }
  function renderPreEventScoutingTab(mode = 'pre_event') {
    return (
      <PreEventTab
        loadedEventKey={loadedEventKey}
        loadedTeam={loadedTeam}
        eventTeamRows={eventTeamRows}
        ourUpcomingMatches={ourUpcomingMatches}
        keyMatches={keyMatches}
        renderKeyMatchCard={renderKeyMatchCard}
        onOpenTeamProfile={openTeamProfile}
        onAddToCompare={addTeamToCompare}
        mode={mode}
      />
    );
  }
  function renderPredictTab() {
    const predictComparisonRows = projectedRows.slice(0, 24).map((row) => {
      const det = deterministicRows.find((item) => item.teamKey === row.teamKey);
      const mc = (monteCarloProjection.rows ?? []).find((item) => item.teamKey === row.teamKey);
      return {
        label: `${row.teamNumber}`,
        projectedRank: row.projectedRank,
        deterministicRank: det?.deterministicRank ?? null,
        mcAvgRank: mc?.mcAvgRank ?? null,
        mcTop1: mc?.mcTop1 ?? null,
        mcTop4: mc?.mcTop4 ?? null,
        mcTop8: mc?.mcTop8 ?? null,
      };
    });
    return (
      <div className="stack-12" style={{ marginTop: 12 }}>
        <div className="panel" style={{ padding: 16 }}>
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <button
              className="button"
              onClick={() => setPredictFilter('future')}
              style={{
                background: predictFilter === 'future' ? '#182336' : undefined,
              }}
            >
              Future Quals
            </button>
            <button
              className="button"
              onClick={() => setPredictFilter('all')}
              style={{
                background: predictFilter === 'all' ? '#182336' : undefined,
              }}
            >
              All Quals
            </button>
            <button
              className="button"
              onClick={() => setPredictFilter('our')}
              style={{
                background: predictFilter === 'our' ? '#182336' : undefined,
              }}
            >
              Our Matches
            </button>
            <button
              className="button"
              onClick={() => setPredictFilter('playoffs')}
              style={{
                background: predictFilter === 'playoffs' ? '#182336' : undefined,
              }}
            >
              Playoffs
            </button>
            <button className="button" onClick={saveCurrentFullScenario}>
              Save Current Full Scenario
            </button>
            <button
              className="button"
              onClick={() => setPredictOverrides(JSON.parse(JSON.stringify(predictBaseMap)))}
            >
              Reset All To Live
            </button>
            <button
              className="button"
              onClick={recomputeMonteCarloProjection}
              style={{ background: mcProjectionDirty ? '#3d2020' : undefined }}
            >
              Recompute Monte Carlo
              {mcProjectionDirty ? ' (new match update)' : ''}
            </button>
            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span className="muted" style={{ fontSize: 12 }}>
                Monte Carlo runs
              </span>
              <select
                className="input"
                value={simRuns}
                onChange={(e) => setSimRuns(Number(e.target.value))}
              >
                <option value={250}>250</option>
                <option value={500}>500</option>
                <option value={1000}>1000</option>
                <option value={2500}>2500</option>
                <option value={5000}>5000</option>
              </select>
            </div>
          </div>
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Manual Match Inputs</div>
          <div style={{ overflow: 'auto', maxHeight: 420 }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Match</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Red Alliance</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Blue Alliance</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Red RP</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Blue RP</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Live RP</th>
                </tr>
              </thead>
              <tbody>
                {predictMatchRows.map((match) => {
                  const override = predictOverrides[match.key] ?? {
                    redRp: null,
                    blueRp: null,
                  };
                  const base = predictBaseMap[match.key] ?? {
                    redRp: null,
                    blueRp: null,
                  };
                  return (
                    <tr key={match.key}>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {formatMatchLabel(match)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                        className="mono"
                      >
                        {match.alliances.red.team_keys.join(' ')}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                        className="mono"
                      >
                        {match.alliances.blue.team_keys.join(' ')}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        <input
                          className="input"
                          type="number"
                          value={override.redRp ?? ''}
                          onChange={(e) =>
                            setPredictOverrides((prev) => ({
                              ...prev,
                              [match.key]: {
                                redRp: e.target.value === '' ? null : Number(e.target.value),
                                blueRp: prev[match.key]?.blueRp ?? override.blueRp,
                              },
                            }))
                          }
                          style={{ width: 80 }}
                        />
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        <input
                          className="input"
                          type="number"
                          value={override.blueRp ?? ''}
                          onChange={(e) =>
                            setPredictOverrides((prev) => ({
                              ...prev,
                              [match.key]: {
                                redRp: prev[match.key]?.redRp ?? override.redRp,
                                blueRp: e.target.value === '' ? null : Number(e.target.value),
                              },
                            }))
                          }
                          style={{ width: 80 }}
                        />
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        Red {base.redRp ?? '—'} | Blue {base.blueRp ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Manual Scenario Result</div>
            <div className="panel-2" style={{ padding: 12, marginBottom: 10 }}>
              <div>Our projected seed: {ourProjected?.projectedRank ?? '—'}</div>
              <div>Our projected total RP: {fmt(ourProjected?.projectedTotalRp, 1)}</div>
            </div>
            <div style={{ overflow: 'auto', maxHeight: 400 }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Proj Rank</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Team</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Proj Total RP</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Real Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {projectedRows.slice(0, 16).map((row) => (
                    <tr key={row.teamKey}>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.projectedRank}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.teamNumber} {row.nickname}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(row.projectedTotalRp, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.rank ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Monte Carlo Projection</div>
            <div className="panel-2" style={{ padding: 12, marginBottom: 10 }}>
              <div>Our avg final seed: {fmt(monteCarloProjection.ourAvgSeed, 2)}</div>
              <div>Our most likely seed: {monteCarloProjection.ourMostLikelySeed ?? '—'}</div>
              <div>
                Top-1 {pct(monteCarloProjection.ourTop1)} | Top-4{' '}
                {pct(monteCarloProjection.ourTop4)} | Top-8 {pct(monteCarloProjection.ourTop8)}
              </div>
              <div>Likely finish band: {monteCarloProjection.ourLikelyBand}</div>
              <div>
                Observed highest/lowest: {monteCarloProjection.ourObservedHighest ?? '—'} /{' '}
                {monteCarloProjection.ourObservedLowest ?? '—'}
              </div>
              <div>
                Theoretical highest/lowest: {monteCarloProjection.ourTheoreticalHighest ?? '—'} /{' '}
                {monteCarloProjection.ourTheoreticalLowest ?? '—'}
              </div>
            </div>
            <div style={{ overflow: 'auto', maxHeight: 320 }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>MC Rank</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Team</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Avg Rank</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Top1/4/8</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Likely Band</th>
                  </tr>
                </thead>
                <tbody>
                  {monteCarloProjection.rows.slice(0, 16).map((row, idx) => (
                    <tr key={row.teamKey}>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {idx + 1}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.teamNumber} {row.nickname}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(row.mcAvgRank, 2)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {pct(row.mcTop1)} / {pct(row.mcTop4)} / {pct(row.mcTop8)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.mcLikelyBand}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Deterministic Expected Result</div>
            <div className="muted" style={{ marginBottom: 8 }}>
              Uses expected RP from prediction averages for remaining matches.
            </div>
            <div style={{ overflow: 'auto', maxHeight: 300 }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Det Rank</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Team</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Det Total RP</th>
                  </tr>
                </thead>
                <tbody>
                  {deterministicRows.slice(0, 16).map((row) => (
                    <tr key={row.teamKey}>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.deterministicRank}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.teamNumber} {row.nickname}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(row.deterministicTotalRp, 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>
              {`Top 25 Monte Carlo Top-${MONTE_CARLO_SCENARIO_DEPTH} Scenarios`}
            </div>
            <div className="muted" style={{ marginBottom: 8 }}>
              {`Unique = exact ordered top ${MONTE_CARLO_SCENARIO_DEPTH}. Use these in ALLIANCE.`}
            </div>
            <div className="muted" style={{ marginBottom: 8 }}>
              {`Current event space: ${formatBigInt(monteCarloScenarioSpace.orderedCount)} ordered top-${monteCarloScenarioSpace.depth} configurations (${formatBigInt(monteCarloScenarioSpace.unorderedCount)} unordered membership sets).`}
            </div>
            <div className="muted" style={{ marginBottom: 8 }}>
              {`This run observed ${formatBigInt(BigInt(monteCarloProjection.uniqueScenarioCount ?? 0))} unique top-${MONTE_CARLO_SCENARIO_DEPTH} scenarios across ${simRuns.toLocaleString()} simulations.`}
            </div>
            <div style={{ overflow: 'auto', maxHeight: 300 }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Use</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Prob</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Count</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {(monteCarloProjection.top16Scenarios ?? []).map((s) => (
                    <tr key={s.id}>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        <button
                          className="button"
                          onClick={() => {
                            setAllianceSourceType('predict');
                            setAllianceSourceId('__current_mc__');
                            setPredictScenarioMode('montecarlo');
                            setMcScenarioSelection(s.id);
                            setAllianceLiveLocked(false);
                            setTab('ALLIANCE');
                          }}
                        >
                          Use
                        </button>
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {pctPrecise(s.probability)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {s.count}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                        className="mono"
                      >
                        {s.teams.slice(0, 8).join(' ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="grid-2">
          <AnalyticsChartBlock
            title="Projection Distribution: Manual / Deterministic"
            description="Contextual prediction charts stay focused on ranking outcomes."
            data={projectedRows.slice(0, 24).map((row) => ({
              label: `${row.teamNumber}`,
              projected: row.projectedTotalRp,
              deterministic:
                deterministicRows.find((item) => item.teamKey === row.teamKey)
                  ?.deterministicTotalRp ?? null,
            }))}
            chartFamily="bar"
            series={[
              { key: 'projected', label: 'Manual', color: '#4bb3fd' },
              {
                key: 'deterministic',
                label: 'Deterministic',
                color: '#ff9f68',
              },
            ]}
            valueFormatter={(value) => fmt(value, 1)}
          />
          <AnalyticsChartBlock
            title="Projection Distribution: Monte Carlo"
            description="Average seed and high-finish probabilities."
            data={(monteCarloProjection.rows ?? []).slice(0, 24).map((row) => ({
              label: `${row.teamNumber}`,
              avgRank: row.mcAvgRank,
              top4: row.mcTop4,
              top8: row.mcTop8,
            }))}
            chartFamily="bar"
            series={[
              { key: 'avgRank', label: 'Avg Rank', color: '#f3be3b' },
              { key: 'top4', label: 'Top4', color: '#2dd4bf' },
              { key: 'top8', label: 'Top8', color: '#c084fc' },
            ]}
            valueFormatter={(value, name) => (name === 'Avg Rank' ? fmt(value, 2) : pct(value))}
          />
        </div>
        <div className="grid-2">
          <AnalyticsChartBlock
            title="Projection Rank Model Comparison"
            description="Manual, deterministic, and Monte Carlo rank views together."
            data={predictComparisonRows}
            chartFamily="line"
            series={[
              { key: 'projectedRank', label: 'Manual Rank', color: '#4bb3fd' },
              { key: 'deterministicRank', label: 'Det Rank', color: '#f97316' },
              { key: 'mcAvgRank', label: 'MC Avg Rank', color: '#ff9f68' },
            ]}
            valueFormatter={(value) => fmt(value, 2)}
          />
          <AnalyticsChartBlock
            title="Monte Carlo Finish Bands"
            description="Top seed, top-4, and top-8 probabilities by team."
            data={predictComparisonRows}
            chartFamily="bar"
            series={[
              { key: 'mcTop1', label: 'Top1', color: '#f3be3b' },
              { key: 'mcTop4', label: 'Top4', color: '#2dd4bf' },
              { key: 'mcTop8', label: 'Top8', color: '#c084fc' },
            ]}
            valueFormatter={(value) => pct(value)}
          />
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Saved Predict Scenarios</div>
          <div className="stack-8">
            {savedPredictScenarios.map((scenario) => (
              <div key={scenario.id} className="panel-2" style={{ padding: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <div>
                    <strong>{scenario.name}</strong> —{' '}
                    {new Date(scenario.createdAt).toLocaleString()}
                  </div>
                  <button
                    className="button"
                    onClick={() => setSelectedPredictScenarioId(scenario.id)}
                  >
                    Use
                  </button>
                </div>
              </div>
            ))}
            {!savedPredictScenarios.length ? (
              <div className="muted">No saved scenarios yet.</div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
  function renderAllianceTab() {
    const allianceCaptainRows = (allianceRuntime?.captainSlots ?? []).map((slot) => {
      const rows = [slot.captain, ...slot.picks]
        .map((teamKey) => eventRowMap.get(teamKey))
        .filter(Boolean);
      return {
        label: `A${slot.seed}`,
        epa: averageNullable(rows.map((row) => row?.overallEpa ?? null)),
        opr: averageNullable(rows.map((row) => row?.opr ?? null)),
        comp: averageNullable(rows.map((row) => row?.composite ?? null)),
        picks: slot.picks.length,
      };
    });
    const allianceAvailabilityRows = allianceAvailableRows.slice(0, 24).map((row) => ({
      label: `${row.teamNumber ?? teamNumberFromKey(row.teamKey) ?? row.teamKey}`,
      rank: row.realRank ?? row.simRank ?? null,
      epa: row.overallEpa ?? null,
      opr: row.opr ?? null,
      comp: row.composite ?? null,
      sos: row.totalSos ?? null,
      pick: row.pickValueScore ?? null,
      deny: row.denialValueScore ?? null,
      fit: row.chemistryScore ?? null,
      ready: row.playoffReadyScore ?? null,
      ceiling: row.ceilingScore ?? null,
      stable: row.stabilityScore ?? null,
    }));
    const allianceStrengthVsRankRows = allianceAvailableRows.slice(0, 24).map((row) => ({
      label: `${row.teamNumber ?? teamNumberFromKey(row.teamKey) ?? row.teamKey}`,
      rank: row.realRank ?? row.simRank ?? null,
      epa: row.overallEpa ?? null,
      opr: row.opr ?? null,
      comp: row.composite ?? null,
      pick: row.pickValueScore ?? null,
      fit: row.chemistryScore ?? null,
      ready: row.playoffReadyScore ?? null,
      ceiling: row.ceilingScore ?? null,
    }));
    return (
      <div className="stack-12" style={{ marginTop: 12 }}>
        <div className="panel" style={{ padding: 16 }}>
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <select
              className="input"
              value={allianceSourceType}
              onChange={(e) => {
                setAllianceSourceType(e.target.value);
                setAllianceLiveLocked(false);
              }}
            >
              <option value="live">Live Current Order</option>
              <option value="predict">Saved Predict Scenario</option>
              <option value="savedAlliance">Saved Alliance Scenario</option>
            </select>
            {allianceSourceType === 'predict' ? (
              <>
                <select
                  className="input"
                  value={allianceSourceId}
                  onChange={(e) => {
                    setAllianceSourceId(e.target.value);
                    setAllianceLiveLocked(false);
                  }}
                >
                  <option value="">Choose predict scenario</option>
                  {savedPredictScenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={predictScenarioMode}
                  onChange={(e) => setPredictScenarioMode(e.target.value)}
                >
                  <option value="manual">Manual</option>
                  <option value="deterministic">Deterministic</option>
                  <option value="montecarlo">Monte Carlo</option>
                </select>
                {predictScenarioMode === 'montecarlo' ? (
                  <select
                    className="input"
                    value={mcScenarioSelection}
                    onChange={(e) => setMcScenarioSelection(e.target.value)}
                  >
                    <option value="most_likely">
                      {`Most likely top ${MONTE_CARLO_SCENARIO_DEPTH}`}
                    </option>
                    {(chosenPredictScenario?.top16Scenarios ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {pctPrecise(s.probability)} ({s.count}) — {s.teams.slice(0, 8).join(' / ')}
                      </option>
                    ))}
                  </select>
                ) : null}
              </>
            ) : null}
            {allianceSourceType === 'savedAlliance' ? (
              <select
                className="input"
                value={allianceSourceId}
                onChange={(e) => {
                  setAllianceSourceId(e.target.value);
                  setAllianceLiveLocked(false);
                }}
              >
                <option value="">Choose alliance scenario</option>
                {savedAllianceScenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              className="input"
              value={allianceSortMode}
              onChange={(e) => setAllianceSortMode(e.target.value)}
            >
              <option value="composite">Sort: Composite</option>
              <option value="epa">Sort: EPA</option>
              <option value="opr">Sort: OPR</option>
              <option value="rank">Sort: Real Rank</option>
              <option value="pickValue">Sort: Pick Value</option>
              <option value="chemistry">Sort: Chemistry</option>
              <option value="denialValue">Sort: Denial Value</option>
              <option value="playoffReady">Sort: Playoff Ready</option>
              <option value="ceiling">Sort: Ceiling</option>
              <option value="stability">Sort: Stability</option>
            </select>
            <button className="button" onClick={saveAllianceScenario}>
              Save Alliance Scenario
            </button>
            <button className="button" onClick={resetAllianceRuntimeUnlock}>
              {allianceLiveLocked ? 'Reset / Unlock Live Sync' : 'Reset'}
            </button>
            {allianceLiveLocked ? (
              <span className="badge badge-red">Live sync locked</span>
            ) : (
              <span className="badge">Live sync active</span>
            )}
          </div>
        </div>
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Current Alliance Selection</div>
            <div className="muted" style={{ marginBottom: 8 }}>
              Round {allianceRuntime?.round ?? 1}. Current captain slot:{' '}
              {allianceCurrentCaptain?.seed ?? '—'} ({allianceCurrentCaptain?.captain ?? '—'})
            </div>
            <div className="stack-8">
              {(allianceRuntime?.captainSlots ?? []).map((slot) => (
                <div
                  key={`seed_${slot.seed}_${slot.captain}`}
                  className="panel-2"
                  style={{ padding: 10 }}
                >
                  <div style={{ fontWeight: 900 }}>Alliance {slot.seed}</div>
                  <div className="mono" style={{ marginTop: 6 }}>
                    {[slot.captain, ...slot.picks].join(' | ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Pick Simulator</div>
            <div className="panel-2" style={{ padding: 12, marginBottom: 10 }}>
              <div>Current captain: {allianceCurrentCaptain?.captain ?? '—'}</div>
              <div style={{ marginTop: 8 }}>
                <select
                  className="input"
                  value={alliancePickTarget}
                  onChange={(e) => setAlliancePickTarget(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="">Choose invite target</option>
                  {allianceAvailableRows.map((row) => (
                    <option key={row.teamKey} value={row.teamKey}>
                      {row.teamKey} | Real Rank {row.realRank ?? '—'} | EPA {fmt(row.overallEpa, 1)}{' '}
                      | Pick {fmt(row.pickValueScore, 0)} | Fit {fmt(row.chemistryScore, 0)} | Deny{' '}
                      {fmt(row.denialValueScore, 0)} | Ready {fmt(row.playoffReadyScore, 0)} |
                      Ceiling {fmt(row.ceilingScore, 0)}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  className="button"
                  onClick={handleAllianceAccept}
                  disabled={!alliancePickTarget || !!allianceRuntime?.complete}
                >
                  Accept
                </button>
                <button
                  className="button"
                  onClick={handleAllianceDecline}
                  disabled={!alliancePickTarget || !!allianceRuntime?.complete}
                >
                  Decline
                </button>
                <button
                  className="button"
                  onClick={() => {
                    setAllianceLiveLocked(false);
                    const sourceRows = allianceSourceRows.length
                      ? allianceSourceRows
                      : top8LiveOrScenario;
                    setAllianceRuntime(freshAllianceStateFromSource(sourceRows));
                    setAlliancePickTarget('');
                  }}
                >
                  Reset / Unlock Live Sync
                </button>
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 10,
                marginBottom: 10,
              }}
            >
              {allianceRecommendationRows.map((item) => (
                <div key={item.label} className="panel-2" style={{ padding: 10 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {item.label}
                  </div>
                  <div style={{ fontWeight: 900, marginTop: 6 }}>
                    {item.row?.teamNumber ?? teamNumberFromKey(item.row?.teamKey ?? '') ?? '—'}{' '}
                    {item.row?.nickname ?? item.row?.teamKey ?? ''}
                  </div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    {item.key === 'pickValueScore'
                      ? `Pick ${fmt(item.row?.pickValueScore, 0)} | Ready ${fmt(item.row?.playoffReadyScore, 0)}`
                      : item.key === 'chemistryScore'
                        ? `Fit ${fmt(item.row?.chemistryScore, 0)} | Weakness ${item.row?.weakestArea ?? '—'}`
                        : item.key === 'denialValueScore'
                          ? `Deny ${fmt(item.row?.denialValueScore, 0)} | Rival ${item.row?.rivalCaptain ?? '—'}`
                          : item.key === 'playoffReadyScore'
                            ? `Ready ${fmt(item.row?.playoffReadyScore, 0)} | Stable ${fmt(item.row?.stabilityScore, 0)}`
                            : `Ceiling ${fmt(item.row?.ceilingScore, 0)} | ${item.row?.bestUseCase ?? '—'}`}
                  </div>
                </div>
              ))}
            </div>
            <div className="stack-8" style={{ maxHeight: 400, overflow: 'auto' }}>
              {allianceAvailableRows.map((row) => (
                <div key={row.teamKey} className="panel-2" style={{ padding: 10 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div className="mono">{row.teamKey}</div>
                    <div>Real Rank {row.realRank ?? row.simRank ?? '—'}</div>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    EPA {fmt(row.overallEpa, 1)} | OPR {fmt(row.opr, 1)} | Composite{' '}
                    {fmt(row.composite, 1)} | SOS {fmt(row.totalSos, 1)}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Pick {fmt(row.pickValueScore, 0)} | Fit {fmt(row.chemistryScore, 0)} | Deny{' '}
                    {fmt(row.denialValueScore, 0)} | Ready {fmt(row.playoffReadyScore, 0)} | Ceiling{' '}
                    {fmt(row.ceilingScore, 0)} | Stable {fmt(row.stabilityScore, 0)}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {row.recommendation} | {row.bestUseCase} | {row.recommendationReason}
                    {row.rivalCaptain ? ` vs ${row.rivalCaptain}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Saved Alliance Scenarios</div>
          <div className="stack-8">
            {savedAllianceScenarios.map((scenario) => (
              <div key={scenario.id} className="panel-2" style={{ padding: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <div>
                    <strong>{scenario.name}</strong> —{' '}
                    {new Date(scenario.createdAt).toLocaleString()}
                  </div>
                  <div className="muted">{scenario.sourceType}</div>
                </div>
              </div>
            ))}
            {!savedAllianceScenarios.length ? (
              <div className="muted">No saved alliance scenarios yet.</div>
            ) : null}
          </div>
        </div>
        <div className="grid-2">
          <AnalyticsChartBlock
            title="Alliance Captains: Board Strength"
            description="Alliance-selection charts stay centered on captains and formed alliances."
            data={allianceCaptainRows}
            chartFamily="bar"
            series={[
              { key: 'epa', label: 'Avg EPA', color: '#ff9f68' },
              { key: 'opr', label: 'Avg OPR', color: '#ff6b6b' },
              { key: 'comp', label: 'Avg Composite', color: '#f3be3b' },
            ]}
            valueFormatter={(value) => fmt(value, 1)}
          />
          <AnalyticsChartBlock
            title="Alliance Availability Pool"
            description="Available-team board with public-data pick, fit, playoff-readiness, and denial heuristics."
            data={allianceAvailabilityRows}
            chartFamily="bar"
            series={[
              { key: 'pick', label: 'Pick', color: '#4bb3fd' },
              { key: 'fit', label: 'Fit', color: '#2dd4bf' },
              { key: 'ready', label: 'Ready', color: '#c084fc' },
              { key: 'deny', label: 'Deny', color: '#f97316' },
            ]}
            valueFormatter={(value) => fmt(value, 1)}
          />
        </div>
        <div className="grid-2">
          <AnalyticsChartBlock
            title="Alliance Availability: Rank vs Strength"
            description="Live captain board plus how public-data recommendation scores line up with seed order."
            data={allianceStrengthVsRankRows}
            chartFamily="line"
            series={[
              { key: 'rank', label: 'Rank', color: '#f3be3b' },
              { key: 'epa', label: 'EPA', color: '#4bb3fd' },
              { key: 'pick', label: 'Pick', color: '#ff6b6b' },
              { key: 'ready', label: 'Ready', color: '#2dd4bf' },
              { key: 'ceiling', label: 'Ceiling', color: '#c084fc' },
            ]}
            valueFormatter={(value) => fmt(value, 1)}
          />
          <AnalyticsChartBlock
            title="Alliance Pick Depth"
            description="How formed alliances compare by strength and how deep they already are."
            data={allianceCaptainRows}
            chartFamily="bar"
            series={[
              { key: 'picks', label: 'Picks', color: '#94a3b8' },
              { key: 'epa', label: 'Avg EPA', color: '#ff9f68' },
              { key: 'comp', label: 'Avg Composite', color: '#f3be3b' },
            ]}
            valueFormatter={(value) => fmt(value, 1)}
          />
        </div>
      </div>
    );
  }
  function renderPlayoffLabTab() {
    const bracket = buildPlayoffLabBracket(playoffLabAlliances, playoffLabWinners);
    const simSummary = simulatePlayoffScenario(
      playoffLabAllianceState,
      playoffSimRuns,
      playoffSimModel,
    );
    const allAllianceRows = simulatePlayoffAlliancesSummary(
      playoffLabAllianceState,
      playoffSimRuns,
      playoffSimModel,
    );
    const ourAllianceOdds = allAllianceRows.find((row) => row.isUs) ?? null;
    const playoffOddsChartRows = allAllianceRows.map((row) => ({
      label: `A${row.seed}`,
      champ: row.champ,
      finals: row.finals,
      upperFinal: row.upperFinal,
      epaStrength: row.epaStrength,
      compStrength: row.compositeStrength,
    }));
    const scenarioRows = (
      savedAllianceScenarios.length
        ? savedAllianceScenarios
        : [
            {
              id: 'live',
              name: 'Current runtime',
              allianceState: allianceRuntime,
            },
          ]
    )
      .map((scenario) => {
        const sim = simulatePlayoffScenario(
          scenario.allianceState,
          Math.min(500, playoffSimRuns),
          playoffSimModel,
        );
        const allRows = simulatePlayoffAlliancesSummary(
          scenario.allianceState,
          Math.min(500, playoffSimRuns),
          playoffSimModel,
        );
        const ourRow = allRows.find((r) => r.isUs) ?? null;
        return {
          id: scenario.id,
          name: scenario.name,
          bestRound: sim.bestRound,
          champ: sim.champ,
          finals: sim.finals,
          upperFinal: sim.upperFinal,
          ourSeed: ourRow?.seed ?? null,
        };
      })
      .sort((a, b) =>
        scenarioCompareSort === 'champ'
          ? b.champ - a.champ
          : scenarioCompareSort === 'finals'
            ? b.finals - a.finals
            : scenarioCompareSort === 'expected'
              ? b.upperFinal + b.finals + b.champ - (a.upperFinal + a.finals + a.champ)
              : b.upperFinal - a.upperFinal,
      );
    const tileWithButtons = (tileKey, title, match) => {
      const redLabel = match.red?.teams?.length
        ? `A${match.red.seed}: ${match.red.teams.join(' ')}`
        : 'Red TBD';
      const blueLabel = match.blue?.teams?.length
        ? `A${match.blue.seed}: ${match.blue.teams.join(' ')}`
        : 'Blue TBD';
      const redWin =
        match.red?.teams?.length && match.blue?.teams?.length
          ? playoffWinProb(match, playoffSimModel)
          : null;
      const blueWin = redWin != null ? 1 - redWin : null;
      return (
        <div key={tileKey} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {renderBracketTile(tileKey, title, null, redLabel, blueLabel, redWin, blueWin)}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="button"
              disabled={!match.red?.teams?.length || !match.blue?.teams?.length}
              onClick={() =>
                setPlayoffLabWinners((prev) => ({
                  ...prev,
                  [match.key]: 'red',
                }))
              }
            >
              Red wins
            </button>
            <button
              className="button"
              disabled={!match.red?.teams?.length || !match.blue?.teams?.length}
              onClick={() =>
                setPlayoffLabWinners((prev) => ({
                  ...prev,
                  [match.key]: 'blue',
                }))
              }
            >
              Blue wins
            </button>
          </div>
        </div>
      );
    };
    return (
      <div className="stack-12" style={{ marginTop: 12 }}>
        <div className="panel" style={{ padding: 16 }}>
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <select
              className="input"
              value={playoffLabSourceType}
              onChange={(e) => setPlayoffLabSourceType(e.target.value)}
            >
              <option value="live">Current Alliance Sim</option>
              <option value="alliance">Saved Alliance Scenario</option>
            </select>
            {playoffLabSourceType === 'alliance' ? (
              <select
                className="input"
                value={playoffLabSourceId}
                onChange={(e) => setPlayoffLabSourceId(e.target.value)}
              >
                <option value="">Choose alliance scenario</option>
                {savedAllianceScenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              className="input"
              value={playoffSimModel}
              onChange={(e) => setPlayoffSimModel(e.target.value)}
            >
              <option value="epa">EPA Sim</option>
              <option value="composite">Composite Sim</option>
            </select>
            <select
              className="input"
              value={playoffSimRuns}
              onChange={(e) => setPlayoffSimRuns(Number(e.target.value))}
            >
              <option value={500}>500 runs</option>
              <option value={1000}>1000 runs</option>
              <option value={5000}>5000 runs</option>
            </select>
            <button className="button" onClick={() => setPlayoffLabWinners({})}>
              Reset Manual Winners
            </button>
            <button className="button" onClick={savePlayoffResult}>
              Save Playoff Result
            </button>
          </div>
        </div>
        <div className="panel" style={{ padding: 16 }}>
          {renderDoubleElimBoard({
            upperR1: [
              tileWithButtons('U1', 'Match 1', bracket.U1),
              tileWithButtons('U2', 'Match 2', bracket.U2),
              tileWithButtons('U3', 'Match 3', bracket.U3),
              tileWithButtons('U4', 'Match 4', bracket.U4),
            ],
            upperR2: [
              tileWithButtons('U5', 'Match 7', bracket.U5),
              tileWithButtons('U6', 'Match 8', bracket.U6),
            ],
            upperFinal: [tileWithButtons('U7', 'Match 11', bracket.U7)],
            lowerR2: [
              tileWithButtons('L1', 'Match 5', bracket.L1),
              tileWithButtons('L2', 'Match 6', bracket.L2),
            ],
            lowerR3: [
              tileWithButtons('L3', 'Match 9', bracket.L3),
              tileWithButtons('L4', 'Match 10', bracket.L4),
            ],
            lowerR4: [tileWithButtons('L5', 'Match 12', bracket.L5)],
            lowerR5: [tileWithButtons('L6', 'Match 13', bracket.L6)],
            finals: [tileWithButtons('F1', 'Finals', bracket.F1)],
          })}
        </div>
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>
              Our Alliance Summary ({playoffSimModel.toUpperCase()})
            </div>
            <div className="panel-2" style={{ padding: 12 }}>
              <div>Our alliance seed: {ourAllianceOdds?.seed ?? '—'}</div>
              <div>Our alliance: {ourAllianceOdds?.teams?.join(' | ') ?? '—'}</div>
              <div style={{ marginTop: 6 }}>
                Championship odds: {pct(ourAllianceOdds?.champ ?? simSummary.champ)}
              </div>
              <div>Finals odds: {pct(ourAllianceOdds?.finals ?? simSummary.finals)}</div>
              <div>
                Upper-final appearance odds:{' '}
                {pct(ourAllianceOdds?.upperFinal ?? simSummary.upperFinal)}
              </div>
              <div>
                Expected farthest round: {ourAllianceOdds?.bestRound ?? simSummary.bestRound}
              </div>
              <div style={{ marginTop: 6 }}>
                Alliance EPA strength: {fmt(ourAllianceOdds?.epaStrength, 1)}
              </div>
              <div>Alliance Composite strength: {fmt(ourAllianceOdds?.compositeStrength, 1)}</div>
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Scenario Comparison</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <select
                className="input"
                value={scenarioCompareSort}
                onChange={(e) => setScenarioCompareSort(e.target.value)}
              >
                <option value="furthest">Sort by farthest round</option>
                <option value="champ">Sort by champ odds</option>
                <option value="finals">Sort by finals odds</option>
                <option value="expected">Sort by expected finish</option>
              </select>
            </div>
            <div style={{ overflow: 'auto', maxHeight: 320 }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Scenario</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Our Seed</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Best Round</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Champ %</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Finals %</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Upper Final %</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarioRows.map((row) => (
                    <tr key={row.id}>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.name}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.ourSeed ?? '—'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.bestRound}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {pct(row.champ)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {pct(row.finals)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {pct(row.upperFinal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>
            All Alliance Odds ({playoffSimModel.toUpperCase()})
          </div>
          <div style={{ overflow: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Seed</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Alliance</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>EPA Str</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Comp Str</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Best Round</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Champ %</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Finals %</th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Upper Final %</th>
                </tr>
              </thead>
              <tbody>
                {allAllianceRows.map((row) => (
                  <tr
                    key={`playoff_odds_${row.seed}`}
                    style={{ background: row.isUs ? '#132033' : undefined }}
                  >
                    <td
                      style={{
                        padding: 8,
                        borderBottom: '1px solid #1a2333',
                        fontWeight: 900,
                      }}
                    >
                      A{row.seed}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }} className="mono">
                      {row.teams.join(' | ')}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                      {fmt(row.epaStrength, 1)}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                      {fmt(row.compositeStrength, 1)}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                      {row.bestRound}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                      {pct(row.champ)}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                      {pct(row.finals)}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                      {pct(row.upperFinal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="grid-2">
          <AnalyticsChartBlock
            title="Playoff Odds Distribution"
            description="Championship, finals, and upper-final odds for every alliance."
            data={playoffOddsChartRows}
            chartFamily="bar"
            series={[
              { key: 'champ', label: 'Champ', color: '#f3be3b' },
              { key: 'finals', label: 'Finals', color: '#4bb3fd' },
              { key: 'upperFinal', label: 'Upper Final', color: '#c084fc' },
            ]}
            valueFormatter={(value) => pct(value)}
          />
          <AnalyticsChartBlock
            title="Playoff Strength vs Odds"
            description="Alliance strength surfaces against simulated outcome odds."
            data={playoffOddsChartRows}
            chartFamily="line"
            series={[
              { key: 'epaStrength', label: 'EPA Strength', color: '#ff9f68' },
              { key: 'compStrength', label: 'Comp Strength', color: '#2dd4bf' },
              { key: 'champ', label: 'Champ %', color: '#f3be3b' },
            ]}
            valueFormatter={(value, name) => (name === 'Champ %' ? pct(value) : fmt(value, 1))}
          />
        </div>
      </div>
    );
  }
  function renderPickListTab() {
    const taken = new Set();
    (liveAllianceRuntime?.captainSlots ?? []).forEach((slot) =>
      [slot.captain, ...slot.picks].forEach((k) => taken.add(k)),
    );
    const sortedOptions = [...eventTeamRows].sort(
      (a, b) => Number(b.composite ?? -999) - Number(a.composite ?? -999),
    );
    const bucketSummaryRows = activePickList
      ? ['first', 'second', 'avoid'].map((bucket) => {
          const rows = (activePickList[bucket] ?? [])
            .map((entry) => eventRowMap.get(entry.teamKey))
            .filter(Boolean);
          return {
            label: bucket === 'first' ? 'First' : bucket === 'second' ? 'Second' : 'Avoid',
            count: rows.length,
            epa: averageNullable(rows.map((row) => row?.overallEpa ?? null)),
            opr: averageNullable(rows.map((row) => row?.opr ?? null)),
            comp: averageNullable(rows.map((row) => row?.composite ?? null)),
          };
        })
      : [];
    const availablePickRows = pickListCandidateInsights.slice(0, 24).map((row) => ({
      label: `${row.teamNumber}`,
      pick: row.pickValueScore ?? null,
      deny: row.denialValueScore ?? null,
      fit: row.chemistryScore ?? null,
      ready: row.playoffReadyScore ?? null,
      ceiling: row.ceilingScore ?? null,
      epa: row.overallEpa ?? null,
    }));
    const pickListRecommendations = [
      {
        label: 'Best build-us target',
        row: topInsightRows(pickListCandidateInsights, 'pickValueScore')[0] ?? null,
      },
      {
        label: 'Best chemistry target',
        row: topInsightRows(pickListCandidateInsights, 'chemistryScore')[0] ?? null,
      },
      {
        label: 'Best denial target',
        row: topInsightRows(pickListCandidateInsights, 'denialValueScore')[0] ?? null,
      },
      {
        label: 'Safest playoff target',
        row: topInsightRows(pickListCandidateInsights, 'playoffReadyScore')[0] ?? null,
      },
      {
        label: 'Highest ceiling target',
        row: topInsightRows(pickListCandidateInsights, 'ceilingScore')[0] ?? null,
      },
    ];
    return (
      <div className="stack-12" style={{ marginTop: 12 }}>
        <div className="panel" style={{ padding: 16 }}>
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <button className="button" onClick={savePickList}>
              New Pick List
            </button>
            <select
              className="input"
              value={activePickListId}
              onChange={(e) => setActivePickListId(e.target.value)}
            >
              {pickLists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {!pickLists.length ? <span className="muted">Create a pick list to start.</span> : null}
          </div>
        </div>
        {activePickList ? (
          <>
            <div className="panel" style={{ padding: 16 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <select
                  className="input"
                  value={pickListEntry}
                  onChange={(e) => setPickListEntry(e.target.value)}
                >
                  <option value="">Choose team</option>
                  {sortedOptions.map((r) => (
                    <option key={r.teamKey} value={r.teamKey}>
                      {r.teamNumber} {r.nickname} | Comp {fmt(r.composite, 1)} | EPA{' '}
                      {fmt(r.overallEpa, 1)} | Pick{' '}
                      {fmt(pickListInsightMap.get(r.teamKey)?.pickValueScore, 0)} | Ready{' '}
                      {fmt(pickListInsightMap.get(r.teamKey)?.playoffReadyScore, 0)} | Ceiling{' '}
                      {fmt(pickListInsightMap.get(r.teamKey)?.ceilingScore, 0)}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={pickListTarget}
                  onChange={(e) => setPickListTarget(e.target.value)}
                >
                  <option value="first">First Picks</option>
                  <option value="second">Second Picks</option>
                  <option value="avoid">Do Not Pick</option>
                </select>
                <input
                  className="input"
                  value={pickListComment}
                  onChange={(e) => setPickListComment(e.target.value)}
                  onKeyDown={(event) => handleActionInputKeyDown(event, addPickListEntry)}
                  placeholder="Comment"
                />
                <input
                  className="input"
                  value={pickListTag}
                  onChange={(e) => setPickListTag(e.target.value)}
                  onKeyDown={(event) => handleActionInputKeyDown(event, addPickListEntry)}
                  placeholder="Tag"
                />
                <button className="button" onClick={addPickListEntry} disabled={!pickListEntry}>
                  Add
                </button>
                <button
                  className="button"
                  onClick={() => {
                    if (!activePickList) return;
                    setPickLists((prev) => prev.filter((p) => p.id !== activePickList.id));
                    setActivePickListId(
                      pickLists.find((p) => p.id !== activePickList.id)?.id ?? '',
                    );
                  }}
                >
                  Delete Pick List
                </button>
              </div>
            </div>
            <div className="grid-3">
              {['first', 'second', 'avoid'].map((bucket) => (
                <div key={bucket} className="panel" style={{ padding: 16 }}>
                  <div style={{ fontWeight: 900, marginBottom: 10 }}>
                    {bucket === 'first'
                      ? 'First Picks'
                      : bucket === 'second'
                        ? 'Second Picks'
                        : 'Do Not Pick'}
                  </div>
                  <div className="stack-8">
                    {(activePickList[bucket] ?? []).map((entry) =>
                      taken.has(entry.teamKey) ? null : (
                        <div key={entry.teamKey} className="panel-2" style={{ padding: 10 }}>
                          <div className="mono">{entry.teamKey}</div>
                          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                            {entry.comment || '—'} {entry.tag ? `| ${entry.tag}` : ''}
                          </div>
                          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                            Pick {fmt(pickListInsightMap.get(entry.teamKey)?.pickValueScore, 0)} |
                            Fit {fmt(pickListInsightMap.get(entry.teamKey)?.chemistryScore, 0)} |
                            Deny {fmt(pickListInsightMap.get(entry.teamKey)?.denialValueScore, 0)} |
                            Ready {fmt(pickListInsightMap.get(entry.teamKey)?.playoffReadyScore, 0)}{' '}
                            | Ceiling {fmt(pickListInsightMap.get(entry.teamKey)?.ceilingScore, 0)}
                          </div>
                          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                            {pickListInsightMap.get(entry.teamKey)?.bestUseCase ?? '—'} |{' '}
                            {pickListInsightMap.get(entry.teamKey)?.recommendationReason ?? '—'}
                          </div>
                          <button
                            className="button"
                            style={{ marginTop: 8 }}
                            onClick={() =>
                              updateActivePickList((list) => {
                                list[bucket] = list[bucket].filter(
                                  (e) => e.teamKey !== entry.teamKey,
                                );
                                return list;
                              })
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
        <div className="grid-3">
          {pickListRecommendations.map((item) => (
            <div key={item.label} className="panel" style={{ padding: 16 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                {item.label}
              </div>
              <div style={{ fontWeight: 900, marginTop: 6 }}>
                {item.row?.teamNumber ?? '—'} {item.row?.nickname ?? item.row?.teamKey ?? ''}
              </div>
              <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                {item.label === 'Safest playoff target'
                  ? `Ready ${fmt(item.row?.playoffReadyScore, 0)} | Stable ${fmt(item.row?.stabilityScore, 0)}`
                  : item.label === 'Highest ceiling target'
                    ? `Ceiling ${fmt(item.row?.ceilingScore, 0)} | Pick ${fmt(item.row?.pickValueScore, 0)}`
                    : `Pick ${fmt(item.row?.pickValueScore, 0)} | Fit ${fmt(item.row?.chemistryScore, 0)} | Deny ${fmt(item.row?.denialValueScore, 0)}`}
              </div>
              <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                {item.row?.bestUseCase ?? '—'} | {item.row?.recommendationReason ?? '—'}
              </div>
            </div>
          ))}
        </div>
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                marginBottom: 10,
              }}
            >
              <div style={{ fontWeight: 900 }}>Saved Playoff Scenarios</div>
              <select
                className="input"
                value={activePlayoffResultId}
                onChange={(e) => setActivePlayoffResultId(e.target.value)}
              >
                <option value="">Choose scenario</option>
                {savedPlayoffResults.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {activePlayoffResult ? (
                <button
                  className="button"
                  onClick={() => {
                    setSavedPlayoffResults((prev) =>
                      prev.filter((r) => r.id !== activePlayoffResult.id),
                    );
                    setActivePlayoffResultId(
                      savedPlayoffResults.find((r) => r.id !== activePlayoffResult.id)?.id ?? '',
                    );
                  }}
                >
                  Delete
                </button>
              ) : null}
            </div>
            <div style={{ overflow: 'auto', maxHeight: 360 }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Scenario</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Our Seed</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Manual</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Sim Best</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Champ %</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Finals %</th>
                  </tr>
                </thead>
                <tbody>
                  {savedPlayoffResults.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setActivePlayoffResultId(row.id)}
                      style={{
                        cursor: 'pointer',
                        background: activePlayoffResultId === row.id ? '#132033' : undefined,
                      }}
                    >
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.name}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.ourSummary?.seed ?? '—'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.manualSummary?.bestRound ?? '—'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {row.ourSummary?.bestRound ?? '—'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {pct(row.ourSummary?.champ)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {pct(row.ourSummary?.finals)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Scenario Detail</div>
            {activePlayoffResult ? (
              <div className="stack-12">
                <div className="panel-2" style={{ padding: 12 }}>
                  <div style={{ fontWeight: 900 }}>{activePlayoffResult.name}</div>
                  <div style={{ marginTop: 6 }}>
                    Our alliance seed: {activePlayoffResult.ourSummary?.seed ?? '—'}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    Our alliance: {activePlayoffResult.ourSummary?.teams?.join(' | ') ?? '—'}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    Manual playoff result: {activePlayoffResult.manualSummary?.bestRound ?? '—'}
                  </div>
                  <div>
                    Simulated farthest round: {activePlayoffResult.ourSummary?.bestRound ?? '—'}
                  </div>
                  <div>Championship odds: {pct(activePlayoffResult.ourSummary?.champ)}</div>
                  <div>Finals odds: {pct(activePlayoffResult.ourSummary?.finals)}</div>
                  <div>Upper-final odds: {pct(activePlayoffResult.ourSummary?.upperFinal)}</div>
                  <div style={{ marginTop: 6 }}>
                    Alliance EPA strength: {fmt(activePlayoffResult.ourSummary?.epaStrength, 1)}
                  </div>
                  <div>
                    Alliance Composite strength:{' '}
                    {fmt(activePlayoffResult.ourSummary?.compositeStrength, 1)}
                  </div>
                </div>
                <div className="panel-2" style={{ padding: 12 }}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>All Alliance Odds</div>
                  <div style={{ overflow: 'auto', maxHeight: 320 }}>
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: 12,
                      }}
                    >
                      <thead>
                        <tr style={{ textAlign: 'left' }}>
                          <th
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #223048',
                            }}
                          >
                            Seed
                          </th>
                          <th
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #223048',
                            }}
                          >
                            Alliance
                          </th>
                          <th
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #223048',
                            }}
                          >
                            EPA Str
                          </th>
                          <th
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #223048',
                            }}
                          >
                            Comp Str
                          </th>
                          <th
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #223048',
                            }}
                          >
                            Best Round
                          </th>
                          <th
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #223048',
                            }}
                          >
                            Champ %
                          </th>
                          <th
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #223048',
                            }}
                          >
                            Finals %
                          </th>
                          <th
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #223048',
                            }}
                          >
                            Upper Final %
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(activePlayoffResult.allAllianceRows ?? []).map((row) => (
                          <tr
                            key={`saved_playoff_${activePlayoffResult.id}_${row.seed}`}
                            style={{
                              background: row.isUs ? '#132033' : undefined,
                            }}
                          >
                            <td
                              style={{
                                padding: 8,
                                borderBottom: '1px solid #1a2333',
                                fontWeight: 900,
                              }}
                            >
                              A{row.seed}
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: '1px solid #1a2333',
                              }}
                              className="mono"
                            >
                              {row.teams.join(' | ')}
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: '1px solid #1a2333',
                              }}
                            >
                              {fmt(row.epaStrength, 1)}
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: '1px solid #1a2333',
                              }}
                            >
                              {fmt(row.compositeStrength, 1)}
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: '1px solid #1a2333',
                              }}
                            >
                              {row.bestRound}
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: '1px solid #1a2333',
                              }}
                            >
                              {pct(row.champ)}
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: '1px solid #1a2333',
                              }}
                            >
                              {pct(row.finals)}
                            </td>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: '1px solid #1a2333',
                              }}
                            >
                              {pct(row.upperFinal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="muted">
                Select a saved playoff scenario to inspect alliance odds and our path.
              </div>
            )}
          </div>
        </div>
        <div className="grid-2">
          <AnalyticsChartBlock
            title="Pick List Bucket Strength"
            description="Average strength and bucket size across the active pick list."
            data={bucketSummaryRows}
            chartFamily="bar"
            series={[
              { key: 'count', label: 'Count', color: '#94a3b8' },
              { key: 'epa', label: 'Avg EPA', color: '#ff9f68' },
              { key: 'comp', label: 'Avg Composite', color: '#2dd4bf' },
            ]}
            valueFormatter={(value) => fmt(value, 1)}
          />
          <AnalyticsChartBlock
            title="Available Pick Targets"
            description="Public-data pick heuristics for the untaken pool, including playoff readiness and ceiling."
            data={availablePickRows}
            chartFamily="bar"
            series={[
              { key: 'pick', label: 'Pick', color: '#4bb3fd' },
              { key: 'fit', label: 'Fit', color: '#2dd4bf' },
              { key: 'ready', label: 'Ready', color: '#c084fc' },
              { key: 'ceiling', label: 'Ceiling', color: '#f97316' },
            ]}
            valueFormatter={(value) => fmt(value, 1)}
          />
        </div>
      </div>
    );
  }
  function renderLiveAllianceTab() {
    const taken = new Set();
    (liveAllianceRuntime?.captainSlots ?? []).forEach((slot) =>
      [slot.captain, ...slot.picks].forEach((k) => taken.add(k)),
    );
    const liveCaptainRows = (liveAllianceRuntime?.captainSlots ?? []).map((slot) => {
      const rows = [slot.captain, ...slot.picks]
        .map((teamKey) => eventRowMap.get(teamKey))
        .filter(Boolean);
      return {
        label: `A${slot.seed}`,
        epa: averageNullable(rows.map((row) => row?.overallEpa ?? null)),
        comp: averageNullable(rows.map((row) => row?.composite ?? null)),
        picks: slot.picks.length,
      };
    });
    const liveAvailabilityRows = liveAllianceCandidateInsights.slice(0, 24).map((row) => ({
      label: `${row.teamNumber ?? teamNumberFromKey(row.teamKey) ?? row.teamKey}`,
      rank: row.realRank ?? row.simRank ?? null,
      pick: row.pickValueScore ?? null,
      fit: row.chemistryScore ?? null,
      deny: row.denialValueScore ?? null,
      ready: row.playoffReadyScore ?? null,
      ceiling: row.ceilingScore ?? null,
      stable: row.stabilityScore ?? null,
      epa: row.overallEpa ?? null,
      comp: row.composite ?? null,
    }));
    const livePickDepthRows = (liveAllianceRuntime?.captainSlots ?? []).map((slot) => ({
      label: `A${slot.seed}`,
      picks: slot.picks.length,
      epa: liveCaptainRows.find((row) => row.label === `A${slot.seed}`)?.epa ?? null,
      comp: liveCaptainRows.find((row) => row.label === `A${slot.seed}`)?.comp ?? null,
    }));
    const liveRecommendations = [
      {
        label: 'Build Us',
        row: topInsightRows(liveAllianceCandidateInsights, 'pickValueScore')[0] ?? null,
      },
      {
        label: 'Best Fit',
        row: topInsightRows(liveAllianceCandidateInsights, 'chemistryScore')[0] ?? null,
      },
      {
        label: 'Deny Rival',
        row: topInsightRows(liveAllianceCandidateInsights, 'denialValueScore')[0] ?? null,
      },
      {
        label: 'Playoff Ready',
        row: topInsightRows(liveAllianceCandidateInsights, 'playoffReadyScore')[0] ?? null,
      },
      {
        label: 'Highest Ceiling',
        row: topInsightRows(liveAllianceCandidateInsights, 'ceilingScore')[0] ?? null,
      },
    ];
    return (
      <div className="stack-12" style={{ marginTop: 12 }}>
        <div className="panel" style={{ padding: 16 }}>
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <button className="button" onClick={pullLiveAllianceBoard}>
              Pull Rankings
            </button>
            <div className="muted">
              {liveAlliancePulledAt
                ? `Pulled ${new Date(liveAlliancePulledAt).toLocaleTimeString()}`
                : 'Not pulled yet'}
            </div>
            <select
              className="input"
              value={activePickListId}
              onChange={(e) => setActivePickListId(e.target.value)}
            >
              {pickLists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Live Alliance Selection</div>
            <div className="muted" style={{ marginBottom: 8 }}>
              Current captain:{' '}
              {liveAllianceRuntime?.captainSlots?.[liveAllianceRuntime?.currentIndex ?? 0]
                ?.captain ?? '—'}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <select
                className="input"
                value={liveAlliancePickTarget}
                onChange={(e) => setLiveAlliancePickTarget(e.target.value)}
              >
                <option value="">Choose invite target</option>
                {liveAllianceCandidateInsights.map((r) => (
                  <option key={r.teamKey} value={r.teamKey}>
                    {r.teamKey} | Pick {fmt(r.pickValueScore, 0)} | Fit {fmt(r.chemistryScore, 0)} |
                    Deny {fmt(r.denialValueScore, 0)} | Ready {fmt(r.playoffReadyScore, 0)} |
                    Ceiling {fmt(r.ceilingScore, 0)}
                  </option>
                ))}
              </select>
              <button
                className="button"
                onClick={handleLiveAllianceAccept}
                disabled={!liveAlliancePickTarget}
              >
                Accept
              </button>
              <button
                className="button"
                onClick={handleLiveAllianceDecline}
                disabled={!liveAlliancePickTarget}
              >
                Decline
              </button>
            </div>
            <div className="grid-3" style={{ marginBottom: 10 }}>
              {liveRecommendations.map((item) => (
                <div key={item.label} className="panel-2" style={{ padding: 10 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {item.label}
                  </div>
                  <div style={{ fontWeight: 900, marginTop: 6 }}>
                    {item.row?.teamNumber ?? teamNumberFromKey(item.row?.teamKey ?? '') ?? '—'}{' '}
                    {item.row?.teamKey ?? ''}
                  </div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    {item.label === 'Playoff Ready'
                      ? `Ready ${fmt(item.row?.playoffReadyScore, 0)} | Stable ${fmt(item.row?.stabilityScore, 0)}`
                      : item.label === 'Highest Ceiling'
                        ? `Ceiling ${fmt(item.row?.ceilingScore, 0)} | Pick ${fmt(item.row?.pickValueScore, 0)}`
                        : `Pick ${fmt(item.row?.pickValueScore, 0)} | Fit ${fmt(item.row?.chemistryScore, 0)} | Deny ${fmt(item.row?.denialValueScore, 0)}`}
                  </div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    {item.row?.bestUseCase ?? '—'} | {item.row?.recommendationReason ?? '—'}
                  </div>
                </div>
              ))}
            </div>
            <div className="stack-8">
              {(liveAllianceRuntime?.captainSlots ?? []).map((slot) => (
                <div
                  key={`live_${slot.seed}_${slot.captain}`}
                  className="panel-2"
                  style={{ padding: 10 }}
                >
                  <div style={{ fontWeight: 900 }}>Alliance {slot.seed}</div>
                  <div className="mono">{[slot.captain, ...slot.picks].join(' | ')}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>
              Active Pick Lists (taken teams auto removed)
            </div>
            {activePickList ? (
              <div className="grid-3">
                {['first', 'second', 'avoid'].map((bucket) => (
                  <div key={bucket}>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>
                      {bucket === 'first' ? 'First' : bucket === 'second' ? 'Second' : 'Avoid'}
                    </div>
                    <div className="stack-8">
                      {(activePickList[bucket] ?? [])
                        .filter((e) => !taken.has(e.teamKey))
                        .map((entry) => (
                          <div key={entry.teamKey} className="panel-2" style={{ padding: 10 }}>
                            <div className="mono">{entry.teamKey}</div>
                            <div className="muted" style={{ fontSize: 12 }}>
                              {entry.comment || '—'} {entry.tag ? `| ${entry.tag}` : ''}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">No active pick list selected.</div>
            )}
          </div>
        </div>
        <div className="grid-2">
          <AnalyticsChartBlock
            title="Live Alliance Board Strength"
            description="Live workflow keeps current formed alliances in view."
            data={liveCaptainRows}
            chartFamily="bar"
            series={[
              { key: 'epa', label: 'Avg EPA', color: '#ff9f68' },
              { key: 'comp', label: 'Avg Composite', color: '#f3be3b' },
            ]}
            valueFormatter={(value) => fmt(value, 1)}
          />
          <AnalyticsChartBlock
            title="Live Available Teams"
            description="Remaining invite targets by public-data pick heuristics, playoff readiness, and upside."
            data={liveAvailabilityRows}
            chartFamily="bar"
            series={[
              { key: 'pick', label: 'Pick', color: '#4bb3fd' },
              { key: 'fit', label: 'Fit', color: '#2dd4bf' },
              { key: 'ready', label: 'Ready', color: '#c084fc' },
              { key: 'ceiling', label: 'Ceiling', color: '#f97316' },
            ]}
            valueFormatter={(value) => fmt(value, 1)}
          />
        </div>
        <div className="grid-2">
          <AnalyticsChartBlock
            title="Live Pick Depth"
            description="How many picks each live alliance has made and how strong they are."
            data={livePickDepthRows}
            chartFamily="bar"
            series={[
              { key: 'picks', label: 'Picks', color: '#94a3b8' },
              { key: 'epa', label: 'Avg EPA', color: '#ff9f68' },
              { key: 'comp', label: 'Avg Composite', color: '#2dd4bf' },
            ]}
            valueFormatter={(value) => fmt(value, 1)}
          />
          <AnalyticsChartBlock
            title="Live Available Rank / Strength"
            description="Remaining live pool by rank, current-event strength, and playoff-readiness signals."
            data={liveAvailabilityRows}
            chartFamily="line"
            series={[
              { key: 'rank', label: 'Rank', color: '#f3be3b' },
              { key: 'epa', label: 'EPA', color: '#4bb3fd' },
              { key: 'ready', label: 'Ready', color: '#2dd4bf' },
              { key: 'ceiling', label: 'Ceiling', color: '#c084fc' },
            ]}
            valueFormatter={(value) => fmt(value, 1)}
          />
        </div>
      </div>
    );
  }
  function renderImpactTab() {
    const selectedPred = impactSelectedMatch
      ? getSbPred(sbMatchMap.get(impactSelectedMatch.key))
      : null;
    const ourKey = loadedTeam != null ? tbaTeamKey(loadedTeam) : '';
    const ourAllianceColor = impactSelectedMatch
      ? allianceForTeam(impactSelectedMatch, ourKey)
      : null;
    const impactBandRows = impactScenarios.map((scenario) => ({
      label: `${scenario.rp} RP`,
      top1: scenario.top1 ? 1 : 0,
      top4: scenario.top4 ? 1 : 0,
      top8: scenario.top8 ? 1 : 0,
      totalDelta: scenario.totalDelta,
    }));
    return (
      <div className="stack-12" style={{ marginTop: 12 }}>
        <div className="panel" style={{ padding: 16 }}>
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <select
              className="input"
              value={impactSelectedMatchKey ?? ''}
              onChange={(e) => setImpactSelectedMatchKey(e.target.value)}
            >
              <option value="">Choose upcoming qual</option>
              {ourUpcomingMatches
                .filter((m) => m.comp_level === 'qm')
                .map((m) => (
                  <option key={m.key} value={m.key}>
                    {formatMatchLabel(m)}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>0–6 RP Impact Summary</div>
            <div className="grid-2">
              {impactScenarios.map((s) => (
                <div key={s.rp} className="panel-2" style={{ padding: 12 }}>
                  <div style={{ fontWeight: 900, fontSize: 18 }}>{s.rp} RP</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Projected rank: {s.ourRank || '—'}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Rank delta vs now:{' '}
                    {s.rankDelta == null
                      ? '—'
                      : s.rankDelta > 0
                        ? `+${s.rankDelta}`
                        : String(s.rankDelta)}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Projected total RP: {fmt(s.total, 1)} (
                    {s.totalDelta == null
                      ? '—'
                      : s.totalDelta > 0
                        ? `+${fmt(s.totalDelta, 1)}`
                        : fmt(s.totalDelta, 1)}
                    )
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Buckets: 1-seed {s.top1 ? 'Yes' : 'No'} | Top-4 {s.top4 ? 'Yes' : 'No'} | Top-8{' '}
                    {s.top8 ? 'Yes' : 'No'}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Above: {s.aboveTeam ? `${s.aboveTeam.teamNumber} ${s.aboveTeam.nickname}` : '—'}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    Below: {s.belowTeam ? `${s.belowTeam.teamNumber} ${s.belowTeam.nickname}` : '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>More Impact Context</div>
            <div className="panel-2" style={{ padding: 12 }}>
              <div>
                Selected match: {impactSelectedMatch ? formatMatchLabel(impactSelectedMatch) : '—'}
              </div>
              <div style={{ marginTop: 6 }}>Our color: {ourAllianceColor ?? '—'}</div>
              <div style={{ marginTop: 6 }}>
                Current real rank: {rankingsDerived.ourRow?.rank ?? '—'}
              </div>
              <div style={{ marginTop: 6 }}>
                Current total RP: {fmt(rankingsDerived.ourTotalRp, 1)}
              </div>
              <div style={{ marginTop: 6 }}>
                Projected rank range across 0–6 RP:{' '}
                {impactScenarios.length
                  ? `${Math.min(...impactScenarios.map((x) => x.ourRank || 999))} to ${Math.max(...impactScenarios.map((x) => x.ourRank || 0))}`
                  : '—'}
              </div>
              <div style={{ marginTop: 6 }}>
                Predicted score:{' '}
                {selectedPred?.red_score != null
                  ? `Red ${fmt(selectedPred.red_score, 0)} | Blue ${fmt(selectedPred.blue_score, 0)}`
                  : '—'}
              </div>
              <div style={{ marginTop: 6 }}>
                Predicted win: Red {pct(selectedPred?.red_win_prob)} | Blue{' '}
                {selectedPred?.red_win_prob != null
                  ? pct(1 - Number(selectedPred.red_win_prob))
                  : '—'}
              </div>
              <div style={{ marginTop: 6 }} className="mono">
                Red: {impactSelectedMatch?.alliances?.red?.team_keys?.join(' ') ?? '—'}
              </div>
              <div style={{ marginTop: 4 }} className="mono">
                Blue: {impactSelectedMatch?.alliances?.blue?.team_keys?.join(' ') ?? '—'}
              </div>
              <div style={{ marginTop: 8 }}>
                This tab is deterministic on your selected match outcome. Monte Carlo remains
                separate inside PREDICT.
              </div>
            </div>
          </div>
        </div>
        <AnalyticsChartBlock
          title="Impact Curve: Rank and RP Outcome Bands"
          description="Selected-match outcome curve across 0-6 RP."
          data={impactScenarios.map((scenario) => ({
            label: `${scenario.rp} RP`,
            rank: scenario.ourRank,
            total: scenario.total,
            delta: scenario.rankDelta,
          }))}
          chartFamily="line"
          series={[
            { key: 'rank', label: 'Projected Rank', color: '#f3be3b' },
            { key: 'total', label: 'Projected Total RP', color: '#4bb3fd' },
            { key: 'delta', label: 'Rank Delta', color: '#ff6b6b' },
          ]}
          valueFormatter={(value) => fmt(value, 1)}
        />
        <div className="grid-2">
          <AnalyticsChartBlock
            title="Impact Bucket Flags"
            description="Seed-band thresholds across every 0-6 RP outcome."
            data={impactBandRows}
            chartFamily="bar"
            series={[
              { key: 'top1', label: 'Top1', color: '#f3be3b' },
              { key: 'top4', label: 'Top4', color: '#2dd4bf' },
              { key: 'top8', label: 'Top8', color: '#c084fc' },
              { key: 'totalDelta', label: 'RP Delta', color: '#4bb3fd' },
            ]}
            valueFormatter={(value, name) => (name === 'RP Delta' ? fmt(value, 1) : fmt(value, 0))}
          />
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Impact Neighbors</div>
            <div style={{ overflow: 'auto', maxHeight: 360 }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>RP</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>
                      Projected Rank
                    </th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Above</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Below</th>
                  </tr>
                </thead>
                <tbody>
                  {impactScenarios.map((scenario) => (
                    <tr key={`impact_neighbor_${scenario.rp}`}>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {scenario.rp}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {scenario.ourRank ?? '-'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {scenario.aboveTeam
                          ? `${scenario.aboveTeam.teamNumber} ${scenario.aboveTeam.nickname}`
                          : '-'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {scenario.belowTeam
                          ? `${scenario.belowTeam.teamNumber} ${scenario.belowTeam.nickname}`
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }
  function renderStrategyTab() {
    const strategyMatch =
      effectiveStrategyTarget?.matchKey != null
        ? (sortedMatches.find((match) => match.key === effectiveStrategyTarget.matchKey) ?? null)
        : null;
    const strategyTeamNumbers = strategyMatch
      ? [...strategyMatch.alliances.red.team_keys, ...strategyMatch.alliances.blue.team_keys]
          .map((key) => teamNumberFromKey(key))
          .filter((value) => value != null)
      : [];
    return (
      <div className="stack-12">
        <StrategyWorkspace
          target={effectiveStrategyTarget}
          currentEventKey={loadedEventKey}
          currentSnapshot={snapshot}
          onTargetChange={openStrategyTarget}
          onOpenTeamProfile={openTeamProfile}
          onAddToCompare={addTeamToCompare}
        />
        {strategyTeamNumbers.length ? (
          <TeamContextAnalyticsBlock
            title="Strategy Context Analytics"
            subtitle="Role-overlap, phase output, and recent event form for the current strategy board."
            teamNumbers={strategyTeamNumbers}
            loadedEventKey={loadedEventKey}
            baselineTeamNumber={loadedTeam ?? null}
            currentMetricKeys={[
              'event_match_epa',
              'event_match_my_score',
              'event_match_margin',
              'event_match_auto',
              'event_match_teleop',
              'event_match_endgame',
              'event_match_rolling_opr',
              'event_match_rolling_copr',
              'event_match_rolling_dpr',
              'event_match_rolling_ccwm',
            ]}
            historicalMetricKeys={[
              'season_match_epa',
              'season_match_my_score',
              'season_match_margin',
              'season_match_auto',
              'season_match_teleop',
              'season_match_endgame',
            ]}
            showBreakdownMatrix
            onOpenTeamProfile={openTeamProfile}
            scope="current"
          />
        ) : null}
      </div>
    );
  }
  function renderHistoricalStrategyTab() {
    return (
      <div className="stack-12">
        {historicalStrategyTarget ? (
          <div className="strategy-print-root">
            <StrategyWorkspace
              target={historicalStrategyTarget}
              currentEventKey={loadedEventKey}
              currentSnapshot={snapshot}
              onTargetChange={openStrategyTarget}
              onOpenTeamProfile={openTeamProfile}
              onAddToCompare={addTeamToCompare}
            />
          </div>
        ) : (
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Historical Strategy Workspace</div>
            <div className="muted">
              Open a historical match from `TEAM_PROFILE` to load a targeted strategy board for that
              past event.
            </div>
          </div>
        )}
        {renderPreEventScoutingTab('strategy')}
      </div>
    );
  }
  function renderTeamProfileTab(scope = 'current') {
    return (
      <TeamProfileTab
        suggestedTeamNumber={selectedTeamNumber ?? loadedTeam}
        forcedTeamNumber={
          scope === 'historical'
            ? historicalTeamProfileForcedTeamNumber
            : currentTeamProfileForcedTeamNumber
        }
        loadedEventKey={loadedEventKey}
        nexusSnapshot={nexusSnapshot}
        onOpenStrategy={openStrategyTarget}
        onAddToCompare={addTeamToCompare}
        scope={scope}
      />
    );
  }
  function renderCompareTab(scope = 'current') {
    return (
      <CompareTab
        loadedEventKey={loadedEventKey}
        loadedTeam={loadedTeam}
        eventTeamRows={eventTeamRows}
        externalUpdateKey={
          scope === 'historical' ? historicalCompareSyncKey : currentCompareSyncKey
        }
        onOpenTeamProfile={openTeamProfile}
        scope={scope}
      />
    );
  }
  async function handleLogoChange(file) {
    if (!file) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setSettings((prev) => ({ ...prev, logoDataUrl: dataUrl }));
  }
  function renderSettingsTab() {
    const diagnosticsRows = [
      { label: t('settings.event_teams', 'Event teams'), value: eventTeamRows.length ?? 0 },
      { label: 'TBA Matches', value: snapshot?.tba?.matches?.length ?? 0 },
      { label: t('settings.sb_matches', 'SB matches'), value: snapshot?.sb?.matches?.length ?? 0 },
      {
        label: t('settings.sb_team_events', 'SB team events'),
        value: snapshot?.sb?.teamEvents?.length ?? 0,
      },
    ];
    const shortcutRows = [
      { combo: 'Ctrl/Cmd+K', action: t('shortcut.quick_jump', 'Open Quick Jump') },
      { combo: 'Alt+1', action: t('shortcut.current', 'Jump to CURRENT') },
      { combo: 'Alt+2', action: t('shortcut.historical', 'Jump to HISTORICAL') },
      { combo: 'Alt+3', action: t('shortcut.predict', 'Jump to PREDICT') },
      { combo: 'Alt+4', action: t('shortcut.settings', 'Jump to SETTINGS') },
      { combo: 'Alt+N', action: t('shortcut.now', 'Open NOW') },
      { combo: 'Alt+S', action: t('shortcut.schedule', 'Open SCHEDULE') },
      { combo: 'Alt+M', action: t('shortcut.match', 'Open MATCH') },
      { combo: 'Alt+T', action: t('shortcut.strategy', 'Open STRATEGY') },
      { combo: 'Alt+R', action: t('shortcut.rankings', 'Open RANKINGS') },
      { combo: 'Alt+E', action: t('shortcut.event', 'Open EVENT') },
      { combo: 'Alt+D', action: t('shortcut.data', 'Open DATA') },
      { combo: 'Alt+P', action: t('shortcut.predict_tab', 'Open PREDICT workspace') },
    ];
    return (
      <div className="stack-12" style={{ marginTop: 12 }}>
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>
              {t('settings.section.preferences', 'Product Preferences')}
            </div>
            <div className="stack-12">
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                  {t('settings.poll_ms', 'Poll Speed (milliseconds)')}
                </div>
                <input
                  className="input"
                  type="number"
                  value={settings.pollMs}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      pollMs: clamp(Number(e.target.value), 2000, 60000),
                    }))
                  }
                />
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={settings.repeatUntilAck}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      repeatUntilAck: e.target.checked,
                    }))
                  }
                />
                {t('settings.repeat_alert', 'Repeat alert sound until stopped')}
              </label>
              <div className="panel-2" style={{ padding: 12 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800 }}>
                      {audioEnabled
                        ? t('field.audio_on', 'Audio On')
                        : t('field.audio_off', 'Audio Off')}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {audioStatusText ||
                        'Enable audio once, then use Test Audio to confirm this browser/device can play alerts.'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="button" type="button" onClick={() => void toggleAudio()}>
                      {audioEnabled
                        ? t('field.audio_off', 'Audio Off')
                        : t('field.audio_on', 'Audio On')}
                    </button>
                    <button
                      className="button button-primary"
                      type="button"
                      onClick={() => void playAudioPattern('TEST', { updateStatus: true })}
                    >
                      {t('field.test_audio', 'Test Audio')}
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid-2">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {t('settings.theme.label', 'Theme')}
                  </span>
                  <select
                    className="input"
                    value={settings.themeId}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        themeId: e.target.value,
                      }))
                    }
                  >
                    {THEME_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {t(option.labelKey, option.preview)}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {t('settings.language.label', 'Language')}
                  </span>
                  <select
                    className="input"
                    value={settings.language}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        language: e.target.value,
                      }))
                    }
                  >
                    {LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {t(option.labelKey, option.nativeLabel)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                  {t('settings.upload_logo', 'Upload Team Logo')}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleLogoChange(e.target.files?.[0] ?? null)}
                />
              </div>
              {settings.logoDataUrl ? (
                <Image
                  src={settings.logoDataUrl}
                  alt="Team logo"
                  width={140}
                  height={140}
                  unoptimized
                  style={{ objectFit: 'contain' }}
                />
              ) : null}
              <button
                className="button"
                type="button"
                aria-label="Raw Payload Explorer"
                onClick={() => setSettingsRawPayloadOpen((value) => !value)}
              >
                {t('settings.open_explorer', 'Open Explorer')}
              </button>
              <div className="panel-2" style={{ padding: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>
                  {t('settings.shortcuts.title', 'Keyboard Shortcuts')}
                </div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  {t(
                    'settings.shortcuts.help',
                    'Global shortcuts stay disabled while you are typing in an input field.',
                  )}
                </div>
                <div className="grid-2">
                  {shortcutRows.map((row) => (
                    <div
                      key={row.combo}
                      style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}
                    >
                      <span className="mono">{row.combo}</span>
                      <span className="muted" style={{ fontSize: 12, textAlign: 'right' }}>
                        {row.action}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>
              {t('settings.section.webhooks', 'Discord Webhooks')}
            </div>
            <div className="stack-12">
              <div className="muted" style={{ fontSize: 12 }}>
                {t(
                  'settings.webhook.help',
                  'Send important operational events to Discord without exposing the webhook URL directly from the browser.',
                )}
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={settings.webhook.enabled}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      webhook: {
                        ...prev.webhook,
                        enabled: e.target.checked,
                      },
                    }))
                  }
                />
                {t('settings.webhook.enabled', 'Enable Discord webhook delivery')}
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {t('settings.webhook.url', 'Discord Webhook URL')}
                </span>
                <input
                  className="input"
                  value={settings.webhook.discordUrl}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      webhook: {
                        ...prev.webhook,
                        discordUrl: e.target.value,
                      },
                    }))
                  }
                />
              </label>
              <div className="grid-2">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {t('settings.webhook.display_name', 'Display Name')}
                  </span>
                  <input
                    className="input"
                    value={settings.webhook.displayName}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        webhook: {
                          ...prev.webhook,
                          displayName: e.target.value,
                        },
                      }))
                    }
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {t('settings.webhook.cooldown', 'Cooldown (seconds)')}
                  </span>
                  <input
                    className="input"
                    type="number"
                    min={5}
                    max={600}
                    value={settings.webhook.cooldownSeconds}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        webhook: {
                          ...prev.webhook,
                          cooldownSeconds: clamp(Number(e.target.value), 5, 600),
                        },
                      }))
                    }
                  />
                </label>
              </div>
              <div className="panel-2" style={{ padding: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>
                  {t('settings.section.webhooks', 'Discord Webhooks')}
                </div>
                <div className="grid-2">
                  {WEBHOOK_EVENT_OPTIONS.map((eventOption) => (
                    <label
                      key={eventOption.id}
                      style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(settings.webhook.events[eventOption.id])}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            webhook: {
                              ...prev.webhook,
                              events: {
                                ...prev.webhook.events,
                                [eventOption.id]: e.target.checked,
                              },
                            },
                          }))
                        }
                      />
                      {t(eventOption.labelKey, eventOption.id)}
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={webhookDelivery.pending}
                  onClick={() =>
                    void sendDiscordWebhookEvent(
                      'test',
                      t('webhook.test.title', 'Strategy Desk Test'),
                      t('webhook.test.body', 'Manual webhook test from Strategy Desk.'),
                      [],
                      { force: true },
                    )
                  }
                >
                  {webhookDelivery.pending
                    ? t('settings.webhook.testing', 'Sending...')
                    : t('settings.webhook.test', 'Send Test')}
                </button>
                {webhookDelivery.lastSuccessAtMs ? (
                  <span className="badge badge-green">
                    {t('settings.webhook.last_success', 'Last success: {{value}}', {
                      value: formatLocalizedDateTime(webhookDelivery.lastSuccessAtMs, language, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                    })}
                  </span>
                ) : null}
                {webhookDelivery.lastFailureAtMs ? (
                  <span className="badge badge-red">
                    {t('settings.webhook.last_failure', 'Last failure: {{value}}', {
                      value: webhookDelivery.lastFailureText,
                    })}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>
              {t('settings.section.diagnostics', 'Diagnostics + Scenario Notes')}
            </div>
            <div className="panel-2" style={{ padding: 12 }}>
              <div>
                {t('settings.snapshot_generated', 'Snapshot generated')}:{' '}
                {snapshot
                  ? formatLocalizedDateTime(snapshot.generatedAtMs, language, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '-'}
              </div>
              <div style={{ marginTop: 6 }}>
                {t('settings.event_teams', 'Event teams')}: {eventTeamRows.length || 0} |{' '}
                {t('settings.matches', 'Matches')}: {sortedMatches.length || 0}
              </div>
              <div style={{ marginTop: 6 }}>
                {t('settings.sb_matches', 'SB matches')}: {snapshot?.sb?.matches?.length ?? 0} |{' '}
                {t('settings.sb_team_events', 'SB team events')}:{' '}
                {snapshot?.sb?.teamEvents?.length ?? 0}
              </div>
              <div>
                {t('settings.notes.predict', 'PREDICT saves full projected ranking scenarios.')}
              </div>
              <div style={{ marginTop: 6 }}>
                {t('settings.notes.alliance', 'ALLIANCE loads live or saved projected orders.')}
              </div>
              <div style={{ marginTop: 6 }}>
                {t(
                  'settings.notes.playoff',
                  'PLAYOFF LAB compares alliance scenarios and manual winner choices.',
                )}
              </div>
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>
              {t('settings.section.preview', 'Semantic Color Preview')}
            </div>
            <div className="muted" style={{ marginBottom: 10 }}>
              {t(
                'settings.semantic.preview',
                'Use semantic color only when directionality is actually meaningful.',
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="badge dashboard-inline-chip tone-negative-strong">
                {t('settings.semantic.negative_strong', 'Strong negative')}
              </span>
              <span className="badge dashboard-inline-chip tone-negative-mild">
                {t('settings.semantic.negative_mild', 'Mild negative')}
              </span>
              <span className="badge dashboard-inline-chip tone-neutral">
                {t('settings.semantic.neutral', 'Neutral')}
              </span>
              <span className="badge dashboard-inline-chip tone-positive-mild">
                {t('settings.semantic.positive_mild', 'Mild positive')}
              </span>
              <span className="badge dashboard-inline-chip tone-positive-strong">
                {t('settings.semantic.positive_strong', 'Strong positive')}
              </span>
            </div>
          </div>
        </div>
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Live Integrations</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <span className="badge">{snapshot?.tba?.event ? 'TBA Working' : 'TBA Waiting'}</span>
              <span
                className={`badge ${sourceValidation ? sourceStatusBadgeClass(sourceValidation.firstStatus) : ''}`}
              >
                FIRST{' '}
                {sourceValidation ? sourceStatusLabel(sourceValidation.firstStatus) : 'Disabled'}
              </span>
              <span
                className={`badge ${nexusSnapshot ? sourceStatusBadgeClass(nexusSnapshot.status) : ''}`}
              >
                Nexus {nexusSnapshot ? sourceStatusLabel(nexusSnapshot.status) : 'Disabled'}
              </span>
              <span className="badge">
                Realtime {isSupabaseConfigured() ? 'Enabled' : 'Disabled'}
              </span>
              <span className="badge">Signals {liveSignals.length}</span>
            </div>
            <div className="stack-8">
              <div className="panel-2" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                  Current Event Workspace
                </div>
                <div className="mono">{activeWorkspaceKey || '-'}</div>
              </div>
              <div className="panel-2" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                  Validation Summary
                </div>
                <div style={{ fontWeight: 800 }}>
                  {sourceValidation?.summary ?? 'No validation snapshot yet'}
                </div>
                {firstErrorHint ? (
                  <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                    {firstErrorHint}
                  </div>
                ) : null}
              </div>
              <div className="grid-2">
                <div className="panel-2" style={{ padding: 12 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    Official Mismatches
                  </div>
                  <div style={{ fontWeight: 900 }}>{validationCounts.mismatch}</div>
                </div>
                <div className="panel-2" style={{ padding: 12 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    Missing Checks
                  </div>
                  <div style={{ fontWeight: 900 }}>{validationCounts.missing}</div>
                </div>
              </div>
              <div className="grid-2">
                <div className="panel-2" style={{ padding: 12 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    Official Event
                  </div>
                  <div style={{ fontWeight: 900 }}>
                    {officialCounts?.eventPresent ? 'Present' : 'Missing'}
                  </div>
                </div>
                <div className="panel-2" style={{ padding: 12 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    Official Counts
                  </div>
                  <div style={{ fontWeight: 900 }}>
                    R {officialCounts?.rankings ?? 0} | M {officialCounts?.matches ?? 0} | A{' '}
                    {officialCounts?.awards ?? 0}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Webhook + Collaboration</div>
            <div className="stack-8">
              <div className="panel-2" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                  TBA Webhook Receiver
                </div>
                <div className="mono">/api/webhook/tba</div>
                <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                  {lastLiveSignal
                    ? `Last signal ${lastLiveSignal.signalType} at ${formatLocalizedDateTime(
                        lastLiveSignal.createdAtMs,
                        language,
                        {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        },
                      )}`
                    : 'No live signal stored for this event yet.'}
                </div>
              </div>
              <div className="panel-2" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                  Event Media
                </div>
                <div style={{ fontWeight: 800 }}>
                  {preferredWebcast?.url ? 'Preferred webcast available' : 'No webcast surfaced'}
                </div>
              </div>
              <div className="panel-2" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                  Nexus Queue
                </div>
                <div style={{ fontWeight: 800 }}>
                  {nexusSnapshot?.queueText ?? 'No queue signal'}
                </div>
              </div>
              <div className="panel-2" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                  Webhook Signal Store
                </div>
                <div style={{ fontWeight: 800 }}>
                  {liveSignals.length
                    ? `${liveSignals.length} stored for this event`
                    : 'No stored signals yet'}
                </div>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Shared desk saves are event-scoped in Supabase. Realtime updates are designed for
                last-write-wins collaboration without bringing local-only persistence back.
              </div>
            </div>
          </div>
        </div>
        <DisclosureSection
          storageKey="ui.settings.diagnostics"
          title="Diagnostics Coverage"
          description="Route-health coverage, snapshot counts, and deeper troubleshooting tools."
        >
          <AnalyticsChartBlock
            title="Settings Diagnostics Coverage"
            description="Route-health and snapshot coverage stay in SETTINGS only."
            data={diagnosticsRows}
            chartFamily="bar"
            series={[{ key: 'value', label: 'Count', color: '#4bb3fd' }]}
            valueFormatter={(value) => fmt(value, 0)}
          />
        </DisclosureSection>
        {settingsRawPayloadOpen ? (
          <div className="panel" style={{ padding: 16 }}>
            <RawPayloadExplorer
              loadedEventKey={loadedEventKey}
              loadedTeam={loadedTeam}
              snapshot={snapshot}
            />
          </div>
        ) : null}
      </div>
    );
  }
  function renderDataTab(scope = 'current') {
    return (
      <DataSuperTab
        loadedEventKey={loadedEventKey}
        loadedTeam={loadedTeam}
        snapshot={snapshot}
        projectedRows={projectedRows}
        deterministicRows={deterministicRows}
        monteCarloProjection={monteCarloProjection}
        allianceRuntime={allianceRuntime}
        liveAllianceRuntime={liveAllianceRuntime}
        savedPlayoffResults={savedPlayoffResults}
        compareSyncKey={scope === 'historical' ? historicalCompareSyncKey : currentCompareSyncKey}
        scope={scope}
      />
    );
  }
  function renderDistrictTab(scope = 'current') {
    return (
      <DistrictPointsTab scope={scope} loadedEventKey={loadedEventKey} loadedTeam={loadedTeam} />
    );
  }
  function renderActiveContent() {
    if (majorTab === 'CURRENT' && currentSubTab === 'NOW') return renderNowTab();
    if (majorTab === 'CURRENT' && currentSubTab === 'SCHEDULE') return renderScheduleTab();
    if (majorTab === 'CURRENT' && currentSubTab === 'MATCH') return renderMatchTab();
    if (majorTab === 'CURRENT' && currentSubTab === 'STRATEGY')
      return <div className="strategy-print-root">{renderStrategyTab()}</div>;
    if (majorTab === 'CURRENT' && currentSubTab === 'GAME MANUAL') return <GameManualTab />;
    if (majorTab === 'CURRENT' && currentSubTab === 'DISTRICT') return renderDistrictTab('current');
    if (majorTab === 'CURRENT' && currentSubTab === 'COMPARE') return renderCompareTab('current');
    if (majorTab === 'CURRENT' && currentSubTab === 'TEAM_PROFILE')
      return renderTeamProfileTab('current');
    if (majorTab === 'CURRENT' && currentSubTab === 'RANKINGS') return renderRankingsTab();
    if (majorTab === 'CURRENT' && currentSubTab === 'PLAYOFFS') return renderPlayoffsTab();
    if (majorTab === 'CURRENT' && currentSubTab === 'EVENT')
      return <div className="event-print-root">{renderEventTab()}</div>;
    if (majorTab === 'CURRENT' && currentSubTab === 'DATA') return renderDataTab('current');

    if (majorTab === 'HISTORICAL' && historicalSubTab === 'PRE_EVENT')
      return renderPreEventScoutingTab('pre_event');
    if (majorTab === 'HISTORICAL' && historicalSubTab === 'STRATEGY')
      return renderHistoricalStrategyTab();
    if (majorTab === 'HISTORICAL' && historicalSubTab === 'DISTRICT')
      return renderDistrictTab('historical');
    if (majorTab === 'HISTORICAL' && historicalSubTab === 'COMPARE')
      return renderCompareTab('historical');
    if (majorTab === 'HISTORICAL' && historicalSubTab === 'TEAM_PROFILE')
      return renderTeamProfileTab('historical');
    if (majorTab === 'HISTORICAL' && historicalSubTab === 'RANKINGS')
      return renderPreEventScoutingTab('rankings');
    if (majorTab === 'HISTORICAL' && historicalSubTab === 'PLAYOFFS')
      return renderPreEventScoutingTab('playoffs');
    if (majorTab === 'HISTORICAL' && historicalSubTab === 'EVENT')
      return renderPreEventScoutingTab('event');
    if (majorTab === 'HISTORICAL' && historicalSubTab === 'DATA')
      return renderDataTab('historical');

    if (majorTab === 'PREDICT' && predictSubTab === 'PREDICT') return renderPredictTab();
    if (majorTab === 'PREDICT' && predictSubTab === 'ALLIANCE') return renderAllianceTab();
    if (majorTab === 'PREDICT' && predictSubTab === 'PLAYOFF_LAB') return renderPlayoffLabTab();
    if (majorTab === 'PREDICT' && predictSubTab === 'IMPACT') return renderImpactTab();
    if (majorTab === 'PREDICT' && predictSubTab === 'PICK_LIST') return renderPickListTab();
    if (majorTab === 'PREDICT' && predictSubTab === 'LIVE_ALLIANCE') return renderLiveAllianceTab();

    if (majorTab === 'SETTINGS') return renderSettingsTab();
    return null;
  }

  const pageHeaderStatus = [
    <span key="event" className="badge badge-blue">
      {t('field.event', 'Event')} {loadedEventKey || '-'}
    </span>,
    <span key="team" className="badge">
      {t('field.team', 'Team')} {loadedTeam ?? '-'}
    </span>,
    <span key="mode" className={`badge ${offlineMode ? 'badge-red' : 'badge-green'}`}>
      {offlineMode ? t('status.offline', 'Offline') : t('status.live', 'Live')}
    </span>,
    <span key="poll" className="badge">
      {t('field.poll', 'Poll {{value}}s', {
        value: Math.round(settings.pollMs / 1000),
      })}
    </span>,
    sourceValidation ? (
      <span
        key="official"
        className={`badge ${sourceStatusBadgeClass(sourceValidation.firstStatus)}`}
      >
        FIRST {sourceStatusLabel(sourceValidation.firstStatus)}
      </span>
    ) : null,
    nexusSnapshot ? (
      <span key="nexus" className={`badge ${sourceStatusBadgeClass(nexusSnapshot.status)}`}>
        Nexus {sourceStatusLabel(nexusSnapshot.status)}
      </span>
    ) : null,
    liveSignals.length ? (
      <span key="signals" className="badge">
        {t('field.signals', 'Signals')} {liveSignals.length}
      </span>
    ) : null,
  ];
  return (
    <DashboardPreferencesProvider language={language}>
      <main className="app-shell">
        <div className="dashboard-layout">
          {renderTabs()}
          <div className="dashboard-main">
            {renderTopControls()}
            {renderCommandPalette()}
            {showFloatingWebcast ? (
              <div className="webcast-floating-shell">
                <button
                  className="button webcast-floating-dismiss"
                  type="button"
                  aria-label="Exit PiP"
                  onClick={handleFloatingWebcastClose}
                >
                  X
                </button>
                <div className="panel webcast-floating-card">
                  <YouTubeWebcastPlayer
                    key={`floating-webcast-${loadedEventKey}-${preferredYouTubeVideoId}`}
                    webcast={preferredYouTubeWebcast}
                    eventKey={loadedEventKey}
                    eventName={currentEventName}
                    variant="floating"
                    initialTimeSeconds={webcastPlayerState.currentTime}
                    shouldAutoplay={
                      (webcastPlaybackContinuing || webcastPlayerState.floatingVisible) &&
                      !webcastPlaybackSuppressed
                    }
                    onSnapshotChange={handleWebcastSnapshotChange}
                  />
                </div>
              </div>
            ) : null}
            <div className="dashboard-content">
              <div className="dashboard-page">
                <PageHeader
                  eyebrow={localizedPageMeta.eyebrow}
                  title={localizedPageMeta.title}
                  description={localizedPageMeta.description}
                  templateLabel={localizedPageMeta.template}
                  statusItems={pageHeaderStatus}
                />
                <div
                  className={`dashboard-page-view page-template-${String(
                    activePageMeta.template ?? 'workbench',
                  ).toLowerCase()}`}
                >
                  {renderActiveContent()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </DashboardPreferencesProvider>
  );
}
