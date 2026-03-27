import {
  analyticsSafeNumber,
  collectCompareBreakdownKeys,
  humanizeCompareKey,
  rollingAverage,
} from './analytics';
import { formatLocalizedNumber, formatLocalizedPercent } from './product-preferences';
import type {
  AnalyticsChartFamily,
  AnalyticsMetricDefinition,
  AnalyticsScope,
  LanguageCode,
  CompareSeriesPoint,
  CompareTeamRow,
  RawMatrixField,
} from './types';

type LooseRecord = Record<string, any>;

type AnalyticsMetricFilters = {
  scopes?: AnalyticsScope[];
  tabs?: string[];
  chartFamily?: AnalyticsChartFamily | null;
};

type CompareSeriesChartMode = 'season_events' | 'season_matches' | 'event_matches';

type BreakdownMatrixRow = {
  teamNumber?: number | null;
  teamKey?: string | null;
  nickname?: string | null;
  values?: Record<string, unknown>;
};

export const ANALYTICS_METRIC_REGISTRY = {
  event_rank: {
    key: 'event_rank',
    label: 'Event Rank',
    shortLabel: 'Rank',
    scope: ['current_event', 'event_wide', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'rank',
    tabs: ['NOW', 'MATCH', 'TEAM_PROFILE', 'RANKINGS', 'EVENT', 'COMPARE', 'DATA'],
    color: '#f3be3b',
    semanticDirection: 'positive_when_lower',
  },
  event_total_rp: {
    key: 'event_total_rp',
    label: 'Event Total RP',
    shortLabel: 'Total RP',
    scope: ['current_event', 'event_wide', 'compare', 'scenario'],
    chartFamilies: ['bar', 'line', 'area'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: [
      'NOW',
      'MATCH',
      'TEAM_PROFILE',
      'RANKINGS',
      'EVENT',
      'PREDICT',
      'IMPACT',
      'COMPARE',
      'DATA',
    ],
    color: '#4bb3fd',
    semanticDirection: 'positive_when_higher',
  },
  event_rp_average: {
    key: 'event_rp_average',
    label: 'Event RP Average',
    shortLabel: 'RP Avg',
    scope: ['current_event', 'event_wide', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_2',
    tabs: ['RANKINGS', 'EVENT', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#60a5fa',
    semanticDirection: 'positive_when_higher',
  },
  event_epa: {
    key: 'event_epa',
    label: 'Event EPA',
    shortLabel: 'EPA',
    scope: ['current_event', 'event_wide', 'compare'],
    chartFamilies: ['bar', 'line', 'area'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['NOW', 'MATCH', 'TEAM_PROFILE', 'RANKINGS', 'EVENT', 'COMPARE', 'DATA'],
    color: '#ff9f68',
    semanticDirection: 'positive_when_higher',
  },
  event_auto: {
    key: 'event_auto',
    label: 'Event Auto EPA',
    shortLabel: 'Auto',
    scope: ['current_event', 'event_wide', 'compare'],
    chartFamilies: ['bar', 'line', 'area'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['MATCH', 'STRATEGY', 'TEAM_PROFILE', 'EVENT', 'COMPARE', 'DATA'],
    color: '#8ad17d',
    semanticDirection: 'positive_when_higher',
  },
  event_teleop: {
    key: 'event_teleop',
    label: 'Event Teleop EPA',
    shortLabel: 'Teleop',
    scope: ['current_event', 'event_wide', 'compare'],
    chartFamilies: ['bar', 'line', 'area'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['MATCH', 'STRATEGY', 'TEAM_PROFILE', 'EVENT', 'COMPARE', 'DATA'],
    color: '#2dd4bf',
    semanticDirection: 'positive_when_higher',
  },
  event_endgame: {
    key: 'event_endgame',
    label: 'Event Endgame EPA',
    shortLabel: 'Endgame',
    scope: ['current_event', 'event_wide', 'compare'],
    chartFamilies: ['bar', 'line', 'area'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['MATCH', 'STRATEGY', 'TEAM_PROFILE', 'EVENT', 'COMPARE', 'DATA'],
    color: '#c084fc',
    semanticDirection: 'positive_when_higher',
  },
  event_opr: {
    key: 'event_opr',
    label: 'Event OPR',
    shortLabel: 'OPR',
    scope: ['current_event', 'event_wide', 'compare'],
    chartFamilies: ['bar', 'line', 'area'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['NOW', 'MATCH', 'TEAM_PROFILE', 'RANKINGS', 'EVENT', 'COMPARE', 'DATA'],
    color: '#ff6b6b',
    semanticDirection: 'positive_when_higher',
  },
  event_copr: {
    key: 'event_copr',
    label: 'Event COPR',
    shortLabel: 'COPR',
    scope: ['current_event', 'event_wide', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['MATCH', 'STRATEGY', 'TEAM_PROFILE', 'EVENT', 'COMPARE', 'DATA'],
    color: '#f472b6',
    semanticDirection: 'positive_when_higher',
  },
  event_dpr: {
    key: 'event_dpr',
    label: 'Event DPR',
    shortLabel: 'DPR',
    scope: ['current_event', 'event_wide', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['MATCH', 'STRATEGY', 'TEAM_PROFILE', 'EVENT', 'COMPARE', 'DATA'],
    color: '#facc15',
    semanticDirection: 'positive_when_lower',
  },
  event_ccwm: {
    key: 'event_ccwm',
    label: 'Event CCWM',
    shortLabel: 'CCWM',
    scope: ['current_event', 'event_wide', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['MATCH', 'STRATEGY', 'TEAM_PROFILE', 'EVENT', 'COMPARE', 'DATA'],
    color: '#60a5fa',
    semanticDirection: 'positive_when_higher',
  },
  event_composite: {
    key: 'event_composite',
    label: 'Event Composite',
    shortLabel: 'Comp',
    scope: ['current_event', 'event_wide', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['RANKINGS', 'EVENT', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#f3be3b',
    semanticDirection: 'positive_when_higher',
  },
  event_sos: {
    key: 'event_sos',
    label: 'Event Total SOS',
    shortLabel: 'SOS',
    scope: ['current_event', 'event_wide', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['RANKINGS', 'EVENT', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#94a3b8',
  },
  event_played_sos: {
    key: 'event_played_sos',
    label: 'Event Played SOS',
    shortLabel: 'Played SOS',
    scope: ['current_event', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['RANKINGS', 'EVENT', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#64748b',
  },
  event_remaining_sos: {
    key: 'event_remaining_sos',
    label: 'Event Remaining SOS',
    shortLabel: 'Remain SOS',
    scope: ['current_event', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['RANKINGS', 'EVENT', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#475569',
  },
  event_match_count: {
    key: 'event_match_count',
    label: 'Event Match Count',
    shortLabel: 'Matches',
    scope: ['current_event', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'integer',
    tabs: ['NOW', 'MATCH', 'TEAM_PROFILE', 'RANKINGS', 'EVENT', 'COMPARE', 'DATA'],
    color: '#94a3b8',
  },
  event_delta_field_epa: {
    key: 'event_delta_field_epa',
    label: 'Delta Vs Field EPA',
    shortLabel: 'dEPA',
    scope: ['current_event', 'compare', 'event_wide'],
    chartFamilies: ['bar'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['NOW', 'MATCH', 'RANKINGS', 'EVENT', 'COMPARE', 'DATA'],
    color: '#fb7185',
    semanticDirection: 'positive_when_higher',
  },
  event_delta_field_opr: {
    key: 'event_delta_field_opr',
    label: 'Delta Vs Field OPR',
    shortLabel: 'dOPR',
    scope: ['current_event', 'compare', 'event_wide'],
    chartFamilies: ['bar'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['MATCH', 'RANKINGS', 'EVENT', 'COMPARE', 'DATA'],
    color: '#f97316',
    semanticDirection: 'positive_when_higher',
  },
  event_delta_field_composite: {
    key: 'event_delta_field_composite',
    label: 'Delta Vs Field Composite',
    shortLabel: 'dComp',
    scope: ['current_event', 'compare', 'event_wide'],
    chartFamilies: ['bar'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['RANKINGS', 'EVENT', 'COMPARE', 'DATA'],
    color: '#eab308',
    semanticDirection: 'positive_when_higher',
  },
  event_match_rp: {
    key: 'event_match_rp',
    label: 'Event Match RP',
    shortLabel: 'RP',
    scope: ['current_event', 'compare'],
    chartFamilies: ['line', 'step', 'bar'],
    defaultChartFamily: 'step',
    defaultSmoothingWindow: 1,
    format: 'number_1',
    tabs: ['NOW', 'MATCH', 'TEAM_PROFILE', 'PREDICT', 'IMPACT', 'COMPARE', 'DATA'],
    color: '#4bb3fd',
  },
  event_match_epa: {
    key: 'event_match_epa',
    label: 'Event Match EPA',
    shortLabel: 'EPA',
    scope: ['current_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 2,
    format: 'number_1',
    tabs: ['NOW', 'MATCH', 'TEAM_PROFILE', 'STRATEGY', 'COMPARE', 'DATA'],
    color: '#ff9f68',
  },
  event_match_auto: {
    key: 'event_match_auto',
    label: 'Event Match Auto',
    shortLabel: 'Auto',
    scope: ['current_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 2,
    format: 'number_1',
    tabs: ['MATCH', 'STRATEGY', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#8ad17d',
  },
  event_match_teleop: {
    key: 'event_match_teleop',
    label: 'Event Match Teleop',
    shortLabel: 'Teleop',
    scope: ['current_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 2,
    format: 'number_1',
    tabs: ['MATCH', 'STRATEGY', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#2dd4bf',
  },
  event_match_endgame: {
    key: 'event_match_endgame',
    label: 'Event Match Endgame',
    shortLabel: 'Endgame',
    scope: ['current_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 2,
    format: 'number_1',
    tabs: ['MATCH', 'STRATEGY', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#c084fc',
  },
  event_match_my_score: {
    key: 'event_match_my_score',
    label: 'Event Match Score',
    shortLabel: 'Score',
    scope: ['current_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 2,
    format: 'number_1',
    tabs: ['NOW', 'MATCH', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#ff6b6b',
  },
  event_match_opp_score: {
    key: 'event_match_opp_score',
    label: 'Event Opp Score',
    shortLabel: 'Opp',
    scope: ['current_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 2,
    format: 'number_1',
    tabs: ['MATCH', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#94a3b8',
  },
  event_match_margin: {
    key: 'event_match_margin',
    label: 'Event Match Margin',
    shortLabel: 'Margin',
    scope: ['current_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'bar',
    defaultSmoothingWindow: 2,
    format: 'number_1',
    tabs: ['MATCH', 'TEAM_PROFILE', 'IMPACT', 'COMPARE', 'DATA'],
    color: '#facc15',
  },
  event_match_rolling_opr: {
    key: 'event_match_rolling_opr',
    label: 'Rolling OPR',
    shortLabel: 'rOPR',
    scope: ['current_event', 'compare'],
    chartFamilies: ['line', 'step'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 1,
    format: 'number_1',
    tabs: ['NOW', 'MATCH', 'TEAM_PROFILE', 'STRATEGY', 'COMPARE', 'DATA'],
    color: '#f97316',
  },
  event_match_rolling_dpr: {
    key: 'event_match_rolling_dpr',
    label: 'Rolling DPR',
    shortLabel: 'rDPR',
    scope: ['current_event', 'compare'],
    chartFamilies: ['line', 'step'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 1,
    format: 'number_1',
    tabs: ['MATCH', 'TEAM_PROFILE', 'STRATEGY', 'COMPARE', 'DATA'],
    color: '#fbbf24',
  },
  event_match_rolling_ccwm: {
    key: 'event_match_rolling_ccwm',
    label: 'Rolling CCWM',
    shortLabel: 'rCCWM',
    scope: ['current_event', 'compare'],
    chartFamilies: ['line', 'step'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 1,
    format: 'number_1',
    tabs: ['MATCH', 'TEAM_PROFILE', 'STRATEGY', 'COMPARE', 'DATA'],
    color: '#60a5fa',
  },
  event_match_rolling_copr: {
    key: 'event_match_rolling_copr',
    label: 'Rolling COPR',
    shortLabel: 'rCOPR',
    scope: ['current_event', 'compare'],
    chartFamilies: ['line', 'step'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 1,
    format: 'number_1',
    tabs: ['MATCH', 'TEAM_PROFILE', 'STRATEGY', 'COMPARE', 'DATA'],
    color: '#ec4899',
  },
  season_current_epa: {
    key: 'season_current_epa',
    label: 'Historical Current EPA',
    shortLabel: 'Hist EPA',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['NOW', 'MATCH', 'TEAM_PROFILE', 'PRE_EVENT', 'COMPARE', 'DATA'],
    color: '#ff9f68',
    semanticDirection: 'positive_when_higher',
  },
  season_mean_total: {
    key: 'season_mean_total',
    label: 'Historical Mean Total',
    shortLabel: 'Hist Mean',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['TEAM_PROFILE', 'PRE_EVENT', 'COMPARE', 'DATA'],
    color: '#4bb3fd',
  },
  season_district_points: {
    key: 'season_district_points',
    label: 'Historical District Points',
    shortLabel: 'District Pts',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['PRE_EVENT', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#8ad17d',
    semanticDirection: 'positive_when_higher',
  },
  season_auto: {
    key: 'season_auto',
    label: 'Historical Auto EPA',
    shortLabel: 'Hist Auto',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['PRE_EVENT', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#8ad17d',
  },
  season_teleop: {
    key: 'season_teleop',
    label: 'Historical Teleop EPA',
    shortLabel: 'Hist Teleop',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['PRE_EVENT', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#2dd4bf',
  },
  season_endgame: {
    key: 'season_endgame',
    label: 'Historical Endgame EPA',
    shortLabel: 'Hist Endgame',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['PRE_EVENT', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#c084fc',
  },
  season_world_rank: {
    key: 'season_world_rank',
    label: 'Historical World Rank',
    shortLabel: 'World Rank',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'rank',
    tabs: ['PRE_EVENT', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#f3be3b',
  },
  season_country_percentile: {
    key: 'season_country_percentile',
    label: 'Historical Country Percentile',
    shortLabel: 'Country %',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'percent',
    tabs: ['PRE_EVENT', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#60a5fa',
  },
  season_district_percentile: {
    key: 'season_district_percentile',
    label: 'Historical District Percentile',
    shortLabel: 'District %',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'percent',
    tabs: ['PRE_EVENT', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#22c55e',
  },
  season_win_rate: {
    key: 'season_win_rate',
    label: 'Historical Win Rate',
    shortLabel: 'Hist Win %',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'percent',
    tabs: ['PRE_EVENT', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#38bdf8',
  },
  season_match_count: {
    key: 'season_match_count',
    label: 'Historical Match Count',
    shortLabel: 'Hist Matches',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'integer',
    tabs: ['PRE_EVENT', 'TEAM_PROFILE', 'COMPARE', 'DATA'],
    color: '#94a3b8',
  },
  season_event_epa: {
    key: 'season_event_epa',
    label: 'Historical Event EPA',
    shortLabel: 'Hist Event EPA',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 1,
    format: 'number_1',
    tabs: ['TEAM_PROFILE', 'PRE_EVENT', 'COMPARE', 'DATA'],
    color: '#ff9f68',
  },
  season_event_district_points: {
    key: 'season_event_district_points',
    label: 'Historical District Points',
    shortLabel: 'Hist Dist Pts',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'bar',
    defaultSmoothingWindow: 1,
    format: 'number_1',
    tabs: ['TEAM_PROFILE', 'PRE_EVENT', 'COMPARE', 'DATA'],
    color: '#8ad17d',
  },
  season_event_qual_rank: {
    key: 'season_event_qual_rank',
    label: 'Historical Event Qual Rank',
    shortLabel: 'Hist Rank',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['line', 'bar'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 1,
    format: 'rank',
    tabs: ['TEAM_PROFILE', 'PRE_EVENT', 'COMPARE', 'DATA'],
    color: '#f3be3b',
  },
  season_event_win_rate: {
    key: 'season_event_win_rate',
    label: 'Historical Event Win Rate',
    shortLabel: 'Hist Win %',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 1,
    format: 'percent',
    tabs: ['TEAM_PROFILE', 'PRE_EVENT', 'COMPARE', 'DATA'],
    color: '#2dd4bf',
  },
  season_event_match_count: {
    key: 'season_event_match_count',
    label: 'Historical Event Match Count',
    shortLabel: 'Hist MC',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['line', 'bar'],
    defaultChartFamily: 'bar',
    defaultSmoothingWindow: 1,
    format: 'integer',
    tabs: ['TEAM_PROFILE', 'PRE_EVENT', 'COMPARE', 'DATA'],
    color: '#94a3b8',
  },
  season_match_epa: {
    key: 'season_match_epa',
    label: 'Historical Match EPA',
    shortLabel: 'Hist EPA',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 3,
    format: 'number_1',
    tabs: ['NOW', 'MATCH', 'TEAM_PROFILE', 'PRE_EVENT', 'COMPARE', 'DATA'],
    color: '#ff9f68',
  },
  season_match_auto: {
    key: 'season_match_auto',
    label: 'Historical Match Auto',
    shortLabel: 'Hist Auto',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 3,
    format: 'number_1',
    tabs: ['MATCH', 'TEAM_PROFILE', 'PRE_EVENT', 'COMPARE', 'DATA'],
    color: '#8ad17d',
  },
  season_match_teleop: {
    key: 'season_match_teleop',
    label: 'Historical Match Teleop',
    shortLabel: 'Hist Teleop',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 3,
    format: 'number_1',
    tabs: ['MATCH', 'TEAM_PROFILE', 'PRE_EVENT', 'COMPARE', 'DATA'],
    color: '#2dd4bf',
  },
  season_match_endgame: {
    key: 'season_match_endgame',
    label: 'Historical Match Endgame',
    shortLabel: 'Hist Endgame',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 3,
    format: 'number_1',
    tabs: ['MATCH', 'TEAM_PROFILE', 'PRE_EVENT', 'COMPARE', 'DATA'],
    color: '#c084fc',
  },
  season_match_my_score: {
    key: 'season_match_my_score',
    label: 'Historical Match Score',
    shortLabel: 'Hist Score',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 3,
    format: 'number_1',
    tabs: ['MATCH', 'TEAM_PROFILE', 'PRE_EVENT', 'COMPARE', 'DATA'],
    color: '#ff6b6b',
  },
  season_match_opp_score: {
    key: 'season_match_opp_score',
    label: 'Historical Opp Score',
    shortLabel: 'Hist Opp',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'line',
    defaultSmoothingWindow: 3,
    format: 'number_1',
    tabs: ['MATCH', 'TEAM_PROFILE', 'PRE_EVENT', 'COMPARE', 'DATA'],
    color: '#94a3b8',
  },
  season_match_margin: {
    key: 'season_match_margin',
    label: 'Historical Match Margin',
    shortLabel: 'Hist Margin',
    scope: ['historical_2026_excluding_loaded_event', 'compare'],
    chartFamilies: ['line', 'bar', 'area'],
    defaultChartFamily: 'bar',
    defaultSmoothingWindow: 3,
    format: 'number_1',
    tabs: ['MATCH', 'TEAM_PROFILE', 'PRE_EVENT', 'COMPARE', 'DATA'],
    color: '#facc15',
  },
  scenario_projected_rank: {
    key: 'scenario_projected_rank',
    label: 'Projected Rank',
    shortLabel: 'Proj Rank',
    scope: ['scenario'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'rank',
    tabs: ['PREDICT', 'DATA'],
    color: '#f3be3b',
  },
  scenario_projected_total_rp: {
    key: 'scenario_projected_total_rp',
    label: 'Projected Total RP',
    shortLabel: 'Proj Total RP',
    scope: ['scenario'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['PREDICT', 'IMPACT', 'DATA'],
    color: '#4bb3fd',
  },
  scenario_deterministic_total_rp: {
    key: 'scenario_deterministic_total_rp',
    label: 'Deterministic Total RP',
    shortLabel: 'Det RP',
    scope: ['scenario'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['PREDICT', 'DATA'],
    color: '#f97316',
  },
  scenario_mc_avg_rank: {
    key: 'scenario_mc_avg_rank',
    label: 'Monte Carlo Avg Rank',
    shortLabel: 'MC Avg Rank',
    scope: ['scenario'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_2',
    tabs: ['PREDICT', 'DATA'],
    color: '#ff9f68',
    semanticDirection: 'positive_when_lower',
  },
  scenario_mc_avg_total_rp: {
    key: 'scenario_mc_avg_total_rp',
    label: 'Monte Carlo Avg Total RP',
    shortLabel: 'MC Avg RP',
    scope: ['scenario'],
    chartFamilies: ['bar', 'line'],
    defaultChartFamily: 'bar',
    format: 'number_1',
    tabs: ['PREDICT', 'DATA'],
    color: '#8ad17d',
    semanticDirection: 'positive_when_higher',
  },
  scenario_mc_top1: {
    key: 'scenario_mc_top1',
    label: 'Monte Carlo Top-1 Probability',
    shortLabel: 'MC Top1',
    scope: ['scenario'],
    chartFamilies: ['bar'],
    defaultChartFamily: 'bar',
    format: 'percent',
    tabs: ['PREDICT', 'DATA'],
    color: '#f3be3b',
    semanticDirection: 'positive_when_higher',
  },
  scenario_mc_top4: {
    key: 'scenario_mc_top4',
    label: 'Monte Carlo Top-4 Probability',
    shortLabel: 'MC Top4',
    scope: ['scenario'],
    chartFamilies: ['bar'],
    defaultChartFamily: 'bar',
    format: 'percent',
    tabs: ['PREDICT', 'DATA'],
    color: '#2dd4bf',
    semanticDirection: 'positive_when_higher',
  },
  scenario_mc_top8: {
    key: 'scenario_mc_top8',
    label: 'Monte Carlo Top-8 Probability',
    shortLabel: 'MC Top8',
    scope: ['scenario'],
    chartFamilies: ['bar'],
    defaultChartFamily: 'bar',
    format: 'percent',
    tabs: ['PREDICT', 'DATA'],
    color: '#c084fc',
    semanticDirection: 'positive_when_higher',
  },
} satisfies Record<string, AnalyticsMetricDefinition>;

export function getAnalyticsMetric(metricKey: string): AnalyticsMetricDefinition | null {
  const registry: Record<string, AnalyticsMetricDefinition> = ANALYTICS_METRIC_REGISTRY;
  return registry[metricKey] ?? null;
}
export function listAnalyticsMetrics(
  filters: AnalyticsMetricFilters = {},
): AnalyticsMetricDefinition[] {
  const { scopes = [], tabs = [], chartFamily = null } = filters;
  return Object.values(ANALYTICS_METRIC_REGISTRY).filter((metric) => {
    if (scopes.length && !metric.scope.some((scope) => scopes.includes(scope))) return false;
    if (tabs.length && metric.tabs?.length && !metric.tabs.some((tab) => tabs.includes(tab)))
      return false;
    if (chartFamily && !metric.chartFamilies.some((family) => family === chartFamily)) return false;
    return true;
  });
}
export function formatAnalyticsMetricValue(
  metricKey: string,
  value: unknown,
  language?: LanguageCode,
): string {
  const resolvedLanguage =
    language ??
    (typeof document !== 'undefined'
      ? ((document.documentElement.lang || 'en').slice(0, 2) as LanguageCode)
      : 'en');
  const metric = getAnalyticsMetric(metricKey);
  const parsed = Number(value);
  if (!metric) return value == null ? '-' : String(value);
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '-';
  if (metric.format === 'text') return String(value);
  if (!Number.isFinite(parsed)) return '-';
  if (metric.format === 'number_1')
    return formatLocalizedNumber(parsed, resolvedLanguage, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  if (metric.format === 'number_2')
    return formatLocalizedNumber(parsed, resolvedLanguage, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  if (metric.format === 'integer')
    return formatLocalizedNumber(Math.round(parsed), resolvedLanguage, {
      maximumFractionDigits: 0,
    });
  if (metric.format === 'percent') return formatLocalizedPercent(parsed, resolvedLanguage, 0);
  if (metric.format === 'rank')
    return formatLocalizedNumber(Math.round(parsed), resolvedLanguage, {
      maximumFractionDigits: 0,
    });
  return String(value);
}
export function eventMetricValue(
  row: LooseRecord | null | undefined,
  metricKey: string,
): number | null {
  if (!row) return null;
  if (metricKey === 'event_rank') return analyticsSafeNumber(row?.rank);
  if (metricKey === 'event_total_rp') return analyticsSafeNumber(row?.totalRp);
  if (metricKey === 'event_rp_average') return analyticsSafeNumber(row?.rpAverage);
  if (metricKey === 'event_epa') return analyticsSafeNumber(row?.overallEpa);
  if (metricKey === 'event_auto') return analyticsSafeNumber(row?.autoEpa);
  if (metricKey === 'event_teleop') return analyticsSafeNumber(row?.teleopEpa);
  if (metricKey === 'event_endgame') return analyticsSafeNumber(row?.endgameEpa);
  if (metricKey === 'event_opr') return analyticsSafeNumber(row?.opr);
  if (metricKey === 'event_copr') return analyticsSafeNumber(row?.copr);
  if (metricKey === 'event_dpr') return analyticsSafeNumber(row?.dpr);
  if (metricKey === 'event_ccwm') return analyticsSafeNumber(row?.ccwm);
  if (metricKey === 'event_composite') return analyticsSafeNumber(row?.composite);
  if (metricKey === 'event_played_sos') return analyticsSafeNumber(row?.playedSos);
  if (metricKey === 'event_remaining_sos') return analyticsSafeNumber(row?.remainingSos);
  if (metricKey === 'event_sos') return analyticsSafeNumber(row?.totalSos);
  if (metricKey === 'event_match_count') return analyticsSafeNumber(row?.matchesPlayed);
  if (metricKey === 'event_delta_field_epa')
    return analyticsSafeNumber(row?.deltaVsFieldEpa ?? row?.derived?.deltaVsFieldEpa);
  if (metricKey === 'event_delta_field_opr')
    return analyticsSafeNumber(row?.deltaVsFieldOpr ?? row?.derived?.deltaVsFieldOpr);
  if (metricKey === 'event_delta_field_composite')
    return analyticsSafeNumber(row?.deltaVsFieldComposite ?? row?.derived?.deltaVsFieldComposite);
  return null;
}
export function derivedMetricValue(
  team: CompareTeamRow | null | undefined,
  metricKey: string,
): number | null {
  if (!team) return null;
  const derived = team?.derived ?? {};
  if (metricKey === 'season_current_epa') return analyticsSafeNumber(derived?.seasonCurrentEpa);
  if (metricKey === 'season_mean_total') return analyticsSafeNumber(derived?.seasonMeanTotal);
  if (metricKey === 'season_district_points')
    return analyticsSafeNumber(derived?.seasonDistrictPoints);
  if (metricKey === 'season_auto') return analyticsSafeNumber(derived?.seasonAuto);
  if (metricKey === 'season_teleop') return analyticsSafeNumber(derived?.seasonTeleop);
  if (metricKey === 'season_endgame') return analyticsSafeNumber(derived?.seasonEndgame);
  if (metricKey === 'season_world_rank') return analyticsSafeNumber(derived?.seasonWorldRank);
  if (metricKey === 'season_country_percentile')
    return analyticsSafeNumber(derived?.seasonCountryPercentile);
  if (metricKey === 'season_district_percentile')
    return analyticsSafeNumber(derived?.seasonDistrictPercentile);
  if (metricKey === 'season_win_rate') return analyticsSafeNumber(derived?.seasonWinRate);
  if (metricKey === 'season_match_count') return analyticsSafeNumber(derived?.seasonMatchCount);
  if (metricKey.startsWith('event_')) {
    if (metricKey === 'event_rank')
      return analyticsSafeNumber(derived?.eventRank ?? team?.eventRow?.rank);
    if (metricKey === 'event_total_rp')
      return analyticsSafeNumber(derived?.eventTotalRp ?? team?.eventRow?.totalRp);
    if (metricKey === 'event_rp_average')
      return analyticsSafeNumber(derived?.eventRpAverage ?? team?.eventRow?.rpAverage);
    if (metricKey === 'event_epa')
      return analyticsSafeNumber(derived?.eventEpa ?? team?.eventRow?.overallEpa);
    if (metricKey === 'event_auto')
      return analyticsSafeNumber(derived?.eventAuto ?? team?.eventRow?.autoEpa);
    if (metricKey === 'event_teleop')
      return analyticsSafeNumber(derived?.eventTeleop ?? team?.eventRow?.teleopEpa);
    if (metricKey === 'event_endgame')
      return analyticsSafeNumber(derived?.eventEndgame ?? team?.eventRow?.endgameEpa);
    if (metricKey === 'event_opr')
      return analyticsSafeNumber(derived?.eventOpr ?? team?.eventRow?.opr);
    if (metricKey === 'event_copr')
      return analyticsSafeNumber(derived?.eventCopr ?? team?.eventRow?.copr);
    if (metricKey === 'event_dpr')
      return analyticsSafeNumber(derived?.eventDpr ?? team?.eventRow?.dpr);
    if (metricKey === 'event_ccwm')
      return analyticsSafeNumber(derived?.eventCcwm ?? team?.eventRow?.ccwm);
    if (metricKey === 'event_composite')
      return analyticsSafeNumber(derived?.eventComposite ?? team?.eventRow?.composite);
    if (metricKey === 'event_played_sos')
      return analyticsSafeNumber(derived?.eventPlayedSos ?? team?.eventRow?.playedSos);
    if (metricKey === 'event_remaining_sos')
      return analyticsSafeNumber(derived?.eventRemainingSos ?? team?.eventRow?.remainingSos);
    if (metricKey === 'event_sos')
      return analyticsSafeNumber(derived?.eventTotalSos ?? team?.eventRow?.totalSos);
    if (metricKey === 'event_match_count')
      return analyticsSafeNumber(derived?.eventMatchCount ?? team?.eventRow?.matchesPlayed);
    if (metricKey === 'event_delta_field_epa') return analyticsSafeNumber(derived?.deltaVsFieldEpa);
    if (metricKey === 'event_delta_field_opr') return analyticsSafeNumber(derived?.deltaVsFieldOpr);
    if (metricKey === 'event_delta_field_composite')
      return analyticsSafeNumber(derived?.deltaVsFieldComposite);
  }
  return null;
}
export function seasonEventMetricValue(
  eventRow: LooseRecord | null | undefined,
  metricKey: string,
): number | null {
  if (metricKey === 'season_event_epa') return analyticsSafeNumber(eventRow?.epa?.norm);
  if (metricKey === 'season_event_district_points')
    return analyticsSafeNumber(eventRow?.district_points);
  if (metricKey === 'season_event_qual_rank')
    return analyticsSafeNumber(eventRow?.record?.qual?.rank);
  if (metricKey === 'season_event_win_rate') {
    const qual = eventRow?.record?.qual ?? {};
    const elim = eventRow?.record?.elim ?? {};
    const wins = Number(qual?.wins ?? 0) + Number(elim?.wins ?? 0);
    const count = Number(qual?.count ?? 0) + Number(elim?.count ?? 0);
    return count > 0 ? wins / count : null;
  }
  if (metricKey === 'season_event_match_count') {
    const qual = eventRow?.record?.qual ?? {};
    const elim = eventRow?.record?.elim ?? {};
    return Number(qual?.count ?? 0) + Number(elim?.count ?? 0);
  }
  return null;
}
export function seasonMatchMetricValue(
  matchRow: LooseRecord | null | undefined,
  metricKey: string,
): number | null {
  if (metricKey === 'season_match_epa') return analyticsSafeNumber(matchRow?.epaTotal);
  if (metricKey === 'season_match_auto')
    return analyticsSafeNumber(matchRow?.breakdown?.auto_points);
  if (metricKey === 'season_match_teleop')
    return analyticsSafeNumber(matchRow?.breakdown?.teleop_points);
  if (metricKey === 'season_match_endgame')
    return analyticsSafeNumber(matchRow?.breakdown?.endgame_points);
  if (metricKey === 'season_match_margin') return analyticsSafeNumber(matchRow?.margin);
  if (metricKey === 'season_match_my_score') return analyticsSafeNumber(matchRow?.myScore);
  if (metricKey === 'season_match_opp_score') return analyticsSafeNumber(matchRow?.oppScore);
  return null;
}
export function eventMatchMetricValue(
  matchRow: LooseRecord | null | undefined,
  metricKey: string,
): number | null {
  if (metricKey === 'event_match_epa') return analyticsSafeNumber(matchRow?.epaTotal);
  if (metricKey === 'event_match_auto')
    return analyticsSafeNumber(matchRow?.breakdown?.auto_points);
  if (metricKey === 'event_match_teleop')
    return analyticsSafeNumber(matchRow?.breakdown?.teleop_points);
  if (metricKey === 'event_match_endgame')
    return analyticsSafeNumber(matchRow?.breakdown?.endgame_points);
  if (metricKey === 'event_match_margin') return analyticsSafeNumber(matchRow?.margin);
  if (metricKey === 'event_match_my_score') return analyticsSafeNumber(matchRow?.myScore);
  if (metricKey === 'event_match_opp_score') return analyticsSafeNumber(matchRow?.oppScore);
  if (metricKey === 'event_match_rp') return analyticsSafeNumber(matchRow?.rp);
  if (metricKey === 'event_match_rolling_opr') return analyticsSafeNumber(matchRow?.rollingOpr);
  if (metricKey === 'event_match_rolling_dpr') return analyticsSafeNumber(matchRow?.rollingDpr);
  if (metricKey === 'event_match_rolling_ccwm') return analyticsSafeNumber(matchRow?.rollingCcwm);
  if (metricKey === 'event_match_rolling_copr') return analyticsSafeNumber(matchRow?.rollingCopr);
  return null;
}
export function buildCompareSeriesPoints(
  team: CompareTeamRow | null | undefined,
  chartMode: CompareSeriesChartMode,
  metricKey: string,
  smoothingWindow = 1,
): (CompareSeriesPoint & { smoothedValue?: number | null; meta?: LooseRecord | null })[] {
  let rawPoints: (CompareSeriesPoint & { meta?: LooseRecord | null })[] = [];
  const teamKey = team?.teamKey ?? '';
  const teamNumber = team?.teamNumber ?? 0;
  if (chartMode === 'season_events') {
    rawPoints = (team?.historicalSeasonEvents ?? team?.seasonEvents ?? []).map(
      (eventRow: LooseRecord, index: number) => ({
        index: index + 1,
        teamKey,
        teamNumber,
        label: eventRow?.event_name ?? eventRow?.event ?? `Event ${index + 1}`,
        value: seasonEventMetricValue(eventRow, metricKey),
        time: analyticsSafeNumber(eventRow?.time),
        eventKey: eventRow?.event ?? null,
        meta: eventRow,
      }),
    );
  } else if (chartMode === 'season_matches') {
    rawPoints = (team?.historicalMatches ?? team?.seasonMatches ?? []).map(
      (matchRow: LooseRecord, index: number) => ({
        index: index + 1,
        teamKey,
        teamNumber,
        label:
          `${matchRow?.eventName ?? matchRow?.eventKey ?? ''} ${matchRow?.matchLabel ?? `M${index + 1}`}`.trim(),
        value: seasonMatchMetricValue(matchRow, metricKey),
        time: analyticsSafeNumber(matchRow?.time),
        eventKey: matchRow?.eventKey ?? null,
        matchKey: matchRow?.key ?? null,
        meta: matchRow,
      }),
    );
  } else {
    rawPoints = (team?.eventMatches ?? []).map((matchRow: LooseRecord, index: number) => ({
      index: index + 1,
      teamKey,
      teamNumber,
      label: matchRow?.matchLabel ?? `Match ${index + 1}`,
      value: eventMatchMetricValue(matchRow, metricKey),
      time: analyticsSafeNumber(matchRow?.time),
      eventKey: matchRow?.eventKey ?? null,
      matchKey: matchRow?.key ?? null,
      meta: matchRow,
    }));
  }
  const smoothed = rollingAverage(
    rawPoints.map((point) => point.value),
    smoothingWindow,
  );
  return rawPoints.map((point, index) => ({
    ...point,
    smoothedValue: smoothed[index] ?? point.value,
  }));
}
export function buildBreakdownMatrixFields(
  compareTeams: CompareTeamRow[] | null | undefined,
  source: 'season' | 'event',
): RawMatrixField[] {
  if (source === 'season') {
    const keys = new Set<string>();
    for (const row of compareTeams ?? []) {
      const seasonEpa = (row?.seasonSummary?.epa as LooseRecord | undefined) ?? {};
      Object.keys((seasonEpa.breakdown as LooseRecord | undefined) ?? {}).forEach((key) =>
        keys.add(key),
      );
    }
    return [...keys]
      .sort((a, b) => a.localeCompare(b))
      .map((key) => ({
        key,
        label: humanizeCompareKey(key),
        source,
      }));
  }
  return collectCompareBreakdownKeys(compareTeams ?? []).map((key) => ({
    key,
    label: humanizeCompareKey(key),
    source,
  }));
}
export function buildBreakdownMatrixRows(
  compareTeams: CompareTeamRow[] | null | undefined,
  source: 'season' | 'event',
): BreakdownMatrixRow[] {
  return (compareTeams ?? []).map((team) => ({
    teamNumber: team?.teamNumber,
    teamKey: team?.teamKey,
    nickname: team?.nickname,
    values: (() => {
      if (source === 'season') {
        const seasonEpa = (team?.seasonSummary?.epa as LooseRecord | undefined) ?? {};
        return { ...((seasonEpa.breakdown as LooseRecord | undefined) ?? {}) };
      }
      const latestBreakdown =
        (team?.eventMatches?.[team?.eventMatches?.length - 1]?.breakdown as
          | LooseRecord
          | undefined) ??
        (team?.eventMatches?.[0]?.breakdown as LooseRecord | undefined) ??
        {};
      return { ...latestBreakdown };
    })(),
  }));
}
export function scenarioMetricValue(
  row: LooseRecord | null | undefined,
  metricKey: string,
): number | null {
  if (!row) return null;
  if (metricKey === 'scenario_projected_rank')
    return analyticsSafeNumber(
      row?.projectedRank ?? row?.deterministicRank ?? row?.simRank ?? row?.mcAvgRank,
    );
  if (metricKey === 'scenario_projected_total_rp')
    return analyticsSafeNumber(
      row?.projectedTotalRp ?? row?.deterministicTotalRp ?? row?.simTotalRp,
    );
  if (metricKey === 'scenario_deterministic_total_rp')
    return analyticsSafeNumber(row?.deterministicTotalRp);
  if (metricKey === 'scenario_mc_avg_rank') return analyticsSafeNumber(row?.mcAvgRank);
  if (metricKey === 'scenario_mc_avg_total_rp') return analyticsSafeNumber(row?.mcAvgTotalRp);
  if (metricKey === 'scenario_mc_top1') return analyticsSafeNumber(row?.mcTop1);
  if (metricKey === 'scenario_mc_top4') return analyticsSafeNumber(row?.mcTop4);
  if (metricKey === 'scenario_mc_top8') return analyticsSafeNumber(row?.mcTop8);
  return null;
}
