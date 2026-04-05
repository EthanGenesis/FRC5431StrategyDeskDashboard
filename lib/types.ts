export type AllianceColor = 'red' | 'blue';

export type ExternalRecord = Record<string, unknown>;
export type ExternalArray = ExternalRecord[];

export type MatchSimple = {
  key: string;
  comp_level: 'qm' | 'ef' | 'qf' | 'sf' | 'f';
  set_number: number;
  match_number: number;
  alliances: {
    red: {
      team_keys: string[];
      score?: number;
    };
    blue: {
      team_keys: string[];
      score?: number;
    };
  };
  winning_alliance?: 'red' | 'blue' | '';
  time: number | null;
  predicted_time: number | null;
  actual_time: number | null;
  post_result_time?: number | null;
  score_breakdown?: Record<string, unknown> | null;
  videos?: ExternalArray | null;
};

export type EventMediaEntry = {
  type: string;
  channel: string;
  file: string | null;
  url: string | null;
  embedUrl: string | null;
};

export type EventMediaSnapshot = {
  preferredWebcastUrl: string | null;
  webcasts: EventMediaEntry[];
  media: ExternalArray;
};

export type SourceStatus = 'available' | 'disabled' | 'unsupported' | 'error' | 'partial';

export type SourceDiscrepancy = {
  key: string;
  label: string;
  status: 'match' | 'mismatch' | 'missing';
  workingValue: string | null;
  officialValue: string | null;
  detail: string | null;
};

export type ValidationSnapshot = {
  generatedAtMs: number;
  firstStatus: SourceStatus;
  nexusStatus: SourceStatus;
  officialAvailability: 'unavailable' | 'partial' | 'full';
  officialCounts: {
    eventPresent: boolean;
    rankings: number;
    matches: number;
    awards: number;
  };
  discrepancies: SourceDiscrepancy[];
  staleSeconds: number | null;
  officialTimestamp: string | null;
  summary: string;
};

export type NexusAnnouncement = {
  id: string;
  title: string;
  body: string;
  createdAtMs: number | null;
};

export type NexusPartsRequest = {
  id: string;
  teamNumber: number | null;
  pitId: string | null;
  text: string;
  status: string | null;
};

export type NexusInspectionSummary = {
  passed: number | null;
  pending: number | null;
  failed: number | null;
};

export type NexusMatchTimes = {
  estimatedQueueTimeMs: number | null;
  estimatedOnDeckTimeMs: number | null;
  estimatedOnFieldTimeMs: number | null;
  estimatedStartTimeMs: number | null;
  actualQueueTimeMs: number | null;
  actualOnDeckTimeMs: number | null;
  actualOnFieldTimeMs: number | null;
  actualStartTimeMs: number | null;
};

export type NexusMatchStatus = {
  label: string;
  status: string;
  redTeams: number[];
  blueTeams: number[];
  times: NexusMatchTimes;
};

export type NexusTeamOps = {
  teamNumber: number;
  pitAddress: string | null;
  inspectionStatus: string | null;
  currentMatchLabel: string | null;
  nextMatchLabel: string | null;
  queueState: string | null;
  allianceColor: AllianceColor | null;
  bumperColor: string | null;
  queueMatchesAway: number | null;
  partsRequestCount: number;
  estimatedQueueTimeMs: number | null;
  estimatedOnDeckTimeMs: number | null;
  estimatedOnFieldTimeMs: number | null;
  estimatedStartTimeMs: number | null;
  actualQueueTimeMs: number | null;
  actualOnDeckTimeMs: number | null;
  actualOnFieldTimeMs: number | null;
  actualStartTimeMs: number | null;
};

export type NexusOpsSnapshot = {
  supported: boolean;
  status: SourceStatus;
  currentMatchKey: string | null;
  nextMatchKey: string | null;
  queueMatchesAway: number | null;
  queueText: string | null;
  pitMapUrl: string | null;
  pitsStatus: SourceStatus;
  inspectionStatus: SourceStatus;
  pitMapStatus: SourceStatus;
  announcements: NexusAnnouncement[];
  partsRequests: NexusPartsRequest[];
  inspectionSummary: NexusInspectionSummary | null;
  pits: ExternalArray;
  matches: NexusMatchStatus[];
  pitAddressByTeam: Record<string, string>;
  inspectionByTeam: Record<string, string>;
  loadedTeamOps?: NexusTeamOps | null;
  raw: {
    status: ExternalRecord | null;
    pits: ExternalArray;
    pitMap: ExternalRecord | null;
    inspection: ExternalArray;
    announcements: ExternalArray;
    partsRequests: ExternalArray;
  };
};

export type OfficialEventSnapshot = {
  status: SourceStatus;
  event: ExternalRecord | null;
  matches: ExternalArray;
  rankings: ExternalRecord | null;
  awards: ExternalArray;
  district: ExternalRecord | null;
};

export type LiveSignal = {
  id: string;
  workspaceKey: string;
  eventKey: string;
  source: string;
  signalType: string;
  title: string;
  body: string;
  dedupeKey: string | null;
  createdAtMs: number;
  payload: ExternalRecord | null;
};

export type AppSnapshot = {
  generatedAtMs: number;
  inputs: {
    eventKey: string;
    team: number;
    teamKey: string;
  };
  tba: {
    event: ExternalRecord | null;
    matches: MatchSimple[];
    rankings: ExternalRecord | null;
    oprs: ExternalRecord | null;
    alliances: ExternalRecord | null;
    status: ExternalRecord | null;
    insights: ExternalRecord | null;
    awards: ExternalArray;
    teams: ExternalArray | null;
    teamStatuses?: ExternalRecord | null;
  };
  sb: {
    matches: ExternalArray;
    teamEvents: ExternalArray;
    teamMatches: ExternalArray;
  };
  official?: OfficialEventSnapshot | null;
  nexus?: NexusOpsSnapshot | null;
  media?: EventMediaSnapshot | null;
  validation?: ValidationSnapshot | null;
  liveSignals?: LiveSignal[];
};

export type AlertKind = 'QUEUE_5' | 'QUEUE_2' | 'QUEUE_1' | 'PLAYING_NOW';

export type QueueState = 'NONE' | 'QUEUE_5' | 'QUEUE_2' | 'QUEUE_1' | 'PLAYING_NOW';

export type CompositeWeights = {
  overallEpa: number;
  autoEpa: number;
  teleopEpa: number;
  endgameEpa: number;
  opr: number;
  ccwm: number;
  rpPace: number;
  recentTrend: number;
};

export type ThemeId = 'graphite-dark' | 'light-slate' | 'cyan-night';

export type LanguageCode = 'en' | 'es' | 'fr';

export type WebhookEventKey =
  | 'queue_5'
  | 'queue_2'
  | 'queue_1'
  | 'playing_now'
  | 'mode_changed'
  | 'snapshot_failed'
  | 'snapshot_recovered'
  | 'manual_load_failed'
  | 'warning'
  | 'test';

export type WebhookSettings = {
  enabled: boolean;
  discordUrl: string;
  displayName: string;
  cooldownSeconds: number;
  events: Record<WebhookEventKey, boolean>;
};

export type DeskMode = 'competition' | 'analyst';

export type SettingsState = {
  teamNumber: number;
  eventKey: string;
  lagMatches: number;
  pollMs: number;
  repeatUntilAck: boolean;
  enablePlayingAnimation: boolean;
  recentStartQual: number;
  scoutingUrl: string;
  logoDataUrl: string | null;
  weights: CompositeWeights;
  themeId: ThemeId;
  language: LanguageCode;
  webhook: WebhookSettings;
  operatorLabel: string;
  freezeAutoRefresh: boolean;
  deskMode: DeskMode;
};

export type WorkspaceNoteScope = 'event' | 'team' | 'match';

export type WorkspaceNote = {
  id: string;
  workspaceKey: string;
  scope: WorkspaceNoteScope;
  eventKey: string | null;
  teamNumber: number | null;
  matchKey: string | null;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  authorLabel: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type WorkspaceActivityScope = WorkspaceNoteScope | 'workspace';

export type WorkspaceActivityType =
  | 'note_saved'
  | 'note_deleted'
  | 'checklist_updated'
  | 'strategy_saved'
  | 'scenario_saved'
  | 'manual_override'
  | 'target_changed';

export type WorkspaceActivityEntry = {
  id: string;
  workspaceKey: string;
  scope: WorkspaceActivityScope;
  eventKey: string | null;
  teamNumber: number | null;
  matchKey: string | null;
  action: WorkspaceActivityType;
  detail: string;
  authorLabel: string | null;
  createdAtMs: number;
  payload?: ExternalRecord | null;
};

export type WorkspaceChecklistItem = {
  id: string;
  text: string;
  checked: boolean;
  updatedAtMs: number;
  updatedByLabel: string | null;
};

export type WorkspaceChecklist = {
  id: string;
  workspaceKey: string;
  scope: WorkspaceNoteScope;
  eventKey: string | null;
  teamNumber: number | null;
  matchKey: string | null;
  label: string;
  items: WorkspaceChecklistItem[];
  authorLabel: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type QueueLadderStep = {
  id: 'QUEUE_5' | 'QUEUE_2' | 'QUEUE_1' | 'PLAYING_NOW';
  label: string;
  active: boolean;
  completed: boolean;
  etaLabel: string | null;
};

export type DeskOpsSourceTrust = {
  firstStatus: SourceStatus;
  nexusStatus: SourceStatus;
  officialAvailability: ValidationSnapshot['officialAvailability'] | null;
  mismatchCount: number;
  missingCount: number;
  staleSeconds: number | null;
  summary: string;
};

export type DeskOpsDeltaItem = {
  id: string;
  label: string;
  detail: string;
  tone: 'neutral' | 'positive' | 'warning';
  createdAtMs: number | null;
};

export type DeskOpsResponse = {
  generatedAtMs: number;
  workspaceKey: string;
  eventKey: string | null;
  teamNumber: number | null;
  eventName: string | null;
  queueText: string | null;
  queueMatchesAway: number | null;
  queueLadder: QueueLadderStep[];
  currentMatchLabel: string | null;
  nextMatchLabel: string | null;
  sourceTrust: DeskOpsSourceTrust | null;
  checklist: WorkspaceChecklist | null;
  notes: WorkspaceNote[];
  activity: WorkspaceActivityEntry[];
  deltas: DeskOpsDeltaItem[];
};

export type TeamDossierRoleMetric = {
  label: string;
  value: number | null;
  baseline: number | null;
  delta: number | null;
  insight: string;
};

export type TeamDossierResponse = {
  generatedAtMs: number;
  teamNumber: number;
  loadedEventKey: string | null;
  roleSummary: string[];
  volatility: {
    score: number | null;
    label: string;
    insight: string;
  };
  leverage: {
    winConditionFlags: string[];
    rpPressure: string[];
  };
  currentVsSeason: {
    label: string;
    current: number | null;
    season: number | null;
    delta: number | null;
  }[];
  roleMetrics: TeamDossierRoleMetric[];
  bestEvidenceMatches: {
    key: string;
    label: string;
    eventKey: string;
    result: string;
    margin: number | null;
    score: number | null;
    epa: number | null;
    reason: string;
  }[];
  rankTrajectory: {
    label: string;
    value: number | null;
  }[];
};

export type PickListAnalysisRoleRow = {
  label: string;
  teamKey: string | null;
  teamNumber: number | null;
  nickname: string | null;
  insight: string;
  pick: number | null;
  fit: number | null;
  denial: number | null;
  ready: number | null;
  ceiling: number | null;
};

export type PickListScenarioAnalysisRow = {
  id: string;
  name: string;
  createdAtMs: number | null;
  firstCount: number;
  secondCount: number;
  avoidCount: number;
  decisionLogCount: number;
  averageFit: number | null;
  averageReady: number | null;
  averageCeiling: number | null;
  captainRiskCount: number;
};

export type PickListAnalysisResponse = {
  generatedAtMs: number;
  workspaceKey: string;
  eventKey: string;
  teamNumber: number | null;
  activePickListId: string | null;
  bucketSummary: {
    label: string;
    count: number;
    avgEpa: number | null;
    avgComposite: number | null;
  }[];
  bestByRole: PickListAnalysisRoleRow[];
  ifSelectionStartedNow: {
    label: string;
    teamKey: string | null;
    teamNumber: number | null;
    detail: string;
  }[];
  scenarioRows: PickListScenarioAnalysisRow[];
};

export type PlayoffScenarioSummaryRow = {
  id: string;
  name: string;
  createdAtMs: number | null;
  ourSeed: number | null;
  manualBestRound: string | null;
  simulatedBestRound: string | null;
  champ: number | null;
  finals: number | null;
  upperFinal: number | null;
};

export type PlayoffSummaryResponse = {
  generatedAtMs: number;
  workspaceKey: string;
  eventKey: string;
  teamNumber: number | null;
  activeScenarioId: string | null;
  liveSummary: {
    ourSeed: number | null;
    bestRound: string | null;
    champ: number | null;
    finals: number | null;
    upperFinal: number | null;
  } | null;
  topAllianceOdds: {
    seed: number;
    teams: string[];
    isUs: boolean;
    champ: number;
    finals: number;
    upperFinal: number;
    bestRound: string;
  }[];
  scenarioRows: PlayoffScenarioSummaryRow[];
};

export type AnalyticsSemanticDirection = 'positive_when_higher' | 'positive_when_lower' | 'neutral';

export type SemanticTone =
  | 'negative-strong'
  | 'negative-mild'
  | 'neutral'
  | 'positive-mild'
  | 'positive-strong';

export type CompareMetricKey = string;

export type CompareChartMode = string;

export type AnalyticsScope =
  | 'current_event'
  | 'historical_2026_excluding_loaded_event'
  | 'event_wide'
  | 'compare'
  | 'scenario'
  | 'raw'
  | 'diagnostics';

export type AnalyticsChartFamily = 'line' | 'step' | 'bar' | 'area' | 'scatter' | 'composed';

export type AnalyticsMetricFormat =
  | 'number_1'
  | 'number_2'
  | 'integer'
  | 'percent'
  | 'rank'
  | 'text';

export type AnalyticsMetricDefinition = {
  key: string;
  label: string;
  shortLabel?: string;
  unit?: string;
  scope: AnalyticsScope[];
  chartFamilies: AnalyticsChartFamily[];
  defaultChartFamily?: AnalyticsChartFamily;
  defaultSmoothingWindow?: number;
  format: AnalyticsMetricFormat;
  tabs?: string[];
  color?: string;
  semanticDirection?: AnalyticsSemanticDirection;
};

export type AnalyticsSeriesPoint = {
  label: string;
  index: number;
  value: number | null;
  time?: number | null;
  eventKey?: string | null;
  matchKey?: string | null;
  meta?: Record<string, unknown> | null;
};

export type TabAnalyticsPack = {
  title: string;
  currentMetricKeys?: string[];
  historicalMetricKeys?: string[];
  eventMetricKeys?: string[];
  scenarioMetricKeys?: string[];
};

export type RawMatrixField = {
  key: string;
  label: string;
  source: 'season' | 'event';
};

export type CompareSeriesPoint = {
  index: number;
  label: string;
  value: number | null;
  teamKey: string;
  teamNumber: number;
  eventKey?: string | null;
  matchKey?: string | null;
  time?: number | null;
};

export type CompareSetNote = {
  text: string;
  updatedAtMs: number;
};

export type CompareSet = {
  id: string;
  name: string;
  teamNumbers: number[];
  baselineTeamNumber: number | null;
  note: CompareSetNote;
  chartMode: CompareChartMode;
  metricKey: CompareMetricKey;
  smoothingWindow: number;
  distributionSource: 'season' | 'event';
  baselineOverlay: boolean;
  createdAtMs: number;
  updatedAtMs: number;
};

export type CompareDraft = {
  teamNumbers: number[];
  baselineTeamNumber: number | null;
  note: string;
  chartMode: CompareChartMode;
  metricKey: CompareMetricKey;
  smoothingWindow: number;
  distributionSource: 'season' | 'event';
  baselineOverlay: boolean;
};

export type CompareTeamEventRow = {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  rank: number | null;
  compositeRank: number | null;
  matchesPlayed: number;
  rpAverage: number | null;
  totalRp: number | null;
  overallEpa: number | null;
  autoEpa: number | null;
  teleopEpa: number | null;
  endgameEpa: number | null;
  opr: number | null;
  copr: number | null;
  dpr: number | null;
  ccwm: number | null;
  record: string;
  composite: number | null;
  compositeRaw: number | null;
  playedSos: number | null;
  remainingSos: number | null;
  totalSos: number | null;
  districtPoints?: number | null;
  district_points?: number | null;
  eventStatus?: ExternalRecord | null;
};

export type CompareTeamRow = {
  teamNumber: number;
  teamKey: string;
  nickname: string;
  seasonSummary: ExternalRecord | null;
  seasonRollups: ExternalRecord | null;
  seasonEvents: ExternalArray;
  playedEvents: ExternalArray;
  upcomingEvents: ExternalArray;
  seasonMatches: ExternalArray;
  historicalSeasonEvents?: ExternalArray;
  historicalPlayedEvents?: ExternalArray;
  historicalUpcomingEvents?: ExternalArray;
  historicalMatches?: ExternalArray;
  eventRow: CompareTeamEventRow | null;
  eventMatches: ExternalArray;
  derived: Record<string, number | string | boolean | null>;
};

export type TeamCompareSnapshot = {
  generatedAtMs: number;
  eventKey: string | null;
  event: ExternalRecord | null;
  fieldAverages: Record<string, number | null> | null;
  teams: CompareTeamRow[];
};

export type DataSuperSnapshot = {
  generatedAtMs: number;
  loadedEventKey: string | null;
  loadedTeam: number | null;
  currentEvent: {
    event: ExternalRecord | null;
    eventRows: CompareTeamEventRow[];
    fieldAverages: Record<string, number | null> | null;
    matches: MatchSimple[];
    insights: ExternalRecord | null;
    rankings: ExternalRecord | null;
    alliances: ExternalRecord | null;
    status: ExternalRecord | null;
    awards: ExternalArray;
  } | null;
  historicalTeam: ExternalRecord | null;
  compare: TeamCompareSnapshot | null;
  diagnostics: {
    eventTeamCount: number;
    tbaMatchCount: number;
    sbMatchCount: number;
    sbTeamEventCount: number;
    compareTeamCount: number;
    generatedAtMs: number;
  };
  rawPayloads: {
    tba: ExternalRecord | null;
    sb: ExternalRecord | null;
    historicalTeam: ExternalRecord | null;
  };
};

export type DistrictTabScope = 'current' | 'historical';

export type DistrictTopTierAwardKey = 'impact' | 'engineering_inspiration' | 'rookie_all_star';

export type DistrictAwardKey =
  | DistrictTopTierAwardKey
  | 'creativity'
  | 'quality'
  | 'judges'
  | 'industrial_design'
  | 'entrepreneurship'
  | 'excellence_in_design'
  | 'engineering_excellence'
  | 'innovation_in_control'
  | 'autonomous'
  | 'imagery'
  | 'other_team_judged_award';

export type DistrictAllianceRole = 'unpicked' | 'captain' | 'first_pick' | 'second_pick' | 'backup';

export type DistrictPlayoffFinish =
  | 'none'
  | 'out_early'
  | 'fourth'
  | 'third'
  | 'finalist'
  | 'winner';

export type DistrictLockStatus = 'AUTO' | 'LOCKED' | 'BUBBLE' | 'ELIMINATED';

export type DistrictPointsBreakdown = {
  qualPoints: number;
  alliancePoints: number;
  elimPoints: number;
  awardPoints: number;
  ageBonusPoints: number;
  eventPoints: number;
  multiplier: number;
  seasonContribution: number;
};

export type DistrictCalculatorInput = {
  qualificationRank: number;
  teamCount: number;
  allianceRole: DistrictAllianceRole;
  allianceNumber: number | null;
  playoffFinish: DistrictPlayoffFinish;
  finalsWins: number;
  awardKeys: DistrictAwardKey[];
  rookieBonusPoints: number;
  dcmpMultiplier: boolean;
};

export type DistrictRankingEventPoints = {
  eventKey: string;
  qualPoints: number;
  alliancePoints: number;
  elimPoints: number;
  awardPoints: number;
  total: number;
  districtCmp: boolean;
};

export type DistrictAdvancementFlags = {
  dcmp: boolean;
  cmp: boolean;
};

export type DistrictStandingRow = {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  name: string;
  rank: number;
  pointTotal: number;
  rookieBonus: number;
  adjustments: number;
  officialDcmpQualified: boolean;
  officialCmpQualified: boolean;
  rookieYear: number | null;
  districtKey: string | null;
  seasonEpa: number | null;
  seasonAutoEpa: number | null;
  seasonTeleopEpa: number | null;
  seasonEndgameEpa: number | null;
  currentDistrictRank: number | null;
  eventPoints: DistrictRankingEventPoints[];
  playedRegularEvents: string[];
  remainingRegularEvents: string[];
  hasOfficialDcmpResult: boolean;
};

export type DistrictEventStatus = 'future' | 'live' | 'complete';

export type DistrictEventSummary = {
  eventKey: string;
  name: string;
  shortName: string;
  week: number | null;
  startDate: string | null;
  endDate: string | null;
  districtCmp: boolean;
  teamCount: number;
  awardedOfficialPoints: number;
  awardedPerformancePoints: number;
  remainingPerformanceCeiling: number;
  awardedTopTierPoints: number;
  remainingTopTierAwardPoints: number;
  remainingTopTierAwards: {
    impact: number;
    engineeringInspiration: number;
    rookieAllStar: number;
  };
  status: DistrictEventStatus;
};

export type DistrictEventOfficialRow = {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  officialPoints: DistrictPointsBreakdown;
};

export type DistrictSnapshotResponse = {
  generatedAtMs: number;
  applicable: boolean;
  reason: string | null;
  districtKey: string;
  districtName: string;
  loadedEventKey: string | null;
  loadedTeam: number | null;
  loadedEventIsFitDistrict: boolean;
  advancementCounts: {
    dcmp: number;
    cmp: number;
  };
  standings: DistrictStandingRow[];
  loadedTeamStanding: DistrictStandingRow | null;
  advancement: Record<string, DistrictAdvancementFlags>;
  season: {
    currentDcmpLinePoints: number | null;
    currentWorldsLinePoints: number | null;
    pointsRemainingDistrictCeiling: number;
    remainingTopTierAwards: {
      impact: number;
      engineeringInspiration: number;
      rookieAllStar: number;
    };
    events: DistrictEventSummary[];
  };
  loadedTeamSeason: {
    rookieBonus: number;
    currentOfficialTotal: number;
    totalExcludingLoadedEvent: number;
    currentRank: number | null;
    officialDcmpQualified: boolean;
    officialCmpQualified: boolean;
  } | null;
  currentEvent: {
    event: ExternalRecord | null;
    teamCount: number;
    districtCmp: boolean;
    eventRows: CompareTeamEventRow[];
    officialRows: DistrictEventOfficialRow[];
    awardedOfficialPoints: number;
    awardedPerformancePoints: number;
    remainingPerformanceCeiling: number;
    remainingTopTierAwardPoints: number;
    remainingTopTierAwards: {
      impact: number;
      engineeringInspiration: number;
      rookieAllStar: number;
    };
  } | null;
};

export type DistrictEventProjectionRow = {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  officialEventPoints: number | null;
  officialAwardPoints: number;
  qualP5: number;
  qualP50: number;
  qualP95: number;
  allianceP5: number;
  allianceP50: number;
  allianceP95: number;
  elimP5: number;
  elimP50: number;
  elimP95: number;
  performanceMin: number;
  performanceMedian: number;
  performanceMax: number;
  totalP5: number;
  totalP50: number;
  totalP95: number;
  maxWithRemainingTopTier: number;
};

export type DistrictHistogramBucket = {
  label: string;
  value: number;
};

export type DistrictEventProjection = {
  generatedAtMs: number;
  mode: 'event';
  runs: number;
  rows: DistrictEventProjectionRow[];
  loadedTeamHistogram: DistrictHistogramBucket[];
  loadedTeamSummary: {
    teamNumber: number;
    min: number;
    median: number;
    max: number;
    p5: number;
    p95: number;
    seasonIfMedianApplied: number | null;
    seasonIfBestApplied: number | null;
    dcmpGapAtMedian: number | null;
    worldsGapAtMedian: number | null;
  } | null;
};

export type DistrictCutlineDistribution = {
  min: number | null;
  p5: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
};

export type DistrictSeasonTeamRow = {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  officialRank: number;
  currentTotal: number;
  rookieBonus: number;
  playedEvents: number;
  remainingEvents: number;
  p5Total: number;
  p50Total: number;
  p95Total: number;
  minTotal: number;
  maxTotal: number;
  dcmpProbability: number;
  worldsProbability: number;
  dcmpStatus: DistrictLockStatus;
  worldsStatus: DistrictLockStatus;
  autoReason: string | null;
};

export type DistrictSeasonProjection = {
  generatedAtMs: number;
  mode: 'season';
  runs: number;
  rows: DistrictSeasonTeamRow[];
  dcmpCutoff: DistrictCutlineDistribution;
  worldsCutoff: DistrictCutlineDistribution;
  loadedTeamHistogram: DistrictHistogramBucket[];
  loadedTeamSummary: {
    teamNumber: number;
    currentTotal: number;
    p5Total: number;
    p50Total: number;
    p95Total: number;
    dcmpProbability: number;
    worldsProbability: number;
    dcmpGapToMedianCutoff: number | null;
    worldsGapToMedianCutoff: number | null;
    dcmpStatus: DistrictLockStatus;
    worldsStatus: DistrictLockStatus;
  } | null;
};

export type GameManualSection = {
  id: string;
  title: string;
  number: string | null;
  level: 1 | 2 | 3 | 4;
  html: string;
  text: string;
};

export type GameManualTocItem = {
  id: string;
  title: string;
  number: string | null;
  level: number;
};

export type GameManualSnapshot = {
  fetchedAtMs: number;
  title: string;
  sourceUrl: string;
  pdfUrl: string;
  lastModified: string | null;
  sections: GameManualSection[];
  toc: GameManualTocItem[];
};

export type GameManualSearchResult = {
  id: string;
  title: string;
  number: string | null;
  level: number;
  snippet: string;
};

export type DiscordWebhookPayload = {
  webhookUrl: string;
  displayName?: string;
  eventKey: WebhookEventKey;
  title: string;
  body: string;
  fields?: {
    name: string;
    value: string;
  }[];
};
