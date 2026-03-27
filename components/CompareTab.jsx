'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJsonOrThrow } from '../lib/httpCache';
import AnalyticsChartBlock from './AnalyticsChartBlock';
import AnalyticsTableBlock from './AnalyticsTableBlock';
import RawBreakdownMatrix from './RawBreakdownMatrix';
import SafeRichText from './SafeRichText';
import DisclosureSection from './ui/DisclosureSection';
import { useDashboardPreferences } from './providers/DashboardPreferencesProvider';
import {
  ANALYTICS_METRIC_REGISTRY,
  buildBreakdownMatrixFields,
  buildBreakdownMatrixRows,
  buildCompareSeriesPoints,
  formatAnalyticsMetricValue,
  getAnalyticsMetric,
} from '../lib/analytics-registry';
import {
  DEFAULT_COMPARE_DRAFT,
  loadCompareDraft,
  loadCompareSets,
  saveCompareDraft,
  saveCompareSets,
} from '../lib/compare-storage';
function uniqNumbers(values) {
  return Array.from(
    new Set(
      (values ?? []).map((v) => Math.floor(Number(v))).filter((v) => Number.isFinite(v) && v > 0),
    ),
  );
}
function fmt(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(digits);
}
function deltaText(value, baseline, digits = 1) {
  if (
    value == null ||
    baseline == null ||
    !Number.isFinite(Number(value)) ||
    !Number.isFinite(Number(baseline))
  )
    return '-';
  const delta = Number(value) - Number(baseline);
  return `${delta > 0 ? '+' : ''}${delta.toFixed(digits)}`;
}
function chartModeForMetric(metricKey) {
  if (metricKey.startsWith('event_match_')) return 'event_matches';
  if (metricKey.startsWith('season_match_')) return 'season_matches';
  return 'season_events';
}
function mergeSeries(compareTeams, metricKey, smoothingWindow) {
  const chartMode = chartModeForMetric(metricKey);
  const perTeam = compareTeams.map((team) => {
    return {
      team,
      points: buildCompareSeriesPoints(team, chartMode, metricKey, smoothingWindow),
    };
  });
  const maxLength = Math.max(0, ...perTeam.map((entry) => entry.points.length));
  return Array.from({ length: maxLength }, (_, index) => {
    const row = {
      label:
        perTeam.find((entry) => entry.points[index]?.label)?.points[index]?.label ??
        `Point ${index + 1}`,
    };
    perTeam.forEach((entry) => {
      row[`team_${entry.team.teamNumber}`] =
        entry.points[index]?.smoothedValue ?? entry.points[index]?.value ?? null;
    });
    return row;
  }).filter((row) => Object.keys(row).some((key) => key.startsWith('team_') && row[key] != null));
}
export default function CompareTab({
  loadedEventKey,
  loadedTeam,
  eventTeamRows = [],
  externalUpdateKey = 0,
  onOpenTeamProfile,
  scope = 'current',
}) {
  const { language, t, toneClass, toneFromDelta } = useDashboardPreferences();
  const initializedRef = useRef(false);
  const [draft, setDraft] = useState(DEFAULT_COMPARE_DRAFT);
  const [savedSets, setSavedSets] = useState([]);
  const [activeSetId, setActiveSetId] = useState('');
  const [addInput, setAddInput] = useState('');
  const [eventTeamPick, setEventTeamPick] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const selectedTeamNumbers = useMemo(() => draft.teamNumbers ?? [], [draft.teamNumbers]);
  const normalizeDraftForScope = useCallback(
    (baseDraft) => {
      const next = { ...DEFAULT_COMPARE_DRAFT, ...(baseDraft ?? {}) };
      return scope === 'current'
        ? {
            ...next,
            chartMode:
              next.chartMode === 'season_events' || next.chartMode === 'season_matches'
                ? 'event_matches'
                : next.chartMode,
            metricKey: String(next.metricKey).startsWith('season_')
              ? 'event_match_rolling_opr'
              : next.metricKey,
            distributionSource: 'event',
          }
        : {
            ...next,
            chartMode: next.chartMode === 'event_matches' ? 'season_matches' : next.chartMode,
            metricKey: String(next.metricKey).startsWith('event_')
              ? 'season_match_epa'
              : next.metricKey,
            distributionSource: 'season',
          };
    },
    [scope],
  );
  const updateDraft = useCallback(
    (updater) => {
      setDraft((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
        return normalizeDraftForScope({
          ...prev,
          ...next,
          teamNumbers: uniqNumbers(next?.teamNumbers ?? prev?.teamNumbers ?? []),
        });
      });
    },
    [normalizeDraftForScope],
  );
  useEffect(() => {
    const storedDraft = normalizeDraftForScope(loadCompareDraft(scope));
    const storedSets = loadCompareSets();
    if (!initializedRef.current) {
      initializedRef.current = true;
      setDraft(
        !storedDraft.teamNumbers.length && loadedTeam != null
          ? normalizeDraftForScope({
              ...storedDraft,
              teamNumbers: [Math.floor(Number(loadedTeam))],
              baselineTeamNumber: Math.floor(Number(loadedTeam)),
            })
          : storedDraft,
      );
      setSavedSets(storedSets);
      return;
    }
    setDraft(normalizeDraftForScope(loadCompareDraft(scope)));
    setSavedSets(loadCompareSets());
  }, [externalUpdateKey, loadedTeam, normalizeDraftForScope, scope]);
  useEffect(() => {
    saveCompareDraft(draft, scope);
  }, [draft, scope]);
  useEffect(() => {
    saveCompareSets(savedSets);
  }, [savedSets]);
  useEffect(() => {
    if (!selectedTeamNumbers.length) return;
    const normalizedLoadedTeam =
      loadedTeam != null && Number.isFinite(Number(loadedTeam))
        ? Math.floor(Number(loadedTeam))
        : null;
    if (
      normalizedLoadedTeam != null &&
      selectedTeamNumbers.includes(normalizedLoadedTeam) &&
      draft.baselineTeamNumber !== normalizedLoadedTeam
    )
      return updateDraft({ baselineTeamNumber: normalizedLoadedTeam });
    if (draft.baselineTeamNumber == null || !selectedTeamNumbers.includes(draft.baselineTeamNumber))
      updateDraft({ baselineTeamNumber: selectedTeamNumbers[0] ?? null });
  }, [selectedTeamNumbers, loadedTeam, draft.baselineTeamNumber, updateDraft]);
  useEffect(() => {
    if (!selectedTeamNumbers.length) return void setSnapshot(null);
    let cancelled = false;
    async function loadSnapshot() {
      setIsLoading(true);
      setErrorText('');
      try {
        const json = await fetchJsonOrThrow(
          '/api/team-compare',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              teams: selectedTeamNumbers,
              eventKey: loadedEventKey || '',
            }),
            cache: 'no-store',
          },
          'Compare load failed',
        );
        if (!cancelled) setSnapshot(json);
      } catch (error) {
        if (!cancelled) {
          setErrorText(error?.message ?? 'Unknown compare error');
          setSnapshot(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [loadedEventKey, selectedTeamNumbers]);
  useEffect(() => {
    if (scope === 'current' && String(draft.metricKey).startsWith('season_')) {
      updateDraft({
        metricKey: 'event_match_rolling_opr',
        chartMode: 'event_matches',
        distributionSource: 'event',
      });
    }
    if (scope === 'historical' && String(draft.metricKey).startsWith('event_')) {
      updateDraft({
        metricKey: 'season_match_epa',
        chartMode: 'season_matches',
        distributionSource: 'season',
      });
    }
  }, [scope, draft.metricKey, updateDraft]);
  const compareTeams = useMemo(() => snapshot?.teams ?? [], [snapshot]);
  const compareTeamMap = useMemo(
    () => new Map(compareTeams.map((row) => [Number(row.teamNumber), row])),
    [compareTeams],
  );
  const baselineTeam = useMemo(
    () => compareTeamMap.get(Number(draft.baselineTeamNumber)) ?? compareTeams[0] ?? null,
    [compareTeamMap, compareTeams, draft.baselineTeamNumber],
  );
  const eventOptions = useMemo(
    () =>
      [...eventTeamRows].sort(
        (a, b) =>
          Number(a?.rank ?? 9999) - Number(b?.rank ?? 9999) ||
          Number(a?.teamNumber ?? 0) - Number(b?.teamNumber ?? 0),
      ),
    [eventTeamRows],
  );
  const scopeFilters = useMemo(
    () =>
      scope === 'current'
        ? ['current_event', 'compare']
        : ['historical_2026_excluding_loaded_event', 'compare'],
    [scope],
  );
  const compareMetricOptions = useMemo(() => {
    if (draft.chartMode === 'distribution') return [];
    const prefix =
      draft.chartMode === 'event_matches'
        ? 'event_match_'
        : draft.chartMode === 'season_events'
          ? 'season_event_'
          : 'season_match_';
    return Object.values(ANALYTICS_METRIC_REGISTRY)
      .filter((metric) => metric.tabs?.includes('COMPARE'))
      .filter((metric) => metric.scope?.some((value) => scopeFilters.includes(value)))
      .filter((metric) => String(metric.key).startsWith(prefix));
  }, [draft.chartMode, scopeFilters]);

  function renderSemanticDelta(metricKey, value, baseline, digits = 1) {
    const delta =
      value == null ||
      baseline == null ||
      !Number.isFinite(Number(value)) ||
      !Number.isFinite(Number(baseline))
        ? null
        : Number(value) - Number(baseline);
    const tone = toneFromDelta(
      delta,
      getAnalyticsMetric(metricKey)?.semanticDirection ?? 'neutral',
    );
    return <span className={toneClass(tone)}>{deltaText(value, baseline, digits)}</span>;
  }
  useEffect(() => {
    if (draft.chartMode === 'distribution') return;
    if (!compareMetricOptions.some((metric) => metric.key === draft.metricKey)) {
      updateDraft({
        metricKey: compareMetricOptions[0]?.key ?? draft.metricKey,
      });
    }
  }, [draft.chartMode, draft.metricKey, compareMetricOptions, updateDraft]);
  const currentBreakdownFields = useMemo(
    () => buildBreakdownMatrixFields(compareTeams, 'event'),
    [compareTeams],
  );
  const currentBreakdownRows = useMemo(
    () => buildBreakdownMatrixRows(compareTeams, 'event'),
    [compareTeams],
  );
  const historicalBreakdownFields = useMemo(
    () => buildBreakdownMatrixFields(compareTeams, 'season'),
    [compareTeams],
  );
  const historicalBreakdownRows = useMemo(
    () => buildBreakdownMatrixRows(compareTeams, 'season'),
    [compareTeams],
  );
  const chartData = useMemo(
    () =>
      draft.chartMode === 'distribution'
        ? compareTeams.map((team) => ({
            label: `${team.teamNumber}`,
            auto:
              scope === 'current'
                ? (team?.derived?.eventAuto ?? 0)
                : (team?.derived?.seasonAuto ?? 0),
            teleop:
              scope === 'current'
                ? (team?.derived?.eventTeleop ?? 0)
                : (team?.derived?.seasonTeleop ?? 0),
            endgame:
              scope === 'current'
                ? (team?.derived?.eventEndgame ?? 0)
                : (team?.derived?.seasonEndgame ?? 0),
          }))
        : mergeSeries(compareTeams, draft.metricKey, draft.smoothingWindow || 1),
    [compareTeams, draft.chartMode, draft.metricKey, draft.smoothingWindow, scope],
  );
  const chartSeries = useMemo(
    () =>
      draft.chartMode === 'distribution'
        ? [
            { key: 'auto', label: 'Auto', color: '#ff7a59' },
            { key: 'teleop', label: 'Teleop', color: '#38bdf8' },
            { key: 'endgame', label: 'Endgame', color: '#a3e635' },
          ]
        : compareTeams.map((team, index) => ({
            key: `team_${team.teamNumber}`,
            label: `${team.teamNumber}`,
            color: [
              '#f3be3b',
              '#4bb3fd',
              '#ff6b6b',
              '#8ad17d',
              '#c084fc',
              '#2dd4bf',
              '#f472b6',
              '#facc15',
            ][index % 8],
            strokeWidth:
              draft.baselineOverlay && Number(team.teamNumber) === Number(draft.baselineTeamNumber)
                ? 4
                : 2.5,
          })),
    [compareTeams, draft.chartMode, draft.baselineOverlay, draft.baselineTeamNumber],
  );
  const savedSetLookup = useMemo(() => new Map(savedSets.map((set) => [set.id, set])), [savedSets]);
  const activeSet = activeSetId ? (savedSetLookup.get(activeSetId) ?? null) : null;
  function addTeamsFromInput() {
    const values = uniqNumbers(addInput.split(/[,\s]+/));
    if (!values.length) return;
    updateDraft((prev) => ({
      ...prev,
      teamNumbers: uniqNumbers([...(prev.teamNumbers ?? []), ...values]),
    }));
    setAddInput('');
  }
  function addEventTeam() {
    const teamNumber = Math.floor(Number(eventTeamPick));
    if (!Number.isFinite(teamNumber) || teamNumber <= 0) return;
    updateDraft((prev) => ({
      ...prev,
      teamNumbers: uniqNumbers([...(prev.teamNumbers ?? []), teamNumber]),
    }));
    setEventTeamPick('');
  }
  function removeTeam(teamNumber) {
    updateDraft((prev) => ({
      ...prev,
      teamNumbers: (prev.teamNumbers ?? []).filter((value) => value !== teamNumber),
    }));
  }
  function saveCurrentSet() {
    if (!selectedTeamNumbers.length) return;
    const name = window.prompt('Compare set name', `Compare ${savedSets.length + 1}`);
    if (!name) return;
    const now = Date.now();
    const nextSet = {
      id: `compare_${now}`,
      name,
      teamNumbers: [...selectedTeamNumbers],
      baselineTeamNumber: draft.baselineTeamNumber ?? null,
      note: { text: draft.note ?? '', updatedAtMs: now },
      chartMode: draft.chartMode,
      metricKey: draft.metricKey,
      smoothingWindow: draft.smoothingWindow,
      distributionSource: draft.distributionSource,
      baselineOverlay: draft.baselineOverlay,
      compareScope: scope,
      createdAtMs: now,
      updatedAtMs: now,
    };
    setSavedSets((prev) => [nextSet, ...prev]);
    setActiveSetId(nextSet.id);
  }
  function loadSet(id) {
    const target = savedSetLookup.get(id);
    if (!target) return;
    updateDraft({
      teamNumbers: target.teamNumbers ?? [],
      baselineTeamNumber: target.baselineTeamNumber ?? null,
      note: target.note?.text ?? '',
      chartMode: target.chartMode ?? DEFAULT_COMPARE_DRAFT.chartMode,
      metricKey: target.metricKey ?? DEFAULT_COMPARE_DRAFT.metricKey,
      smoothingWindow: target.smoothingWindow ?? DEFAULT_COMPARE_DRAFT.smoothingWindow,
      distributionSource: target.distributionSource ?? (scope === 'current' ? 'event' : 'season'),
      baselineOverlay: target.baselineOverlay ?? DEFAULT_COMPARE_DRAFT.baselineOverlay,
    });
    setActiveSetId(id);
  }
  function deleteSet(id) {
    setSavedSets((prev) => prev.filter((set) => set.id !== id));
    if (activeSetId === id) setActiveSetId('');
  }
  const chartModeOptions =
    scope === 'current'
      ? [
          { key: 'event_matches', label: 'Loaded Event Match Chronology' },
          { key: 'distribution', label: 'Loaded Event Breakdown Comparison' },
        ]
      : [
          { key: 'season_events', label: 'Historical Event Chronology' },
          { key: 'season_matches', label: 'Historical Match Chronology' },
          { key: 'distribution', label: 'Historical Breakdown Comparison' },
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
          <input
            className="input"
            value={addInput}
            onChange={(event) => setAddInput(event.target.value)}
            placeholder="Add teams: 5431 9128 10340"
            style={{ width: 220 }}
          />
          <button className="button" onClick={addTeamsFromInput}>
            {t('compare.add_teams', 'Add teams')}
          </button>
          {scope === 'current' ? (
            <>
              <select
                className="input"
                value={eventTeamPick}
                onChange={(event) => setEventTeamPick(event.target.value)}
              >
                <option value="">
                  {t('compare.add_from_current_event', 'Add from current event')}
                </option>
                {eventOptions.map((row) => (
                  <option key={row.teamKey} value={row.teamNumber}>
                    {row.teamNumber} {row.nickname}
                  </option>
                ))}
              </select>
              <button className="button" onClick={addEventTeam}>
                {t('compare.add_current_event_team', 'Add current-event team')}
              </button>
            </>
          ) : null}
          <select
            className="input"
            value={draft.baselineTeamNumber ?? ''}
            onChange={(event) =>
              updateDraft({
                baselineTeamNumber: event.target.value ? Number(event.target.value) : null,
              })
            }
          >
            <option value="">{t('compare.baseline', 'Baseline')}</option>
            {selectedTeamNumbers.map((teamNumber) => (
              <option key={teamNumber} value={teamNumber}>
                {teamNumber}
              </option>
            ))}
          </select>
          <button
            className="button"
            onClick={saveCurrentSet}
            disabled={!selectedTeamNumbers.length}
          >
            {t('compare.save_set', 'Save set')}
          </button>
          <select
            className="input"
            value={activeSetId}
            onChange={(event) => loadSet(event.target.value)}
          >
            <option value="">{t('compare.load_saved_set', 'Load saved set')}</option>
            {savedSets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </select>
          <span className="badge">
            {scope === 'current'
              ? t('compare.current_compare', 'Current Compare')
              : t('compare.historical_compare', 'Historical Compare')}
          </span>
          {isLoading ? (
            <span className="badge badge-green">{t('status.loading', 'Loading...')}</span>
          ) : null}
          {errorText ? <span className="badge badge-red">{errorText}</span> : null}
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {selectedTeamNumbers.map((teamNumber) => (
            <button key={teamNumber} className="button" onClick={() => removeTeam(teamNumber)}>
              Remove {teamNumber}
            </button>
          ))}
        </div>
      </div>

      <AnalyticsTableBlock
        title={
          scope === 'current'
            ? t('compare.loaded_event_title', 'Loaded Event Compare')
            : t('compare.historical_title', 'Historical 2026 Compare')
        }
        description={
          scope === 'current'
            ? t(
                'compare.loaded_event_description',
                'Current-event-only compare table and narratives.',
              )
            : t(
                'compare.historical_description',
                'Historical-only compare table using 2026 data excluding the loaded event.',
              )
        }
      >
        {!compareTeams.length ? (
          <div className="muted">{t('compare.add_to_start', 'Add teams to start comparing.')}</div>
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
              minWidth: 1520,
            }}
          >
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th
                  style={{
                    padding: 8,
                    borderBottom: '1px solid #223048',
                    position: 'sticky',
                    left: 0,
                    background: '#111826',
                    zIndex: 1,
                  }}
                >
                  Team
                </th>
                {scope === 'current' ? (
                  <>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Rank</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>TOTAL RP</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>EPA</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Auto</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Tele</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>End</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>OPR</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>COPR</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>DPR</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>CCWM</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Comp</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Played SOS</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Remain SOS</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Matches</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Delta EPA</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Delta OPR</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Status</th>
                  </>
                ) : (
                  <>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Current EPA</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Mean</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Auto</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Teleop</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Endgame</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>District Pts</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>World Rank</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Country %</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>District %</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Win %</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Events</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Matches</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {compareTeams.map((team) => (
                <tr
                  key={team.teamKey}
                  style={{
                    background:
                      Number(team.teamNumber) === Number(draft.baselineTeamNumber)
                        ? '#132033'
                        : undefined,
                    verticalAlign: 'top',
                  }}
                >
                  <td
                    style={{
                      padding: 8,
                      borderBottom: '1px solid #1a2333',
                      position: 'sticky',
                      left: 0,
                      background:
                        Number(team.teamNumber) === Number(draft.baselineTeamNumber)
                          ? '#132033'
                          : '#111826',
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>{team.teamNumber}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {team.nickname}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <button
                        className="button"
                        onClick={() => onOpenTeamProfile?.(team.teamNumber)}
                      >
                        TEAM_PROFILE
                      </button>
                    </div>
                  </td>
                  {scope === 'current' ? (
                    <>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.eventRank, 0)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.eventTotalRp, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.eventEpa, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.eventAuto, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.eventTeleop, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.eventEndgame, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.eventOpr, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.eventCopr, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.eventDpr, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.eventCcwm, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.eventComposite, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.eventPlayedSos, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.eventRemainingSos, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.eventMatchCount, 0)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {renderSemanticDelta(
                          'event_epa',
                          team?.derived?.eventEpa,
                          baselineTeam?.derived?.eventEpa,
                          1,
                        )}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {renderSemanticDelta(
                          'event_opr',
                          team?.derived?.eventOpr,
                          baselineTeam?.derived?.eventOpr,
                          1,
                        )}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                          minWidth: 280,
                        }}
                      >
                        <SafeRichText html={team?.derived?.eventStatusHtml ?? '-'} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.seasonCurrentEpa, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.seasonMeanTotal, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.seasonAuto, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.seasonTeleop, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.seasonEndgame, 1)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.seasonDistrictPoints, 0)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(team?.derived?.seasonWorldRank, 0)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {team?.derived?.seasonCountryPercentile != null
                          ? `${fmt(Number(team.derived.seasonCountryPercentile) * 100, 0)}%`
                          : '-'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {team?.derived?.seasonDistrictPercentile != null
                          ? `${fmt(Number(team.derived.seasonDistrictPercentile) * 100, 0)}%`
                          : '-'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {team?.derived?.seasonWinRate != null
                          ? `${fmt(Number(team.derived.seasonWinRate) * 100, 0)}%`
                          : '-'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {team?.historicalPlayedEvents?.length ?? 0}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {team?.historicalMatches?.length ?? 0}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </AnalyticsTableBlock>

      <DisclosureSection
        storageKey={`ui.compare.${scope}.charts`}
        title="Comparison Charts"
        description={t(
          'compare.charts_description',
          'Metric and distribution charting for the active compare set.',
        )}
      >
        <div className="panel" style={{ padding: 16 }}>
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'flex-end',
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Chart mode
              </span>
              <select
                className="input"
                value={draft.chartMode}
                onChange={(event) => updateDraft({ chartMode: event.target.value })}
              >
                {chartModeOptions.map((mode) => (
                  <option key={mode.key} value={mode.key}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>
            {draft.chartMode !== 'distribution' ? (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  Metric
                </span>
                <select
                  className="input"
                  value={draft.metricKey}
                  onChange={(event) => updateDraft({ metricKey: event.target.value })}
                >
                  {compareMetricOptions.map((metric) => (
                    <option key={metric.key} value={metric.key}>
                      {metric.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {draft.chartMode !== 'distribution' ? (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  Smoothing
                </span>
                <select
                  className="input"
                  value={draft.smoothingWindow}
                  onChange={(event) => updateDraft({ smoothingWindow: Number(event.target.value) })}
                >
                  <option value={1}>No smoothing</option>
                  <option value={2}>Window 2</option>
                  <option value={3}>Window 3</option>
                  <option value={5}>Window 5</option>
                </select>
              </label>
            ) : null}
            {draft.chartMode !== 'distribution' ? (
              <label
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  marginBottom: 6,
                }}
              >
                <input
                  type="checkbox"
                  checked={draft.baselineOverlay}
                  onChange={(event) => updateDraft({ baselineOverlay: event.target.checked })}
                />
                Baseline overlay
              </label>
            ) : null}
          </div>
          <div style={{ marginTop: 12 }}>
            <AnalyticsChartBlock
              title={
                scope === 'current' ? 'Loaded Event Compare Charts' : 'Historical Compare Charts'
              }
              description={
                draft.chartMode === 'distribution'
                  ? scope === 'current'
                    ? 'Loaded-event phase distribution across the compare set.'
                    : 'Historical season phase distribution across the compare set.'
                  : (getAnalyticsMetric(draft.metricKey)?.label ?? draft.metricKey)
              }
              data={chartData}
              chartFamily={
                draft.chartMode === 'distribution'
                  ? 'bar'
                  : (getAnalyticsMetric(draft.metricKey)?.defaultChartFamily ?? 'line')
              }
              series={chartSeries}
              valueFormatter={(value) =>
                draft.chartMode === 'distribution'
                  ? fmt(value, 1)
                  : formatAnalyticsMetricValue(draft.metricKey, value, language)
              }
            />
          </div>
        </div>
      </DisclosureSection>

      <DisclosureSection
        storageKey={`ui.compare.${scope}.supporting`}
        title={scope === 'current' ? 'Match History + Breakdown' : 'Event History + Distribution'}
        description="Deeper comparison history, breakdown matrices, and distribution views for the active set."
      >
        {scope === 'current' ? (
          <div className="grid-2">
            <AnalyticsTableBlock
              title="Loaded Event Match History Compare"
              description="Current-event-only match history for each selected team."
            >
              <div className="stack-12">
                {compareTeams.map((team) => (
                  <div
                    key={`current_history_${team.teamKey}`}
                    className="panel-2"
                    style={{ padding: 12 }}
                  >
                    <div style={{ fontWeight: 900 }}>
                      {team.teamNumber} {team.nickname}
                    </div>
                    <div style={{ overflow: 'auto', marginTop: 8 }}>
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
                                padding: 6,
                                borderBottom: '1px solid #223048',
                              }}
                            >
                              Match
                            </th>
                            <th
                              style={{
                                padding: 6,
                                borderBottom: '1px solid #223048',
                              }}
                            >
                              Result
                            </th>
                            <th
                              style={{
                                padding: 6,
                                borderBottom: '1px solid #223048',
                              }}
                            >
                              RP
                            </th>
                            <th
                              style={{
                                padding: 6,
                                borderBottom: '1px solid #223048',
                              }}
                            >
                              EPA
                            </th>
                            <th
                              style={{
                                padding: 6,
                                borderBottom: '1px solid #223048',
                              }}
                            >
                              Score
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(team?.eventMatches ?? []).map((match) => (
                            <tr key={match.key}>
                              <td
                                style={{
                                  padding: 6,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {match?.matchLabel ?? match.key}
                              </td>
                              <td
                                style={{
                                  padding: 6,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {match?.result ?? '-'}
                              </td>
                              <td
                                style={{
                                  padding: 6,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {fmt(match?.rp, 1)}
                              </td>
                              <td
                                style={{
                                  padding: 6,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {fmt(match?.epaTotal, 1)}
                              </td>
                              <td
                                style={{
                                  padding: 6,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {fmt(match?.myScore, 0)} / {fmt(match?.oppScore, 0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </AnalyticsTableBlock>
            {currentBreakdownFields.length ? (
              <RawBreakdownMatrix
                title="Loaded Event Breakdown Matrix"
                description="Current-event breakdown values across the compare set."
                fields={currentBreakdownFields}
                rows={currentBreakdownRows}
                baselineTeamNumber={draft.baselineTeamNumber}
              />
            ) : (
              <div className="panel" style={{ padding: 16 }}>
                <div className="muted">No current-event breakdown matrix available yet.</div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid-2">
            <AnalyticsTableBlock
              title="Historical Event / Match History Compare"
              description="Historical-only event context for each selected team."
            >
              <div className="stack-12">
                {compareTeams.map((team) => (
                  <div
                    key={`historical_history_${team.teamKey}`}
                    className="panel-2"
                    style={{ padding: 12 }}
                  >
                    <div style={{ fontWeight: 900 }}>
                      {team.teamNumber} {team.nickname}
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      Played {team?.historicalPlayedEvents?.length ?? 0} | Upcoming{' '}
                      {team?.historicalUpcomingEvents?.length ?? 0} | Historical matches{' '}
                      {team?.historicalMatches?.length ?? 0}
                    </div>
                    <div style={{ overflow: 'auto', marginTop: 8 }}>
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
                                padding: 6,
                                borderBottom: '1px solid #223048',
                              }}
                            >
                              Event
                            </th>
                            <th
                              style={{
                                padding: 6,
                                borderBottom: '1px solid #223048',
                              }}
                            >
                              Week
                            </th>
                            <th
                              style={{
                                padding: 6,
                                borderBottom: '1px solid #223048',
                              }}
                            >
                              EPA
                            </th>
                            <th
                              style={{
                                padding: 6,
                                borderBottom: '1px solid #223048',
                              }}
                            >
                              Qual Rank
                            </th>
                            <th
                              style={{
                                padding: 6,
                                borderBottom: '1px solid #223048',
                              }}
                            >
                              District Pts
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ...(team?.historicalPlayedEvents ?? []),
                            ...(team?.historicalUpcomingEvents ?? []),
                          ].map((eventRow) => (
                            <tr key={`${team.teamKey}_${eventRow.event}`}>
                              <td
                                style={{
                                  padding: 6,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {eventRow?.event_name ?? eventRow?.event}
                              </td>
                              <td
                                style={{
                                  padding: 6,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {eventRow?.week ?? '-'}
                              </td>
                              <td
                                style={{
                                  padding: 6,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {fmt(eventRow?.epa?.norm, 1)}
                              </td>
                              <td
                                style={{
                                  padding: 6,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {eventRow?.record?.qual?.rank ?? '-'}
                              </td>
                              <td
                                style={{
                                  padding: 6,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {eventRow?.district_points ?? '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </AnalyticsTableBlock>
            {historicalBreakdownFields.length ? (
              <RawBreakdownMatrix
                title="Historical Breakdown Matrix"
                description="Historical season breakdown values across the compare set."
                fields={historicalBreakdownFields}
                rows={historicalBreakdownRows}
                baselineTeamNumber={draft.baselineTeamNumber}
              />
            ) : (
              <div className="panel" style={{ padding: 16 }}>
                <div className="muted">No historical breakdown matrix available yet.</div>
              </div>
            )}
          </div>
        )}
      </DisclosureSection>

      <div className="grid-2">
        <AnalyticsTableBlock
          title="Saved Set Notes"
          description="Saved compare notes stay shared between current and historical compare."
        >
          {activeSet ? (
            <div className="panel-2" style={{ padding: 12 }}>
              <div style={{ fontWeight: 900 }}>{activeSet.name}</div>
              <div className="muted" style={{ marginTop: 6 }}>
                Saved {new Date(activeSet.updatedAtMs).toLocaleString()}
              </div>
              <div style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>
                {activeSet.note?.text || 'No saved note.'}
              </div>
              <div style={{ marginTop: 10 }}>
                <button className="button" onClick={() => deleteSet(activeSet.id)}>
                  Delete saved set
                </button>
              </div>
            </div>
          ) : (
            <div className="muted">
              Load a saved compare set to view its saved note snapshot here.
            </div>
          )}
        </AnalyticsTableBlock>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Working Note</div>
          <textarea
            className="input"
            value={draft.note ?? ''}
            onChange={(event) => updateDraft({ note: event.target.value })}
            placeholder="Save compare reasoning, watch items, or draft notes here."
            style={{ minHeight: 180, width: '100%', resize: 'vertical' }}
          />
        </div>
      </div>
    </div>
  );
}
