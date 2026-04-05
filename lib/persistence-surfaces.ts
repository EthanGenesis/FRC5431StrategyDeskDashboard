export const SHARED_WORKSPACE_KEY = 'shared' as const;

export const PERSISTENCE_TABLES = {
  workspaceSettings: 'tbsb_workspace_settings',
  activeTarget: 'tbsb_active_target',
  teamEventCatalog: 'tbsb_team_event_catalog',
  refreshStatus: 'tbsb_refresh_status',
  bundleStatus: 'tbsb_bundle_status',
  parityAuditLog: 'tbsb_parity_audit_log',
  perfSamples: 'tbsb_perf_samples',
  workspaceNotes: 'tbsb_workspace_notes',
  workspaceActivity: 'tbsb_workspace_activity',
  workspaceChecklists: 'tbsb_workspace_checklists',
  compareDrafts: 'tbsb_compare_drafts',
  compareSets: 'tbsb_compare_sets',
  predictScenarios: 'tbsb_predict_scenarios',
  allianceScenarios: 'tbsb_alliance_scenarios',
  pickLists: 'tbsb_pick_lists',
  playoffResults: 'tbsb_playoff_results',
  strategyRecords: 'tbsb_strategy_records',
  eventLiveSignals: 'tbsb_event_live_signals',
  sourceValidation: 'tbsb_source_validation',
  snapshotCache: 'tbsb_snapshot_cache',
  upstreamCache: 'tbsb_upstream_cache',
} as const;

export const LOCAL_PERSISTENCE_KEYS = {
  settings: 'tbsb_dashboard_settings_v1',
  lastSnapshot: 'tbsb_last_snapshot_v1',
  predictScenarios: 'tbsb_predict_scenarios_v1',
  allianceScenarios: 'tbsb_alliance_scenarios_v1',
  pickLists: 'tbsb_pick_lists_v1',
  playoffResults: 'tbsb_playoff_results_v1',
  compareDraftCurrent: 'tbsb_compare_draft_current_v1',
  compareDraftHistorical: 'tbsb_compare_draft_historical_v1',
  compareSets: 'tbsb_compare_sets_v1',
  strategyIndexedDb: 'tbsb_strategy_records_v1',
} as const;
