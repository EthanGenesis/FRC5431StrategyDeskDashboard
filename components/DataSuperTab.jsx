'use client';
import { useEffect, useMemo, useState } from 'react';
import { fetchJsonOrThrow } from '../lib/httpCache';
import LazySectionMount from './LazySectionMount';
import AnalyticsChartBlock from './AnalyticsChartBlock';
import AnalyticsTableBlock from './AnalyticsTableBlock';
import MetricPicker from './MetricPicker';
import RawBreakdownMatrix from './RawBreakdownMatrix';
import SafeRichText from './SafeRichText';
import DisclosureSection from './ui/DisclosureSection';
import {
  buildBreakdownMatrixFields,
  buildBreakdownMatrixRows,
  buildCompareSeriesPoints,
  derivedMetricValue,
  eventMetricValue,
  formatAnalyticsMetricValue,
  getAnalyticsMetric,
  listAnalyticsMetrics,
  scenarioMetricValue,
  seasonEventMetricValue,
  seasonMatchMetricValue,
} from '../lib/analytics-registry';
import { loadCompareDraft } from '../lib/compare-storage';
function uniqNumbers(values) {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => Math.floor(Number(value)))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  );
}
function chartModeForMetric(metricKey) {
  if (metricKey.startsWith('event_match_')) return 'event_matches';
  if (metricKey.startsWith('season_match_')) return 'season_matches';
  return 'season_events';
}
function mergeCompareSeries(compareTeams, metricKey) {
  const chartMode = chartModeForMetric(metricKey);
  const perTeam = compareTeams.map((team) => {
    const metric = getAnalyticsMetric(metricKey);
    return {
      team,
      points: buildCompareSeriesPoints(
        team,
        chartMode,
        metricKey,
        metric?.defaultSmoothingWindow ?? 1,
      ),
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
function paletteColor(index) {
  return ['#f3be3b', '#4bb3fd', '#ff6b6b', '#8ad17d', '#c084fc', '#2dd4bf', '#f472b6', '#facc15'][
    index % 8
  ];
}
export default function DataSuperTab({
  loadedEventKey,
  loadedTeam,
  snapshot,
  projectedRows = [],
  deterministicRows = [],
  monteCarloProjection = null,
  allianceRuntime = null,
  liveAllianceRuntime = null,
  savedPlayoffResults = [],
  compareSyncKey = 0,
  scope = 'current',
}) {
  const [superData, setSuperData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [chartSource, setChartSource] = useState(
    scope === 'current' ? 'event_wide' : 'compare_historical',
  );
  const [chartMetric, setChartMetric] = useState(
    scope === 'current' ? 'event_epa' : 'season_match_epa',
  );
  const [chartFamily, setChartFamily] = useState('bar');
  const [compareDraft, setCompareDraft] = useState(() => loadCompareDraft(scope));
  useEffect(() => {
    setCompareDraft(loadCompareDraft(scope));
  }, [scope, compareSyncKey]);
  const compareTeams = useMemo(
    () => uniqNumbers([...(compareDraft?.teamNumbers ?? []), loadedTeam].filter(Boolean)),
    [compareDraft, loadedTeam],
  );
  const compareRequestTeams = useMemo(() => [...compareTeams], [compareTeams]);
  useEffect(() => {
    let cancelled = false;
    async function loadSuperData() {
      setIsLoading(true);
      setErrorText('');
      try {
        const json = await fetchJsonOrThrow(
          '/api/data-super',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventKey: loadedEventKey || '',
              loadedTeam: loadedTeam || '',
              compareTeams: compareRequestTeams,
            }),
            cache: 'no-store',
          },
          'DATA supertab load failed',
        );
        if (!cancelled) setSuperData(json);
      } catch (error) {
        if (!cancelled) {
          setSuperData(null);
          setErrorText(error?.message ?? 'Unknown DATA supertab error');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadSuperData();
    return () => {
      cancelled = true;
    };
  }, [loadedEventKey, loadedTeam, compareRequestTeams]);
  useEffect(() => {
    setChartSource(scope === 'current' ? 'event_wide' : 'compare_historical');
    setChartMetric(scope === 'current' ? 'event_epa' : 'season_match_epa');
    setChartFamily('bar');
  }, [scope]);
  const eventRows = useMemo(() => superData?.currentEvent?.eventRows ?? [], [superData]);
  const compareSnapshot = superData?.compare ?? null;
  const compareRows = useMemo(() => compareSnapshot?.teams ?? [], [compareSnapshot]);
  const historyTeam = superData?.historicalTeam ?? null;
  const currentBreakdownFields = useMemo(
    () => buildBreakdownMatrixFields(compareRows, 'event'),
    [compareRows],
  );
  const currentBreakdownRows = useMemo(
    () => buildBreakdownMatrixRows(compareRows, 'event'),
    [compareRows],
  );
  const historicalBreakdownFields = useMemo(
    () => buildBreakdownMatrixFields(compareRows, 'season'),
    [compareRows],
  );
  const historicalBreakdownRows = useMemo(
    () => buildBreakdownMatrixRows(compareRows, 'season'),
    [compareRows],
  );
  const currentEventChartRows = useMemo(
    () =>
      [...eventRows]
        .map((row) => ({
          label: `${row.teamNumber}`,
          epa: eventMetricValue(row, 'event_epa'),
          opr: eventMetricValue(row, 'event_opr'),
          comp: eventMetricValue(row, 'event_composite'),
          rp: eventMetricValue(row, 'event_total_rp'),
        }))
        .filter((row) => row.epa != null || row.opr != null || row.comp != null || row.rp != null),
    [eventRows],
  );
  const historicalEventRows = useMemo(
    () =>
      (historyTeam?.historicalPlayedEvents ?? []).map((eventRow, index) => ({
        label: eventRow?.event_name ?? eventRow?.event ?? `Event ${index + 1}`,
        epa: eventRow?.epa?.norm ?? null,
        districtPoints: eventRow?.district_points ?? null,
        qualRank: eventRow?.record?.qual?.rank ?? null,
      })),
    [historyTeam],
  );
  const historicalMatchRows = useMemo(
    () =>
      (historyTeam?.historicalMatches ?? []).slice(-24).map((match, index) => ({
        label: match?.matchLabel ?? `Match ${index + 1}`,
        epa: match?.epaTotal ?? null,
        auto: match?.breakdown?.auto_points ?? null,
        teleop: match?.breakdown?.teleop_points ?? null,
        endgame: match?.breakdown?.endgame_points ?? null,
        margin: match?.margin ?? null,
      })),
    [historyTeam],
  );
  const currentEventMetricKeys = useMemo(
    () =>
      listAnalyticsMetrics({
        scopes: ['current_event', 'event_wide'],
        tabs: ['DATA'],
      })
        .map((metric) => metric.key)
        .filter((key) => !key.startsWith('event_match_')),
    [],
  );
  const currentCompareMetricKeys = useMemo(
    () =>
      listAnalyticsMetrics({
        scopes: ['current_event', 'compare'],
        tabs: ['DATA'],
      })
        .map((metric) => metric.key)
        .filter((key) => key.startsWith('event_match_')),
    [],
  );
  const historicalSummaryMetricKeys = useMemo(
    () => [
      'season_current_epa',
      'season_mean_total',
      'season_auto',
      'season_teleop',
      'season_endgame',
      'season_district_points',
      'season_world_rank',
      'season_country_percentile',
      'season_district_percentile',
      'season_win_rate',
      'season_match_count',
    ],
    [],
  );
  const historicalEventMetricKeys = useMemo(
    () =>
      listAnalyticsMetrics({
        scopes: ['historical_2026_excluding_loaded_event'],
        tabs: ['DATA'],
      })
        .map((metric) => metric.key)
        .filter((key) => key.startsWith('season_event_')),
    [],
  );
  const historicalMatchMetricKeys = useMemo(
    () =>
      listAnalyticsMetrics({
        scopes: ['historical_2026_excluding_loaded_event'],
        tabs: ['DATA'],
      })
        .map((metric) => metric.key)
        .filter((key) => key.startsWith('season_match_')),
    [],
  );
  const scenarioMetricKeys = useMemo(
    () =>
      listAnalyticsMetrics({ scopes: ['scenario'], tabs: ['DATA'] }).map((metric) => metric.key),
    [],
  );
  const chartData = useMemo(() => {
    if (chartSource === 'event_wide') {
      return [...eventRows]
        .map((row) => ({
          label: `${row.teamNumber}`,
          value: eventMetricValue(row, chartMetric),
        }))
        .filter((row) => row.value != null)
        .sort((a, b) => Number(b.value) - Number(a.value));
    }
    if (chartSource === 'compare_current' || chartSource === 'compare_historical') {
      return mergeCompareSeries(compareRows, chartMetric);
    }
    if (chartSource === 'scenario_projected') {
      return projectedRows.slice(0, 32).map((row) => ({
        label: `${row.teamNumber}`,
        value: scenarioMetricValue(row, chartMetric),
      }));
    }
    if (chartSource === 'scenario_mc') {
      return (monteCarloProjection?.rows ?? []).slice(0, 32).map((row) => ({
        label: `${row.teamNumber}`,
        value: scenarioMetricValue(row, chartMetric),
      }));
    }
    return [];
  }, [chartSource, chartMetric, eventRows, compareRows, projectedRows, monteCarloProjection]);
  const chartSeries = useMemo(() => {
    if (chartSource === 'event_wide' || chartSource.startsWith('scenario')) {
      return [
        {
          key: 'value',
          label: getAnalyticsMetric(chartMetric)?.shortLabel ?? chartMetric,
          color: getAnalyticsMetric(chartMetric)?.color ?? '#4bb3fd',
        },
      ];
    }
    return compareRows.map((team, index) => ({
      key: `team_${team.teamNumber}`,
      label: `${team.teamNumber}`,
      color: paletteColor(index),
      type: chartFamily === 'step' ? 'step' : 'line',
    }));
  }, [chartSource, chartMetric, compareRows, chartFamily]);
  const metricScopeFilters =
    chartSource === 'event_wide'
      ? ['current_event', 'event_wide']
      : chartSource === 'compare_current'
        ? ['current_event', 'compare']
        : chartSource === 'compare_historical'
          ? ['historical_2026_excluding_loaded_event', 'compare']
          : ['scenario'];
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
          <span className="badge">{scope === 'current' ? 'Current DATA' : 'Historical DATA'}</span>
          {loadedEventKey ? (
            <span className="badge">Loaded Event {loadedEventKey}</span>
          ) : (
            <span className="badge">Season-Only</span>
          )}
          {loadedTeam ? <span className="badge">Loaded Team {loadedTeam}</span> : null}
          {isLoading ? <span className="badge badge-green">Loading...</span> : null}
          {errorText ? <span className="badge badge-red">{errorText}</span> : null}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          {scope === 'current'
            ? 'Current-event-only analytics hub: event core, compare current event, scenario context, and current breakdown matrices.'
            : 'Historical-only analytics hub: 2026 excluding the loaded event, historical compare, and season breakdown matrices.'}
        </div>
      </div>

      <DisclosureSection
        storageKey={`ui.data_super.${scope}.overview`}
        title="DATA Overview"
        description="Scope status, team counts, and route coverage for the active DATA workspace."
        defaultOpen
      >
        <LazySectionMount>
          <div className="grid-3">
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900 }}>
                {scope === 'current' ? 'Current Event Teams' : 'Historical Played Events'}
              </div>
              <div style={{ fontSize: 26, marginTop: 8 }}>
                {scope === 'current'
                  ? (superData?.diagnostics?.eventTeamCount ?? 0)
                  : (historyTeam?.historicalPlayedEvents?.length ?? 0)}
              </div>
            </div>
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900 }}>
                {scope === 'current' ? 'Compare Teams' : 'Historical Matches'}
              </div>
              <div style={{ fontSize: 26, marginTop: 8 }}>
                {scope === 'current'
                  ? (superData?.diagnostics?.compareTeamCount ?? 0)
                  : (historyTeam?.historicalMatches?.length ?? 0)}
              </div>
            </div>
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900 }}>
                {scope === 'current' ? 'TBA Matches' : 'Diagnostics'}
              </div>
              <div style={{ fontSize: 26, marginTop: 8 }}>
                {scope === 'current'
                  ? (superData?.diagnostics?.tbaMatchCount ?? 0)
                  : superData?.diagnostics?.generatedAtMs
                    ? 1
                    : 0}
              </div>
            </div>
          </div>
        </LazySectionMount>
      </DisclosureSection>

      {scope === 'current' ? (
        <>
          <LazySectionMount>
            <AnalyticsTableBlock
              title="Current Event Core"
              description="Current-event-only loaded event rows and status narratives."
            >
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
                    {[
                      'event_rank',
                      'event_total_rp',
                      'event_epa',
                      'event_auto',
                      'event_teleop',
                      'event_endgame',
                      'event_opr',
                      'event_copr',
                      'event_dpr',
                      'event_ccwm',
                      'event_composite',
                      'event_sos',
                    ].map((metricKey) => (
                      <th
                        key={metricKey}
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #223048',
                        }}
                      >
                        {getAnalyticsMetric(metricKey)?.shortLabel ?? metricKey}
                      </th>
                    ))}
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {eventRows.map((row) => (
                    <tr key={row.teamKey}>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        <div className="mono">{row.teamNumber}</div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {row.nickname}
                        </div>
                      </td>
                      {[
                        'event_rank',
                        'event_total_rp',
                        'event_epa',
                        'event_auto',
                        'event_teleop',
                        'event_endgame',
                        'event_opr',
                        'event_copr',
                        'event_dpr',
                        'event_ccwm',
                        'event_composite',
                        'event_sos',
                      ].map((metricKey) => (
                        <td
                          key={metricKey}
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #1a2333',
                          }}
                        >
                          {formatAnalyticsMetricValue(metricKey, eventMetricValue(row, metricKey))}
                        </td>
                      ))}
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                          minWidth: 240,
                          verticalAlign: 'top',
                        }}
                      >
                        <SafeRichText html={row?.derived?.eventStatusHtml ?? '-'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AnalyticsTableBlock>
          </LazySectionMount>

          <LazySectionMount>
            <div className="grid-2">
              <AnalyticsChartBlock
                title="Current Event Distribution: EPA / OPR"
                description="Field-wide loaded-event strength view."
                data={currentEventChartRows}
                chartFamily="bar"
                series={[
                  { key: 'epa', label: 'EPA', color: '#ff9f68' },
                  { key: 'opr', label: 'OPR', color: '#ff6b6b' },
                ]}
                valueFormatter={(value) => formatAnalyticsMetricValue('event_epa', value)}
              />
              <AnalyticsChartBlock
                title="Current Event Distribution: Composite / RP"
                description="Current-event standings context."
                data={currentEventChartRows}
                chartFamily="bar"
                series={[
                  { key: 'comp', label: 'Composite', color: '#f3be3b' },
                  { key: 'rp', label: 'Total RP', color: '#4bb3fd' },
                ]}
                valueFormatter={(value) => formatAnalyticsMetricValue('event_total_rp', value)}
              />
            </div>
          </LazySectionMount>
          <LazySectionMount>
            <AnalyticsChartBlock
              title="Current Event Phase Distribution"
              description="Auto, teleop, and endgame EPA across the full loaded field."
              data={eventRows.map((row) => ({
                label: `${row.teamNumber}`,
                auto: eventMetricValue(row, 'event_auto'),
                teleop: eventMetricValue(row, 'event_teleop'),
                endgame: eventMetricValue(row, 'event_endgame'),
              }))}
              chartFamily="bar"
              series={[
                { key: 'auto', label: 'Auto', color: '#8ad17d' },
                { key: 'teleop', label: 'Teleop', color: '#2dd4bf' },
                { key: 'endgame', label: 'Endgame', color: '#c084fc' },
              ]}
              valueFormatter={(value) => formatAnalyticsMetricValue('event_auto', value)}
            />
          </LazySectionMount>

          <LazySectionMount>
            <div className="grid-2">
              <AnalyticsTableBlock
                title="Current Compare / Multi-Team"
                description="Compare draft rendered as current-event-only multi-team analytics."
              >
                {!compareRows.length ? (
                  <div className="muted">
                    Add teams to COMPARE to populate the current compare view.
                  </div>
                ) : (
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
                          Team
                        </th>
                        <th
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #223048',
                          }}
                        >
                          Rank
                        </th>
                        <th
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #223048',
                          }}
                        >
                          RP
                        </th>
                        <th
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #223048',
                          }}
                        >
                          EPA
                        </th>
                        <th
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #223048',
                          }}
                        >
                          OPR
                        </th>
                        <th
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #223048',
                          }}
                        >
                          Comp
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareRows.map((team) => (
                        <tr key={team.teamKey}>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {team.teamNumber} {team.nickname}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {formatAnalyticsMetricValue('event_rank', team?.derived?.eventRank)}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {formatAnalyticsMetricValue(
                              'event_total_rp',
                              team?.derived?.eventTotalRp,
                            )}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {formatAnalyticsMetricValue('event_epa', team?.derived?.eventEpa)}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {formatAnalyticsMetricValue('event_opr', team?.derived?.eventOpr)}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {formatAnalyticsMetricValue(
                              'event_composite',
                              team?.derived?.eventComposite,
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </AnalyticsTableBlock>
              {compareRows.length ? (
                <AnalyticsChartBlock
                  title="Current Compare: Rolling OPR"
                  description="Current compare teams over loaded-event match chronology."
                  data={mergeCompareSeries(compareRows, 'event_match_rolling_opr')}
                  chartFamily="line"
                  series={compareRows.map((team, index) => ({
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
                  }))}
                  valueFormatter={(value) =>
                    formatAnalyticsMetricValue('event_match_rolling_opr', value)
                  }
                />
              ) : (
                <div className="panel" style={{ padding: 16 }}>
                  <div className="muted">Compare charts appear when COMPARE has teams loaded.</div>
                </div>
              )}
            </div>
          </LazySectionMount>
          <LazySectionMount>
            <div className="grid-2">
              <AnalyticsChartBlock
                title="Current Compare: Match EPA"
                description="Loaded-event EPA chronology across the compare set."
                data={mergeCompareSeries(compareRows, 'event_match_epa')}
                chartFamily="line"
                series={compareRows.map((team, index) => ({
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
                }))}
                valueFormatter={(value) => formatAnalyticsMetricValue('event_match_epa', value)}
              />
              <AnalyticsChartBlock
                title="Current Compare: Match RP"
                description="Loaded-event RP chronology across the compare set."
                data={mergeCompareSeries(compareRows, 'event_match_rp')}
                chartFamily="step"
                series={compareRows.map((team, index) => ({
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
                  type: 'step',
                }))}
                valueFormatter={(value) => formatAnalyticsMetricValue('event_match_rp', value)}
              />
            </div>
          </LazySectionMount>

          {compareRows.length && currentBreakdownFields.length ? (
            <LazySectionMount>
              <RawBreakdownMatrix
                title="Current Breakdown Matrix"
                description="Loaded-event breakdown values across the compare set."
                fields={currentBreakdownFields}
                rows={currentBreakdownRows}
                baselineTeamNumber={compareDraft?.baselineTeamNumber ?? loadedTeam ?? null}
              />
            </LazySectionMount>
          ) : null}
          <LazySectionMount>
            <AnalyticsTableBlock
              title="Current Event Metric Matrix"
              description="All current-event metrics supported by the current data stack, wide-open in one table."
            >
              <div style={{ overflow: 'auto', maxHeight: 620 }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 12,
                    minWidth: 1880,
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
                        Team
                      </th>
                      {currentEventMetricKeys.map((metricKey) => (
                        <th
                          key={metricKey}
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #223048',
                          }}
                        >
                          {getAnalyticsMetric(metricKey)?.shortLabel ?? metricKey}
                        </th>
                      ))}
                      <th
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #223048',
                        }}
                      >
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventRows.map((row) => (
                      <tr key={`current_metric_${row.teamKey}`}>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #1a2333',
                          }}
                        >
                          <div className="mono">{row.teamNumber}</div>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {row.nickname}
                          </div>
                        </td>
                        {currentEventMetricKeys.map((metricKey) => (
                          <td
                            key={metricKey}
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {formatAnalyticsMetricValue(
                              metricKey,
                              eventMetricValue(row, metricKey),
                            )}
                          </td>
                        ))}
                        <td
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #1a2333',
                            minWidth: 240,
                            verticalAlign: 'top',
                          }}
                        >
                          <SafeRichText html={row?.derived?.eventStatusHtml ?? '-'} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AnalyticsTableBlock>
          </LazySectionMount>
          <LazySectionMount>
            <div className="grid-2">
              {currentEventMetricKeys.map((metricKey) => {
                const metric = getAnalyticsMetric(metricKey);
                const data = [...eventRows]
                  .map((row) => ({
                    label: `${row.teamNumber}`,
                    value: eventMetricValue(row, metricKey),
                  }))
                  .filter((row) => row.value != null)
                  .sort((a, b) => Number(b.value) - Number(a.value));
                if (!data.length) return null;
                return (
                  <AnalyticsChartBlock
                    key={`current_metric_chart_${metricKey}`}
                    title={`Current Metric Deck: ${metric?.label ?? metricKey}`}
                    description="Every current-event metric available from the loaded field."
                    data={data}
                    chartFamily={metric?.defaultChartFamily ?? 'bar'}
                    series={[
                      {
                        key: 'value',
                        label: metric?.shortLabel ?? metricKey,
                        color: metric?.color ?? '#4bb3fd',
                      },
                    ]}
                    valueFormatter={(value) => formatAnalyticsMetricValue(metricKey, value)}
                  />
                );
              })}
            </div>
          </LazySectionMount>
          {compareRows.length && currentCompareMetricKeys.length ? (
            <LazySectionMount>
              <div className="grid-2">
                {currentCompareMetricKeys.map((metricKey) => {
                  const metric = getAnalyticsMetric(metricKey);
                  const data = mergeCompareSeries(compareRows, metricKey);
                  if (!data.length) return null;
                  return (
                    <AnalyticsChartBlock
                      key={`current_compare_metric_${metricKey}`}
                      title={`Current Compare Deck: ${metric?.label ?? metricKey}`}
                      description="Every current-event compare chronology available from the compare payload."
                      data={data}
                      chartFamily={metric?.defaultChartFamily ?? 'line'}
                      series={compareRows.map((team, index) => ({
                        key: `team_${team.teamNumber}`,
                        label: `${team.teamNumber}`,
                        color: paletteColor(index),
                        type: metric?.defaultChartFamily === 'step' ? 'step' : 'line',
                      }))}
                      valueFormatter={(value) => formatAnalyticsMetricValue(metricKey, value)}
                    />
                  );
                })}
              </div>
            </LazySectionMount>
          ) : null}
        </>
      ) : (
        <>
          <LazySectionMount>
            <div className="grid-2">
              <AnalyticsTableBlock
                title="Historical 2026 Core"
                description="Loaded-team historical-only summary excluding the loaded event."
              >
                {!historyTeam ? (
                  <div className="muted">Load a team to populate historical 2026 context.</div>
                ) : (
                  <div className="stack-8">
                    <div>
                      Team {historyTeam.teamNumber} {historyTeam.nickname}
                    </div>
                    <div>
                      Historical current EPA{' '}
                      {formatAnalyticsMetricValue(
                        'season_current_epa',
                        historyTeam?.derived?.seasonCurrentEpa,
                      )}
                    </div>
                    <div>
                      Historical mean total{' '}
                      {formatAnalyticsMetricValue(
                        'season_mean_total',
                        historyTeam?.derived?.seasonMeanTotal,
                      )}
                    </div>
                    <div>
                      District points{' '}
                      {formatAnalyticsMetricValue(
                        'season_district_points',
                        historyTeam?.derived?.seasonDistrictPoints,
                      )}
                    </div>
                    <div>
                      World rank{' '}
                      {formatAnalyticsMetricValue(
                        'season_world_rank',
                        historyTeam?.derived?.seasonWorldRank,
                      )}
                    </div>
                    <div>
                      Played events {historyTeam?.historicalPlayedEvents?.length ?? 0} | Historical
                      matches {historyTeam?.historicalMatches?.length ?? 0}
                    </div>
                  </div>
                )}
              </AnalyticsTableBlock>
              <AnalyticsChartBlock
                title="Historical Event Chronology"
                description="Historical event-only trends excluding the loaded event."
                data={historicalEventRows}
                chartFamily="bar"
                series={[
                  { key: 'epa', label: 'Event EPA', color: '#ff9f68' },
                  {
                    key: 'districtPoints',
                    label: 'District Points',
                    color: '#8ad17d',
                  },
                ]}
                valueFormatter={(value) => formatAnalyticsMetricValue('season_current_epa', value)}
              />
            </div>
          </LazySectionMount>
          <LazySectionMount>
            <div className="grid-2">
              <AnalyticsChartBlock
                title="Historical Match Chronology"
                description="Recent historical matches excluding the loaded event."
                data={historicalMatchRows}
                chartFamily="line"
                series={[
                  { key: 'epa', label: 'EPA', color: '#ff9f68' },
                  { key: 'margin', label: 'Margin', color: '#4bb3fd' },
                ]}
                valueFormatter={(value) => formatAnalyticsMetricValue('season_match_epa', value)}
              />
              <AnalyticsChartBlock
                title="Historical Match Phase Breakdown"
                description="Historical match-by-match phase output."
                data={historicalMatchRows}
                chartFamily="bar"
                series={[
                  { key: 'auto', label: 'Auto', color: '#8ad17d' },
                  { key: 'teleop', label: 'Teleop', color: '#2dd4bf' },
                  { key: 'endgame', label: 'Endgame', color: '#c084fc' },
                ]}
                valueFormatter={(value) => formatAnalyticsMetricValue('season_match_auto', value)}
              />
            </div>
          </LazySectionMount>

          <LazySectionMount>
            <div className="grid-2">
              <AnalyticsTableBlock
                title="Historical Compare / Multi-Team"
                description="Historical-only compare context across the historical compare draft."
              >
                {!compareRows.length ? (
                  <div className="muted">
                    Add teams to COMPARE to populate the historical compare view.
                  </div>
                ) : (
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
                          Team
                        </th>
                        <th
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #223048',
                          }}
                        >
                          Current EPA
                        </th>
                        <th
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #223048',
                          }}
                        >
                          Mean Total
                        </th>
                        <th
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #223048',
                          }}
                        >
                          District Pts
                        </th>
                        <th
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #223048',
                          }}
                        >
                          World Rank
                        </th>
                        <th
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #223048',
                          }}
                        >
                          Matches
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareRows.map((team) => (
                        <tr key={team.teamKey}>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {team.teamNumber} {team.nickname}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {formatAnalyticsMetricValue(
                              'season_current_epa',
                              team?.derived?.seasonCurrentEpa,
                            )}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {formatAnalyticsMetricValue(
                              'season_mean_total',
                              team?.derived?.seasonMeanTotal,
                            )}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {formatAnalyticsMetricValue(
                              'season_district_points',
                              team?.derived?.seasonDistrictPoints,
                            )}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {formatAnalyticsMetricValue(
                              'season_world_rank',
                              team?.derived?.seasonWorldRank,
                            )}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {team?.historicalMatches?.length ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </AnalyticsTableBlock>
              {compareRows.length ? (
                <AnalyticsChartBlock
                  title="Historical Compare: Match EPA"
                  description="Historical 2026 match chronology across the compare set."
                  data={mergeCompareSeries(compareRows, 'season_match_epa')}
                  chartFamily="line"
                  series={compareRows.map((team, index) => ({
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
                  }))}
                  valueFormatter={(value) => formatAnalyticsMetricValue('season_match_epa', value)}
                />
              ) : (
                <div className="panel" style={{ padding: 16 }}>
                  <div className="muted">
                    Historical compare charts appear when COMPARE has teams loaded.
                  </div>
                </div>
              )}
            </div>
          </LazySectionMount>
          <LazySectionMount>
            <div className="grid-2">
              <AnalyticsChartBlock
                title="Historical Compare: Event EPA"
                description="Historical event chronology across the compare set."
                data={mergeCompareSeries(compareRows, 'season_event_epa')}
                chartFamily="line"
                series={compareRows.map((team, index) => ({
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
                }))}
                valueFormatter={(value) => formatAnalyticsMetricValue('season_event_epa', value)}
              />
              <AnalyticsChartBlock
                title="Historical Compare: Match Margin"
                description="Historical match margin chronology across the compare set."
                data={mergeCompareSeries(compareRows, 'season_match_margin')}
                chartFamily="line"
                series={compareRows.map((team, index) => ({
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
                }))}
                valueFormatter={(value) => formatAnalyticsMetricValue('season_match_margin', value)}
              />
            </div>
          </LazySectionMount>

          {compareRows.length && historicalBreakdownFields.length ? (
            <LazySectionMount>
              <RawBreakdownMatrix
                title="Historical Breakdown Matrix"
                description="Historical season breakdown values across the compare set."
                fields={historicalBreakdownFields}
                rows={historicalBreakdownRows}
                baselineTeamNumber={compareDraft?.baselineTeamNumber ?? loadedTeam ?? null}
              />
            </LazySectionMount>
          ) : null}
          <LazySectionMount>
            <AnalyticsTableBlock
              title="Historical Metric Matrix"
              description="All historical summary metrics supported by the current historical team / compare payloads."
            >
              {!compareRows.length && !historyTeam ? (
                <div className="muted">
                  Load a historical team or historical compare set to populate the matrix.
                </div>
              ) : (
                <div style={{ overflow: 'auto', maxHeight: 620 }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: 12,
                      minWidth: 1580,
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
                          Team
                        </th>
                        {historicalSummaryMetricKeys.map((metricKey) => (
                          <th
                            key={metricKey}
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #223048',
                            }}
                          >
                            {getAnalyticsMetric(metricKey)?.shortLabel ?? metricKey}
                          </th>
                        ))}
                        <th
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #223048',
                          }}
                        >
                          Events
                        </th>
                        <th
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #223048',
                          }}
                        >
                          Matches
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(compareRows.length ? compareRows : [historyTeam])
                        .filter(Boolean)
                        .map((team) => (
                          <tr key={`historical_metric_${team.teamKey ?? team.teamNumber}`}>
                            <td
                              style={{
                                padding: 8,
                                borderBottom: '1px solid #1a2333',
                              }}
                            >
                              <div className="mono">{team.teamNumber}</div>
                              <div className="muted" style={{ fontSize: 11 }}>
                                {team.nickname}
                              </div>
                            </td>
                            {historicalSummaryMetricKeys.map((metricKey) => (
                              <td
                                key={metricKey}
                                style={{
                                  padding: 8,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {formatAnalyticsMetricValue(
                                  metricKey,
                                  derivedMetricValue(team, metricKey),
                                )}
                              </td>
                            ))}
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
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </AnalyticsTableBlock>
          </LazySectionMount>
          <LazySectionMount>
            <div className="grid-2">
              {historicalEventMetricKeys.map((metricKey) => {
                const metric = getAnalyticsMetric(metricKey);
                const data = compareRows.length
                  ? mergeCompareSeries(compareRows, metricKey)
                  : (historyTeam?.historicalPlayedEvents ?? [])
                      .map((eventRow, index) => ({
                        label: eventRow?.event_name ?? eventRow?.event ?? `Event ${index + 1}`,
                        value: seasonEventMetricValue(eventRow, metricKey),
                      }))
                      .filter((row) => row.value != null);
                if (!data.length) return null;
                return (
                  <AnalyticsChartBlock
                    key={`historical_event_metric_${metricKey}`}
                    title={`Historical Event Deck: ${metric?.label ?? metricKey}`}
                    description="Every historical event metric available from the current historical payload."
                    data={data}
                    chartFamily={metric?.defaultChartFamily ?? 'line'}
                    series={
                      compareRows.length
                        ? compareRows.map((team, index) => ({
                            key: `team_${team.teamNumber}`,
                            label: `${team.teamNumber}`,
                            color: paletteColor(index),
                            type: metric?.defaultChartFamily === 'step' ? 'step' : 'line',
                          }))
                        : [
                            {
                              key: 'value',
                              label: metric?.shortLabel ?? metricKey,
                              color: metric?.color ?? '#4bb3fd',
                            },
                          ]
                    }
                    valueFormatter={(value) => formatAnalyticsMetricValue(metricKey, value)}
                  />
                );
              })}
            </div>
          </LazySectionMount>
          <LazySectionMount>
            <div className="grid-2">
              {historicalMatchMetricKeys.map((metricKey) => {
                const metric = getAnalyticsMetric(metricKey);
                const data = compareRows.length
                  ? mergeCompareSeries(compareRows, metricKey)
                  : (historyTeam?.historicalMatches ?? [])
                      .slice(-36)
                      .map((match, index) => ({
                        label: match?.matchLabel ?? `Match ${index + 1}`,
                        value: seasonMatchMetricValue(match, metricKey),
                      }))
                      .filter((row) => row.value != null);
                if (!data.length) return null;
                return (
                  <AnalyticsChartBlock
                    key={`historical_match_metric_${metricKey}`}
                    title={`Historical Match Deck: ${metric?.label ?? metricKey}`}
                    description="Every historical match metric available from the current historical payload."
                    data={data}
                    chartFamily={metric?.defaultChartFamily ?? 'line'}
                    series={
                      compareRows.length
                        ? compareRows.map((team, index) => ({
                            key: `team_${team.teamNumber}`,
                            label: `${team.teamNumber}`,
                            color: paletteColor(index),
                            type: metric?.defaultChartFamily === 'step' ? 'step' : 'line',
                          }))
                        : [
                            {
                              key: 'value',
                              label: metric?.shortLabel ?? metricKey,
                              color: metric?.color ?? '#4bb3fd',
                            },
                          ]
                    }
                    valueFormatter={(value) => formatAnalyticsMetricValue(metricKey, value)}
                  />
                );
              })}
            </div>
          </LazySectionMount>
        </>
      )}

      <DisclosureSection
        storageKey={`ui.data_super.${scope}.scenario_ops`}
        title="Scenario Ops + Diagnostics"
        description="Projection cross-checks, runtime diagnostics, scenario tables, and alliance/playoff operations."
      >
        <LazySectionMount>
          <div className="grid-2">
            <AnalyticsChartBlock
              title="Predictions / Simulations"
              description="Scenario view remains available from DATA for cross-checking."
              data={(scope === 'current' ? projectedRows : (monteCarloProjection?.rows ?? []))
                .slice(0, 24)
                .map((row) => ({
                  label: `${row.teamNumber}`,
                  value: scope === 'current' ? row.projectedTotalRp : row.mcAvgRank,
                }))}
              chartFamily="bar"
              series={[
                {
                  key: 'value',
                  label: scope === 'current' ? 'Projected Total RP' : 'MC Avg Rank',
                  color: scope === 'current' ? '#4bb3fd' : '#ff9f68',
                },
              ]}
              valueFormatter={(value) =>
                scope === 'current'
                  ? formatAnalyticsMetricValue('scenario_projected_total_rp', value)
                  : formatAnalyticsMetricValue('scenario_mc_avg_rank', value)
              }
            />
            <AnalyticsTableBlock
              title="Diagnostics / Provenance"
              description="Route freshness and runtime counts."
            >
              <div className="stack-8">
                <div>
                  DATA route generated:{' '}
                  {superData ? new Date(superData.generatedAtMs).toLocaleString() : '-'}
                </div>
                <div>
                  Snapshot generated:{' '}
                  {snapshot?.generatedAtMs
                    ? new Date(snapshot.generatedAtMs).toLocaleString()
                    : '-'}
                </div>
                <div>TBA matches: {superData?.diagnostics?.tbaMatchCount ?? 0}</div>
                <div>SB matches: {superData?.diagnostics?.sbMatchCount ?? 0}</div>
                <div>SB team events: {superData?.diagnostics?.sbTeamEventCount ?? 0}</div>
                <div>Alliance runtime slots: {allianceRuntime?.captainSlots?.length ?? 0}</div>
                <div>
                  Live alliance runtime slots: {liveAllianceRuntime?.captainSlots?.length ?? 0}
                </div>
                <div>Saved playoff scenarios: {savedPlayoffResults?.length ?? 0}</div>
              </div>
            </AnalyticsTableBlock>
          </div>
        </LazySectionMount>
        <LazySectionMount>
          <div className="grid-2">
            <AnalyticsTableBlock
              title="Scenario Tables"
              description="Manual, deterministic, and Monte Carlo rows in one place."
            >
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
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Team</th>
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Manual RP</th>
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Det RP</th>
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>MC Avg Rank</th>
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Top4</th>
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Top8</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectedRows.slice(0, 24).map((row) => {
                      const det = deterministicRows.find((item) => item.teamKey === row.teamKey);
                      const mc = (monteCarloProjection?.rows ?? []).find(
                        (item) => item.teamKey === row.teamKey,
                      );
                      return (
                        <tr key={`scenario_${row.teamKey}`}>
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
                            {formatAnalyticsMetricValue(
                              'scenario_projected_total_rp',
                              row.projectedTotalRp,
                            )}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {formatAnalyticsMetricValue(
                              'scenario_deterministic_total_rp',
                              det?.deterministicTotalRp,
                            )}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {formatAnalyticsMetricValue('scenario_mc_avg_rank', mc?.mcAvgRank)}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {formatAnalyticsMetricValue('scenario_mc_top4', mc?.mcTop4)}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              borderBottom: '1px solid #1a2333',
                            }}
                          >
                            {formatAnalyticsMetricValue('scenario_mc_top8', mc?.mcTop8)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </AnalyticsTableBlock>
            <AnalyticsTableBlock
              title="Alliance / Playoff Ops Tables"
              description="Runtime alliance state and saved playoff result counts."
            >
              <div className="stack-8">
                <div>Alliance slots: {allianceRuntime?.captainSlots?.length ?? 0}</div>
                <div>Live alliance slots: {liveAllianceRuntime?.captainSlots?.length ?? 0}</div>
                <div>Saved playoff results: {savedPlayoffResults?.length ?? 0}</div>
                <div>Current compare teams: {compareRows.length}</div>
                <div>Current event teams: {eventRows.length}</div>
                <div>
                  Historical events loaded: {historyTeam?.historicalPlayedEvents?.length ?? 0}
                </div>
              </div>
            </AnalyticsTableBlock>
          </div>
        </LazySectionMount>
        <LazySectionMount>
          <div className="grid-2">
            {scenarioMetricKeys.map((metricKey) => {
              const metric = getAnalyticsMetric(metricKey);
              const isProjectedMetric =
                metricKey === 'scenario_projected_rank' ||
                metricKey === 'scenario_projected_total_rp' ||
                metricKey === 'scenario_deterministic_total_rp';
              const sourceRows = isProjectedMetric
                ? projectedRows.slice(0, 32).map((row) => {
                    const det = deterministicRows.find((item) => item.teamKey === row.teamKey);
                    return {
                      label: `${row.teamNumber}`,
                      value:
                        metricKey === 'scenario_deterministic_total_rp'
                          ? scenarioMetricValue(det, metricKey)
                          : scenarioMetricValue(row, metricKey),
                    };
                  })
                : (monteCarloProjection?.rows ?? []).slice(0, 32).map((row) => ({
                    label: `${row.teamNumber}`,
                    value: scenarioMetricValue(row, metricKey),
                  }));
              const data = sourceRows.filter((row) => row.value != null);
              if (!data.length) return null;
              return (
                <AnalyticsChartBlock
                  key={`scenario_metric_${metricKey}`}
                  title={`Scenario Deck: ${metric?.label ?? metricKey}`}
                  description="Every scenario metric currently derivable from the prediction stack."
                  data={data}
                  chartFamily={metric?.defaultChartFamily ?? 'bar'}
                  series={[
                    {
                      key: 'value',
                      label: metric?.shortLabel ?? metricKey,
                      color: metric?.color ?? '#4bb3fd',
                    },
                  ]}
                  valueFormatter={(value) => formatAnalyticsMetricValue(metricKey, value)}
                />
              );
            })}
          </div>
        </LazySectionMount>
      </DisclosureSection>
      <DisclosureSection
        storageKey={`ui.data_super.${scope}.metric_lab`}
        title="Metric Coverage + Chart Lab"
        description="Catalog the DATA metric surface and build ad hoc charts without leaving the workspace."
      >
        <LazySectionMount>
          <AnalyticsTableBlock
            title="Metric Coverage Catalog"
            description="Audit view of every metric currently exposed inside this DATA scope."
          >
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
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Metric</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Label</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Charts</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Scope</th>
                  </tr>
                </thead>
                <tbody>
                  {(scope === 'current'
                    ? [
                        ...currentEventMetricKeys,
                        ...currentCompareMetricKeys,
                        ...scenarioMetricKeys,
                      ]
                    : [
                        ...historicalSummaryMetricKeys,
                        ...historicalEventMetricKeys,
                        ...historicalMatchMetricKeys,
                        ...scenarioMetricKeys,
                      ]
                  ).map((metricKey) => {
                    const metric = getAnalyticsMetric(metricKey);
                    return (
                      <tr key={`catalog_${metricKey}`}>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #1a2333',
                          }}
                          className="mono"
                        >
                          {metricKey}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #1a2333',
                          }}
                        >
                          {metric?.label ?? metricKey}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #1a2333',
                          }}
                        >
                          {metric?.chartFamilies?.join(', ') ?? '-'}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: '1px solid #1a2333',
                          }}
                        >
                          {metric?.scope?.join(', ') ?? '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </AnalyticsTableBlock>
        </LazySectionMount>

        <LazySectionMount>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Chart Lab / Metric Builder</div>
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
                  Source
                </span>
                <select
                  className="input"
                  value={chartSource}
                  onChange={(event) => setChartSource(event.target.value)}
                >
                  {scope === 'current' ? (
                    <>
                      <option value="event_wide">Current Event Core</option>
                      <option value="compare_current">Current Compare</option>
                      <option value="scenario_projected">Projection Rows</option>
                      <option value="scenario_mc">Monte Carlo Rows</option>
                    </>
                  ) : (
                    <>
                      <option value="compare_historical">Historical Compare</option>
                      <option value="scenario_mc">Monte Carlo Rows</option>
                    </>
                  )}
                </select>
              </label>
              <MetricPicker
                value={chartMetric}
                onChange={setChartMetric}
                scopeFilters={metricScopeFilters}
                tabFilters={['DATA']}
                label="Metric"
              />
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  Chart
                </span>
                <select
                  className="input"
                  value={chartFamily}
                  onChange={(event) => setChartFamily(event.target.value)}
                >
                  {listAnalyticsMetrics({ tabs: ['DATA'] })
                    .find((metric) => metric.key === chartMetric)
                    ?.chartFamilies?.map((family) => (
                      <option key={family} value={family}>
                        {family}
                      </option>
                    )) ?? <option value="bar">bar</option>}
                </select>
              </label>
            </div>
            <div style={{ marginTop: 12 }}>
              <AnalyticsChartBlock
                title={getAnalyticsMetric(chartMetric)?.label ?? chartMetric}
                description="Scope-specific chart builder over the DATA view."
                data={chartData}
                chartFamily={chartFamily}
                series={chartSeries}
                valueFormatter={(value) => formatAnalyticsMetricValue(chartMetric, value)}
              />
            </div>
          </div>
        </LazySectionMount>
      </DisclosureSection>
    </div>
  );
}
