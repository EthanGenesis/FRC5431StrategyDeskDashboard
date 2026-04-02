'use client';
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { fetchJsonOrThrow } from '../lib/httpCache';
import type { TeamCompareSnapshot } from '../lib/types';
import AnalyticsChartBlock from './AnalyticsChartBlock';
import AnalyticsTableBlock from './AnalyticsTableBlock';
import RawBreakdownMatrix from './RawBreakdownMatrix';
import SparklineCell from './SparklineCell';
import SafeRichText from './SafeRichText';
import {
  buildBreakdownMatrixFields,
  buildBreakdownMatrixRows,
  buildCompareSeriesPoints,
  derivedMetricValue,
  formatAnalyticsMetricValue,
  getAnalyticsMetric,
} from '../lib/analytics-registry';

type TeamContextAnalyticsScope = 'current' | 'historical' | 'both';

type TeamContextAnalyticsBlockProps = {
  title: string;
  subtitle?: string;
  teamNumbers: number[];
  loadedEventKey?: string;
  baselineTeamNumber?: number | null;
  currentMetricKeys?: string[];
  historicalMetricKeys?: string[];
  showBreakdownMatrix?: boolean;
  onOpenTeamProfile?: (teamNumber: number) => void;
  scope?: TeamContextAnalyticsScope;
};

function uniqNumbers(values: number[] | null | undefined): number[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => Math.floor(Number(value)))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  );
}

function metricChartMode(metricKey: string): 'event_matches' | 'season_matches' | 'season_events' {
  if (metricKey.startsWith('event_match_')) return 'event_matches';
  if (metricKey.startsWith('season_match_')) return 'season_matches';
  return 'season_events';
}

function buildMergedSeries(
  compareTeams: TeamCompareSnapshot['teams'],
  metricKey: string,
): Record<string, string | number | null>[] {
  const chartMode = metricChartMode(metricKey);
  const perTeam = compareTeams.map((team) => {
    const metric = getAnalyticsMetric(metricKey);
    const smoothing = metric?.defaultSmoothingWindow ?? 1;
    return {
      team,
      points: buildCompareSeriesPoints(team, chartMode, metricKey, smoothing),
    };
  });
  const maxLength = Math.max(0, ...perTeam.map((entry) => entry.points.length));
  return Array.from({ length: maxLength }, (_, index) => {
    const row: Record<string, string | number | null> = {
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
export default function TeamContextAnalyticsBlock({
  title,
  subtitle,
  teamNumbers,
  loadedEventKey,
  baselineTeamNumber = null,
  currentMetricKeys = [],
  historicalMetricKeys = [],
  showBreakdownMatrix = false,
  onOpenTeamProfile,
  scope = 'both',
}: TeamContextAnalyticsBlockProps): ReactElement {
  const [snapshot, setSnapshot] = useState<TeamCompareSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const normalizedTeams = useMemo(() => uniqNumbers(teamNumbers), [teamNumbers]);
  const requestTeams = useMemo(() => [...normalizedTeams], [normalizedTeams]);
  const showCurrent = scope === 'current' || scope === 'both';
  const showHistorical = scope === 'historical' || scope === 'both';
  useEffect(() => {
    if (!requestTeams.length) {
      setSnapshot(null);
      setIsLoading(false);
      setErrorText('');
      return;
    }
    let cancelled = false;
    async function loadSnapshot() {
      setIsLoading(true);
      setErrorText('');
      try {
        const json = await fetchJsonOrThrow<TeamCompareSnapshot>(
          '/api/team-compare',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              teams: requestTeams,
              eventKey: loadedEventKey ?? '',
            }),
            cache: 'default',
          },
          'Context analytics load failed',
        );
        if (!cancelled) setSnapshot(json);
      } catch (error) {
        if (!cancelled) {
          setSnapshot(null);
          setErrorText(error instanceof Error ? error.message : 'Unknown context analytics error');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [loadedEventKey, requestTeams]);
  const compareTeams = useMemo(() => snapshot?.teams ?? [], [snapshot]);
  const currentFields = useMemo(
    () => buildBreakdownMatrixFields(compareTeams, 'event'),
    [compareTeams],
  );
  const currentMatrixRows = useMemo(
    () => buildBreakdownMatrixRows(compareTeams, 'event'),
    [compareTeams],
  );
  const historicalFields = useMemo(
    () => buildBreakdownMatrixFields(compareTeams, 'season'),
    [compareTeams],
  );
  const historicalMatrixRows = useMemo(
    () => buildBreakdownMatrixRows(compareTeams, 'season'),
    [compareTeams],
  );
  const currentSummaryMetrics = [
    'event_rank',
    'event_total_rp',
    'event_rp_average',
    'event_epa',
    'event_auto',
    'event_teleop',
    'event_endgame',
    'event_opr',
    'event_copr',
    'event_dpr',
    'event_ccwm',
    'event_composite',
    'event_played_sos',
    'event_remaining_sos',
    'event_sos',
    'event_match_count',
    'event_delta_field_epa',
    'event_delta_field_opr',
    'event_delta_field_composite',
  ];
  const historicalSummaryMetrics = [
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
  ];
  function renderSummaryTable(summaryScope: 'current' | 'historical'): ReactElement {
    const metricKeys =
      summaryScope === 'current' ? currentSummaryMetrics : historicalSummaryMetrics;
    return (
      <AnalyticsTableBlock
        title={`${title} ${summaryScope === 'current' ? 'Current Event' : 'Historical 2026'}`}
        description={
          subtitle ??
          (summaryScope === 'current'
            ? 'Current-event-only context for the selected teams.'
            : 'Historical 2026 context excluding the loaded event.')
        }
      >
        {isLoading ? (
          <div className="muted">Loading contextual analytics...</div>
        ) : errorText ? (
          <div className="muted">{errorText}</div>
        ) : !compareTeams.length ? (
          <div className="muted">No team context loaded.</div>
        ) : (
          <div style={{ overflow: 'auto' }}>
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
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Team</th>
                  {metricKeys.map((metricKey) => (
                    <th key={metricKey} style={{ padding: 8, borderBottom: '1px solid #223048' }}>
                      {getAnalyticsMetric(metricKey)?.shortLabel ?? metricKey}
                    </th>
                  ))}
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>
                    {summaryScope === 'current' ? 'rOPR Trend' : 'Hist EPA Trend'}
                  </th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>
                    {summaryScope === 'current' ? 'Status' : 'Season Context'}
                  </th>
                  <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {compareTeams.map((team) => (
                  <tr
                    key={`${summaryScope}_${team.teamKey}`}
                    style={{
                      background:
                        baselineTeamNumber != null && Number(team.teamNumber) === baselineTeamNumber
                          ? '#132033'
                          : undefined,
                    }}
                  >
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                      <div className="mono">{team.teamNumber}</div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {team.nickname}
                      </div>
                    </td>
                    {metricKeys.map((metricKey) => (
                      <td
                        key={metricKey}
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {formatAnalyticsMetricValue(metricKey, derivedMetricValue(team, metricKey))}
                      </td>
                    ))}
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                      <SparklineCell
                        values={
                          summaryScope === 'current'
                            ? (team?.eventMatches ?? []).map((match) =>
                                typeof match?.rollingOpr === 'number' ? match.rollingOpr : null,
                              )
                            : (team?.historicalMatches ?? []).map((match) =>
                                typeof match?.epaTotal === 'number' ? match.epaTotal : null,
                              )
                        }
                      />
                    </td>
                    <td
                      style={{
                        padding: 8,
                        borderBottom: '1px solid #1a2333',
                        minWidth: 220,
                        verticalAlign: 'top',
                      }}
                    >
                      {summaryScope === 'current' ? (
                        <SafeRichText
                          html={
                            typeof team?.derived?.eventStatusHtml === 'string'
                              ? team.derived.eventStatusHtml
                              : '-'
                          }
                        />
                      ) : (
                        <div className="muted" style={{ fontSize: 12 }}>
                          Played {team?.historicalPlayedEvents?.length ?? 0} | Upcoming{' '}
                          {team?.historicalUpcomingEvents?.length ?? 0} | Matches{' '}
                          {team?.historicalMatches?.length ?? 0}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                      <button
                        className="button"
                        onClick={() => onOpenTeamProfile?.(team.teamNumber)}
                      >
                        TEAM_PROFILE
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AnalyticsTableBlock>
    );
  }
  function renderChartDeck(metricKeys: string[], description: string): ReactElement | null {
    if (!metricKeys.length) return null;
    return (
      <div className="grid-2">
        {metricKeys.map((metricKey) => {
          const data = buildMergedSeries(compareTeams, metricKey);
          const metric = getAnalyticsMetric(metricKey);
          return (
            <AnalyticsChartBlock
              key={metricKey}
              title={metric?.label ?? metricKey}
              description={description}
              data={data}
              chartFamily={metric?.defaultChartFamily ?? 'line'}
              series={compareTeams.map((team, index) => ({
                key: `team_${team.teamNumber}`,
                label: `${team.teamNumber}`,
                color:
                  metric?.color ??
                  ['#f3be3b', '#4bb3fd', '#ff6b6b', '#8ad17d', '#c084fc', '#2dd4bf'][index % 6] ??
                  '#f3be3b',
                type: metric?.defaultChartFamily === 'step' ? 'step' : 'line',
              }))}
              valueFormatter={(value) => formatAnalyticsMetricValue(metricKey, value)}
            />
          );
        })}
      </div>
    );
  }
  return (
    <div className="stack-12">
      {showCurrent ? renderSummaryTable('current') : null}
      {showCurrent ? renderChartDeck(currentMetricKeys, 'Loaded-event-only chronology') : null}
      {showCurrent && showBreakdownMatrix && currentFields.length ? (
        <RawBreakdownMatrix
          title={`${title} Current Event Breakdown Matrix`}
          description="Latest loaded-event breakdown values for the selected teams."
          fields={currentFields}
          rows={currentMatrixRows}
          baselineTeamNumber={baselineTeamNumber}
        />
      ) : null}

      {showHistorical ? renderSummaryTable('historical') : null}
      {showHistorical
        ? renderChartDeck(historicalMetricKeys, 'Historical 2026 excluding loaded event')
        : null}
      {showHistorical && showBreakdownMatrix && historicalFields.length ? (
        <RawBreakdownMatrix
          title={`${title} Historical Breakdown Matrix`}
          description="Historical season breakdown context for the selected teams."
          fields={historicalFields}
          rows={historicalMatrixRows}
          baselineTeamNumber={baselineTeamNumber}
        />
      ) : null}
    </div>
  );
}
