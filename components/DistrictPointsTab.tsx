'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import AnalyticsChartBlock from './AnalyticsChartBlock';
import AnalyticsTableBlock from './AnalyticsTableBlock';
import DisclosureSection from './ui/DisclosureSection';
import {
  DISTRICT_AWARD_OPTIONS,
  calculateDistrictPointsBreakdown,
  districtQualificationPoints,
  rookieBonusPoints,
} from '../lib/district-points';
import { fetchJsonOrThrow } from '../lib/httpCache';
import type {
  DistrictCalculatorInput,
  DistrictEventProjection,
  DistrictSeasonProjection,
  DistrictSnapshotResponse,
} from '../lib/types';
import { useDashboardPreferences } from './providers/DashboardPreferencesProvider';

type DistrictPointsTabProps = {
  scope: 'current' | 'historical';
  loadedEventKey?: string;
  loadedTeam?: number | null;
  externalUpdateKey?: number;
};

const DEFAULT_CALCULATOR: DistrictCalculatorInput = {
  qualificationRank: 14,
  teamCount: 40,
  allianceRole: 'first_pick',
  allianceNumber: 5,
  playoffFinish: 'winner',
  finalsWins: 2,
  awardKeys: ['quality'],
  rookieBonusPoints: 0,
  dcmpMultiplier: false,
};

function fmt(value: unknown, digits = 1): string {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(digits);
}

function pct(value: unknown): string {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function titleStatus(value: string): string {
  if (!value) return '-';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function SimpleTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number)[][];
}): ReactElement {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          {headers.map((header) => (
            <th
              key={header}
              style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid #1a2333' }}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row[0]}_${index}`}>
            {row.map((cell, cellIndex) => (
              <td
                key={`${headers[cellIndex]}_${cellIndex}`}
                style={{ padding: 6, borderBottom: '1px solid #1a2333' }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function DistrictPointsTab({
  scope,
  loadedEventKey,
  loadedTeam = null,
  externalUpdateKey = 0,
}: DistrictPointsTabProps): ReactElement {
  const { t, toneClass, toneFromStatus } = useDashboardPreferences();
  const [snapshot, setSnapshot] = useState<DistrictSnapshotResponse | null>(null);
  const [eventProjection, setEventProjection] = useState<DistrictEventProjection | null>(null);
  const [seasonProjection, setSeasonProjection] = useState<DistrictSeasonProjection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [runs, setRuns] = useState(800);
  const [selectedTeamNumber, setSelectedTeamNumber] = useState<number | null>(loadedTeam);
  const [calculator, setCalculator] = useState<DistrictCalculatorInput>(DEFAULT_CALCULATOR);

  const mode = scope === 'current' ? 'event' : 'season';

  const loadSnapshot = useCallback(async () => {
    if (!loadedEventKey) {
      setSnapshot(null);
      setErrorText('Load an event to view district points.');
      return;
    }
    setIsLoading(true);
    setErrorText('');
    try {
      const query = new URLSearchParams({ eventKey: loadedEventKey });
      if (loadedTeam != null) query.set('team', String(loadedTeam));
      const json = await fetchJsonOrThrow<DistrictSnapshotResponse>(
        `/api/district-points?${query.toString()}`,
        { cache: 'no-store' },
        'District snapshot failed',
      );
      setSnapshot(json);
      setEventProjection(null);
      setSeasonProjection(null);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unknown district snapshot error');
      setSnapshot(null);
    } finally {
      setIsLoading(false);
    }
  }, [loadedEventKey, loadedTeam]);

  const runSimulation = useCallback(async () => {
    if (!snapshot?.applicable || !loadedEventKey) return;
    setIsSimulating(true);
    setErrorText('');
    try {
      const json = await fetchJsonOrThrow<DistrictEventProjection | DistrictSeasonProjection>(
        '/api/district-points/simulate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventKey: loadedEventKey, team: loadedTeam ?? null, runs, mode }),
          cache: 'no-store',
        },
        'District simulation failed',
      );
      if (json.mode === 'event') {
        setEventProjection(json);
        setSeasonProjection(null);
      } else {
        setSeasonProjection(json);
        setEventProjection(null);
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unknown district simulation error');
    } finally {
      setIsSimulating(false);
    }
  }, [loadedEventKey, loadedTeam, mode, runs, snapshot?.applicable]);

  useEffect(() => {
    void loadSnapshot();
    const id = window.setInterval(() => {
      void loadSnapshot();
    }, 10000);
    return () => window.clearInterval(id);
  }, [externalUpdateKey, loadSnapshot]);

  useEffect(() => {
    if (!snapshot?.applicable) return;
    if (scope === 'current' && !snapshot.currentEvent) return;
    void runSimulation();
  }, [externalUpdateKey, runSimulation, scope, snapshot?.applicable, snapshot?.currentEvent]);

  useEffect(() => {
    if (!snapshot) return;
    setCalculator((prev) => ({
      ...prev,
      teamCount: snapshot.currentEvent?.teamCount ?? prev.teamCount,
      rookieBonusPoints: rookieBonusPoints(snapshot.loadedTeamStanding?.rookieYear ?? null),
      dcmpMultiplier: Boolean(snapshot.currentEvent?.districtCmp),
    }));
    if (loadedTeam != null) setSelectedTeamNumber(loadedTeam);
    else if (scope === 'current')
      setSelectedTeamNumber(snapshot.currentEvent?.eventRows[0]?.teamNumber ?? null);
    else setSelectedTeamNumber(snapshot.standings[0]?.teamNumber ?? null);
  }, [loadedTeam, scope, snapshot]);

  const calculatorBreakdown = useMemo(
    () => calculateDistrictPointsBreakdown(calculator),
    [calculator],
  );
  const calculatorSeasonTotal = useMemo(() => {
    if (!snapshot?.loadedTeamSeason) return null;
    return (
      snapshot.loadedTeamSeason.totalExcludingLoadedEvent + calculatorBreakdown.seasonContribution
    );
  }, [calculatorBreakdown.seasonContribution, snapshot?.loadedTeamSeason]);

  const currentGapToDcmp =
    calculatorSeasonTotal != null && snapshot?.season.currentDcmpLinePoints != null
      ? calculatorSeasonTotal - snapshot.season.currentDcmpLinePoints
      : null;
  const currentGapToWorlds =
    calculatorSeasonTotal != null && snapshot?.season.currentWorldsLinePoints != null
      ? calculatorSeasonTotal - snapshot.season.currentWorldsLinePoints
      : null;

  const eventRows = useMemo(
    () => snapshot?.currentEvent?.eventRows ?? [],
    [snapshot?.currentEvent?.eventRows],
  );
  const currentEventRowMap = useMemo(
    () => new Map(eventRows.map((row) => [row.teamNumber, row])),
    [eventRows],
  );
  const teamOptions = (scope === 'current' ? eventRows : (snapshot?.standings ?? [])).map(
    (row) => ({
      label: `${row.teamNumber} ${row.nickname}`,
      value: row.teamNumber,
    }),
  );

  const selectedEventProjectionRow =
    eventProjection?.rows.find((row) => row.teamNumber === selectedTeamNumber) ?? null;
  const selectedSeasonProjectionRow =
    seasonProjection?.rows.find((row) => row.teamNumber === selectedTeamNumber) ?? null;
  const loadedTeamSeasonRow =
    loadedTeam != null
      ? (seasonProjection?.rows.find((row) => row.teamNumber === loadedTeam) ?? null)
      : null;
  const selectedCurrentEventRow =
    selectedTeamNumber != null ? (currentEventRowMap.get(selectedTeamNumber) ?? null) : null;
  const currentProjectionRows = useMemo(
    () =>
      [...(eventProjection?.rows ?? [])].sort((left, right) => {
        const leftRank = currentEventRowMap.get(left.teamNumber)?.rank ?? Number.POSITIVE_INFINITY;
        const rightRank =
          currentEventRowMap.get(right.teamNumber)?.rank ?? Number.POSITIVE_INFINITY;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return right.totalP50 - left.totalP50;
      }),
    [currentEventRowMap, eventProjection?.rows],
  );
  const seasonProjectionRows = useMemo(
    () =>
      [...(seasonProjection?.rows ?? [])].sort((left, right) => {
        if (left.officialRank !== right.officialRank) return left.officialRank - right.officialRank;
        return right.currentTotal - left.currentTotal;
      }),
    [seasonProjection?.rows],
  );

  const rankCurveData = Array.from(
    { length: Math.max(0, snapshot?.currentEvent?.teamCount ?? calculator.teamCount) },
    (_, index) => ({
      label: `R${index + 1}`,
      qualPoints: districtQualificationPoints(
        index + 1,
        snapshot?.currentEvent?.teamCount ?? calculator.teamCount,
      ),
    }),
  );

  const eventRangeData = currentProjectionRows.slice(0, 24).map((row) => ({
    label: String(row.teamNumber),
    p5: row.totalP5,
    p50: row.totalP50,
    p95: row.totalP95,
  }));
  const breakdownData = selectedEventProjectionRow
    ? [
        {
          label: String(selectedEventProjectionRow.teamNumber),
          qual: selectedEventProjectionRow.qualP50,
          alliance: selectedEventProjectionRow.allianceP50,
          elim: selectedEventProjectionRow.elimP50,
          award: selectedEventProjectionRow.officialAwardPoints,
        },
      ]
    : [];
  const eventScatterData = (eventProjection?.rows ?? []).map((row) => ({
    epa: eventRows.find((eventRow) => eventRow.teamNumber === row.teamNumber)?.overallEpa ?? 0,
    medianPoints: row.totalP50,
  }));

  const seasonRangeData = seasonProjectionRows.slice(0, 32).map((row) => ({
    label: String(row.teamNumber),
    p5: row.p5Total,
    p50: row.p50Total,
    p95: row.p95Total,
  }));
  const probabilityScatter = (seasonProjection?.rows ?? []).map((row) => ({
    total: row.currentTotal,
    dcmp: Number((row.dcmpProbability * 100).toFixed(1)),
    worlds: Number((row.worldsProbability * 100).toFixed(1)),
  }));
  const cutoffSummaryData = seasonProjection
    ? [
        {
          label: 'DCMP / States',
          current: snapshot?.season.currentDcmpLinePoints ?? 0,
          median: seasonProjection.dcmpCutoff.p50 ?? 0,
          high: seasonProjection.dcmpCutoff.p95 ?? 0,
        },
        {
          label: 'Worlds',
          current: snapshot?.season.currentWorldsLinePoints ?? 0,
          median: seasonProjection.worldsCutoff.p50 ?? 0,
          high: seasonProjection.worldsCutoff.p95 ?? 0,
        },
      ]
    : [];
  const schedulePointsData = (snapshot?.season.events ?? []).map((event) => ({
    label: event.shortName || event.name,
    performance: event.remainingPerformanceCeiling,
    awards: event.remainingTopTierAwardPoints,
  }));

  const bubbleRows = [...(seasonProjection?.rows ?? [])].sort((a, b) => b.p50Total - a.p50Total);
  const bubbleSlice = (slot: number) =>
    bubbleRows.slice(Math.max(0, slot - 4), Math.max(0, slot - 4) + 8);

  function renderStatusBadge(status: string | null | undefined): ReactElement {
    return <span className={`badge ${toneClass(toneFromStatus(status))}`}>{status ?? '-'}</span>;
  }

  if (!loadedEventKey) {
    return (
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ fontWeight: 900 }}>{t('district.title', 'District Points')}</div>
        <div className="muted" style={{ marginTop: 8 }}>
          {t(
            'district.load_fit_event',
            'Load a FIT district event to use the district points suite.',
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="stack-12" style={{ marginTop: 12 }}>
      <div className="panel" style={{ padding: 16 }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
        >
          <div>
            <div style={{ fontWeight: 900 }}>
              {scope === 'current'
                ? t('district.current_title', 'Current District Event')
                : t('district.historical_title', 'Historical District Season')}
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              {t(
                'district.summary',
                'FIT district points built from official TBA data plus EPA-based simulation.',
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="badge badge-blue">
              {t('field.event', 'Event')}: {loadedEventKey}
            </span>
            <span className="badge">
              {t('field.team', 'Team')}: {loadedTeam ?? '-'}
            </span>
            <label className="badge" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {t('district.runs', 'Runs')}
              <input
                className="input"
                style={{ width: 90 }}
                type="number"
                min={50}
                max={5000}
                value={runs}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setRuns(Math.max(50, Math.min(5000, Number(event.target.value) || 800)))
                }
              />
            </label>
            <button className="button" onClick={() => void runSimulation()} disabled={isSimulating}>
              {isSimulating
                ? t('status.simulating', 'Simulating...')
                : t('status.recompute', 'Recompute')}
            </button>
          </div>
        </div>
      </div>
      {isLoading ? (
        <div className="panel" style={{ padding: 16 }}>
          {t('district.loading_snapshot', 'Loading district snapshot...')}
        </div>
      ) : null}
      {errorText ? (
        <div className="panel" style={{ padding: 16, borderColor: '#7f1d1d' }}>
          {errorText}
        </div>
      ) : null}
      {snapshot && !snapshot.applicable ? (
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900 }}>FIT District Only</div>
          <div className="muted" style={{ marginTop: 8 }}>
            {snapshot.reason}
          </div>
        </div>
      ) : null}

      {snapshot?.applicable && scope === 'current' && snapshot.currentEvent ? (
        <>
          <div className="grid-2">
            <AnalyticsTableBlock
              title="Event Status"
              description="Official event context and currently claimed district points."
            >
              <div className="grid-2">
                <div className="panel-2" style={{ padding: 12 }}>
                  <div>Teams at event: {snapshot.currentEvent.teamCount}</div>
                  <div style={{ marginTop: 6 }}>
                    District CMP: {snapshot.currentEvent.districtCmp ? 'Yes' : 'No'}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    Current DCMP / States line: {snapshot.season.currentDcmpLinePoints ?? '-'}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    Current Worlds line: {snapshot.season.currentWorldsLinePoints ?? '-'}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    Awarded official points: {snapshot.currentEvent.awardedOfficialPoints}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    Awarded performance points: {snapshot.currentEvent.awardedPerformancePoints}
                  </div>
                </div>
                <div className="panel-2" style={{ padding: 12 }}>
                  <div>
                    Remaining performance ceiling:{' '}
                    {snapshot.currentEvent.remainingPerformanceCeiling}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    Remaining top-tier award envelope:{' '}
                    {snapshot.currentEvent.remainingTopTierAwardPoints}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    Impact/EI/RAS left: {snapshot.currentEvent.remainingTopTierAwards.impact}/
                    {snapshot.currentEvent.remainingTopTierAwards.engineeringInspiration}/
                    {snapshot.currentEvent.remainingTopTierAwards.rookieAllStar}
                  </div>
                </div>
              </div>
            </AnalyticsTableBlock>
            <AnalyticsTableBlock
              title="Manual Calculator"
              description="What-if district points for this FIT event."
            >
              <div className="grid-2">
                <label>
                  <div className="muted" style={{ marginBottom: 4 }}>
                    Qualification rank
                  </div>
                  <input
                    className="input"
                    type="number"
                    value={calculator.qualificationRank}
                    onChange={(event) =>
                      setCalculator((prev) => ({
                        ...prev,
                        qualificationRank: Number(event.target.value) || 1,
                      }))
                    }
                  />
                </label>
                <label>
                  <div className="muted" style={{ marginBottom: 4 }}>
                    Team count
                  </div>
                  <input
                    className="input"
                    type="number"
                    value={calculator.teamCount}
                    onChange={(event) =>
                      setCalculator((prev) => ({
                        ...prev,
                        teamCount: Number(event.target.value) || 1,
                      }))
                    }
                  />
                </label>
                <label>
                  <div className="muted" style={{ marginBottom: 4 }}>
                    Alliance role
                  </div>
                  <select
                    className="input"
                    value={calculator.allianceRole}
                    onChange={(event) =>
                      setCalculator((prev) => ({
                        ...prev,
                        allianceRole: event.target.value as DistrictCalculatorInput['allianceRole'],
                      }))
                    }
                  >
                    <option value="unpicked">Unpicked</option>
                    <option value="captain">Captain</option>
                    <option value="first_pick">First pick</option>
                    <option value="second_pick">Second pick</option>
                    <option value="backup">Backup</option>
                  </select>
                </label>
                <label>
                  <div className="muted" style={{ marginBottom: 4 }}>
                    Alliance number
                  </div>
                  <input
                    className="input"
                    type="number"
                    value={calculator.allianceNumber ?? ''}
                    onChange={(event) =>
                      setCalculator((prev) => ({
                        ...prev,
                        allianceNumber: event.target.value ? Number(event.target.value) : null,
                      }))
                    }
                  />
                </label>
                <label>
                  <div className="muted" style={{ marginBottom: 4 }}>
                    Playoff finish
                  </div>
                  <select
                    className="input"
                    value={calculator.playoffFinish}
                    onChange={(event) =>
                      setCalculator((prev) => ({
                        ...prev,
                        playoffFinish: event.target
                          .value as DistrictCalculatorInput['playoffFinish'],
                      }))
                    }
                  >
                    <option value="none">None</option>
                    <option value="out_early">Out early</option>
                    <option value="fourth">4th</option>
                    <option value="third">3rd</option>
                    <option value="finalist">Finalist</option>
                    <option value="winner">Winner</option>
                  </select>
                </label>
                <label>
                  <div className="muted" style={{ marginBottom: 4 }}>
                    Finals wins
                  </div>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={2}
                    value={calculator.finalsWins}
                    onChange={(event) =>
                      setCalculator((prev) => ({
                        ...prev,
                        finalsWins: Math.max(0, Math.min(2, Number(event.target.value) || 0)),
                      }))
                    }
                  />
                </label>
                <label>
                  <div className="muted" style={{ marginBottom: 4 }}>
                    Rookie / second-year bonus
                  </div>
                  <select
                    className="input"
                    value={calculator.rookieBonusPoints}
                    onChange={(event) =>
                      setCalculator((prev) => ({
                        ...prev,
                        rookieBonusPoints: Number(event.target.value) || 0,
                      }))
                    }
                  >
                    <option value={0}>No bonus</option>
                    <option value={5}>Second-year (5)</option>
                    <option value={10}>Rookie (10)</option>
                  </select>
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 24 }}>
                  <input
                    type="checkbox"
                    checked={calculator.dcmpMultiplier}
                    onChange={(event) =>
                      setCalculator((prev) => ({
                        ...prev,
                        dcmpMultiplier: event.target.checked,
                      }))
                    }
                  />
                  DCMP x3 multiplier
                  <span className="muted" style={{ fontSize: 11 }}>
                    {snapshot.currentEvent.districtCmp
                      ? '(auto-recommended for this event)'
                      : '(manual what-if)'}
                  </span>
                </label>
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {DISTRICT_AWARD_OPTIONS.map((award) => (
                  <label
                    key={award.key}
                    className="badge"
                    style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                  >
                    <input
                      type="checkbox"
                      checked={calculator.awardKeys.includes(award.key)}
                      onChange={() =>
                        setCalculator((prev) => ({
                          ...prev,
                          awardKeys: prev.awardKeys.includes(award.key)
                            ? prev.awardKeys.filter((key) => key !== award.key)
                            : [...prev.awardKeys, award.key],
                        }))
                      }
                    />
                    {award.label} (+{award.points})
                  </label>
                ))}
              </div>
              <div className="panel-2" style={{ padding: 12, marginTop: 12 }}>
                <div>Qualification: {calculatorBreakdown.qualPoints}</div>
                <div>Alliance: {calculatorBreakdown.alliancePoints}</div>
                <div>Playoff: {calculatorBreakdown.elimPoints}</div>
                <div>Awards: {calculatorBreakdown.awardPoints}</div>
                <div>Age bonus: {calculatorBreakdown.ageBonusPoints}</div>
                <div style={{ fontWeight: 900, marginTop: 8 }}>
                  Event total: {calculatorBreakdown.eventPoints}
                </div>
                <div>Season contribution: {calculatorBreakdown.seasonContribution}</div>
                {calculatorSeasonTotal != null ? (
                  <div style={{ marginTop: 6 }}>
                    Projected season total: {calculatorSeasonTotal}
                  </div>
                ) : null}
                {currentGapToDcmp != null ? (
                  <div>Gap to DCMP / States line: {fmt(currentGapToDcmp, 0)}</div>
                ) : null}
                {currentGapToWorlds != null ? (
                  <div>Gap to Worlds line: {fmt(currentGapToWorlds, 0)}</div>
                ) : null}
              </div>
            </AnalyticsTableBlock>
          </div>
          <DisclosureSection
            storageKey="ui.district.current.projections"
            title="Event Projection + Charts"
            description="Selected-team outlook, official rows, event projection table, and supporting charts."
          >
            {selectedEventProjectionRow ? (
              <AnalyticsTableBlock
                title="Selected-Team Event Outlook"
                description="Current official context plus projected event district-point landing zone."
              >
                <div className="grid-2">
                  <div className="panel-2" style={{ padding: 12 }}>
                    <div style={{ fontWeight: 900 }}>
                      {selectedEventProjectionRow.teamNumber} {selectedEventProjectionRow.nickname}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      Current event rank: {selectedCurrentEventRow?.rank ?? '-'}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      Current EPA: {fmt(selectedCurrentEventRow?.overallEpa, 1)}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      Official event points: {selectedEventProjectionRow.officialEventPoints ?? '-'}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      Award points already known: {selectedEventProjectionRow.officialAwardPoints}
                    </div>
                  </div>
                  <div className="panel-2" style={{ padding: 12 }}>
                    <div>
                      Performance min / median / max: {selectedEventProjectionRow.performanceMin} /{' '}
                      {selectedEventProjectionRow.performanceMedian} /{' '}
                      {selectedEventProjectionRow.performanceMax}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      Total P5 / P50 / P95: {selectedEventProjectionRow.totalP5} /{' '}
                      {selectedEventProjectionRow.totalP50} / {selectedEventProjectionRow.totalP95}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      Max with remaining awards:{' '}
                      {selectedEventProjectionRow.maxWithRemainingTopTier}
                    </div>
                    {eventProjection?.loadedTeamSummary &&
                    selectedEventProjectionRow.teamNumber === loadedTeam ? (
                      <div style={{ marginTop: 6 }}>
                        Loaded team season path min / median / max:{' '}
                        {eventProjection.loadedTeamSummary.min} /{' '}
                        {eventProjection.loadedTeamSummary.median} /{' '}
                        {eventProjection.loadedTeamSummary.max}
                      </div>
                    ) : null}
                  </div>
                </div>
              </AnalyticsTableBlock>
            ) : null}
            <AnalyticsTableBlock
              title="Official Event District Points"
              description="Official TBA district-point breakdown when available."
            >
              <SimpleTable
                headers={['Rank', 'Team', 'Qual', 'Alliance', 'Elim', 'Awards', 'Total']}
                rows={snapshot.currentEvent.officialRows.map((row) => [
                  currentEventRowMap.get(row.teamNumber)?.rank ?? '-',
                  `${row.teamNumber} ${row.nickname}`,
                  row.officialPoints.qualPoints,
                  row.officialPoints.alliancePoints,
                  row.officialPoints.elimPoints,
                  row.officialPoints.awardPoints,
                  row.officialPoints.eventPoints,
                ])}
              />
            </AnalyticsTableBlock>
            <AnalyticsTableBlock
              title="Event Projection"
              description="EPA-based event district-point distribution for every team at the loaded FIT event."
            >
              <div
                style={{
                  marginBottom: 12,
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <span className="muted">Selected team:</span>
                <select
                  className="input"
                  value={selectedTeamNumber ?? ''}
                  onChange={(event) => setSelectedTeamNumber(Number(event.target.value) || null)}
                >
                  {teamOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <SimpleTable
                headers={[
                  'Rank',
                  'Team',
                  'EPA',
                  'Official',
                  'Perf Min',
                  'Perf Median',
                  'Perf Max',
                  'P5',
                  'P50',
                  'P95',
                  'Max + Awards',
                ]}
                rows={currentProjectionRows.map((row) => [
                  currentEventRowMap.get(row.teamNumber)?.rank ?? '-',
                  `${row.teamNumber} ${row.nickname}`,
                  fmt(currentEventRowMap.get(row.teamNumber)?.overallEpa, 1),
                  row.officialEventPoints ?? '-',
                  row.performanceMin,
                  row.performanceMedian,
                  row.performanceMax,
                  row.totalP5,
                  row.totalP50,
                  row.totalP95,
                  row.maxWithRemainingTopTier,
                ])}
              />
            </AnalyticsTableBlock>
            <div className="grid-2">
              <AnalyticsChartBlock
                title="Selected-Team Event Histogram"
                data={eventProjection?.loadedTeamHistogram ?? []}
                chartFamily="bar"
                series={[{ key: 'value', label: 'Runs', color: '#60a5fa' }]}
                valueFormatter={(value) => fmt(value, 0)}
              />
              <AnalyticsChartBlock
                title="All-Teams Event Point Ranges"
                description="P5 / P50 / P95 event district points."
                data={eventRangeData}
                chartFamily="bar"
                series={[
                  { key: 'p5', label: 'P5', color: '#f59e0b' },
                  { key: 'p50', label: 'P50', color: '#60a5fa' },
                  { key: 'p95', label: 'P95', color: '#34d399' },
                ]}
                valueFormatter={(value) => fmt(value, 0)}
              />
              <AnalyticsChartBlock
                title="Selected-Team Breakdown"
                description="Median event district-point breakdown for the selected team."
                data={breakdownData}
                chartFamily="bar"
                series={[
                  { key: 'qual', label: 'Qual', color: '#60a5fa' },
                  { key: 'alliance', label: 'Alliance', color: '#f59e0b' },
                  { key: 'elim', label: 'Playoff', color: '#34d399' },
                  { key: 'award', label: 'Awards', color: '#f472b6' },
                ]}
                valueFormatter={(value) => fmt(value, 0)}
              />
              <AnalyticsChartBlock
                title="Rank To Qual Points"
                data={rankCurveData}
                series={[{ key: 'qualPoints', label: 'Qual Points', color: '#60a5fa' }]}
                valueFormatter={(value) => fmt(value, 0)}
              />
              <AnalyticsChartBlock
                title="EPA vs Projected Event Points"
                description="Event EPA vs projected median district points."
                data={eventScatterData}
                chartFamily="scatter"
                xKey="epa"
                series={[{ key: 'medianPoints', label: 'Median DP', color: '#34d399' }]}
                valueFormatter={(value) => fmt(value, 1)}
              />
              <AnalyticsChartBlock
                title="Season Impact"
                description="Loaded-team season total against the current DCMP / States and Worlds lines."
                data={
                  eventProjection?.loadedTeamSummary
                    ? [
                        {
                          label: 'Current',
                          value: snapshot.loadedTeamSeason?.currentOfficialTotal ?? 0,
                        },
                        {
                          label: 'Median Path',
                          value: eventProjection.loadedTeamSummary.seasonIfMedianApplied ?? 0,
                        },
                        {
                          label: 'Best Path',
                          value: eventProjection.loadedTeamSummary.seasonIfBestApplied ?? 0,
                        },
                        {
                          label: 'DCMP / States Line',
                          value: snapshot.season.currentDcmpLinePoints ?? 0,
                        },
                        {
                          label: 'Worlds Line',
                          value: snapshot.season.currentWorldsLinePoints ?? 0,
                        },
                      ]
                    : []
                }
                chartFamily="bar"
                series={[{ key: 'value', label: 'Points', color: '#c084fc' }]}
                valueFormatter={(value) => fmt(value, 0)}
              />
            </div>
          </DisclosureSection>
        </>
      ) : null}

      {snapshot?.applicable && scope === 'historical' ? (
        <>
          <div className="grid-2">
            <AnalyticsTableBlock
              title="District Summary"
              description="Official FIT standings snapshot and current advancement lines."
            >
              <div className="panel-2" style={{ padding: 12 }}>
                <div>
                  Current DCMP / States line: {snapshot.season.currentDcmpLinePoints ?? '-'}
                </div>
                <div style={{ marginTop: 6 }}>
                  Current Worlds line: {snapshot.season.currentWorldsLinePoints ?? '-'}
                </div>
                <div style={{ marginTop: 6 }}>
                  Median projected DCMP / States cutoff: {seasonProjection?.dcmpCutoff.p50 ?? '-'}
                </div>
                <div style={{ marginTop: 6 }}>
                  Median projected Worlds cutoff: {seasonProjection?.worldsCutoff.p50 ?? '-'}
                </div>
                <div style={{ marginTop: 6 }}>
                  District points still unclaimed: {snapshot.season.pointsRemainingDistrictCeiling}
                </div>
                <div style={{ marginTop: 6 }}>
                  Remaining Impact/EI/RAS opportunities:{' '}
                  {snapshot.season.remainingTopTierAwards.impact}/
                  {snapshot.season.remainingTopTierAwards.engineeringInspiration}/
                  {snapshot.season.remainingTopTierAwards.rookieAllStar}
                </div>
              </div>
            </AnalyticsTableBlock>
            <AnalyticsTableBlock
              title="Loaded Team Focus"
              description="Season district-point range and qualification outlook for the loaded team."
            >
              {seasonProjection?.loadedTeamSummary ? (
                <div className="panel-2" style={{ padding: 12 }}>
                  <div>Current rank: {snapshot.loadedTeamSeason?.currentRank ?? '-'}</div>
                  <div>Current total: {seasonProjection.loadedTeamSummary.currentTotal}</div>
                  <div style={{ marginTop: 6 }}>
                    P5 / P50 / P95: {seasonProjection.loadedTeamSummary.p5Total} /{' '}
                    {seasonProjection.loadedTeamSummary.p50Total} /{' '}
                    {seasonProjection.loadedTeamSummary.p95Total}
                  </div>
                  {loadedTeamSeasonRow ? (
                    <div style={{ marginTop: 6 }}>
                      Min / Median / Max: {loadedTeamSeasonRow.minTotal} /{' '}
                      {loadedTeamSeasonRow.p50Total} / {loadedTeamSeasonRow.maxTotal}
                    </div>
                  ) : null}
                  <div style={{ marginTop: 6 }}>
                    DCMP / States probability:{' '}
                    {pct(seasonProjection.loadedTeamSummary.dcmpProbability)}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    Worlds probability: {pct(seasonProjection.loadedTeamSummary.worldsProbability)}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    DCMP / States status:{' '}
                    {renderStatusBadge(seasonProjection.loadedTeamSummary.dcmpStatus)}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    Worlds status:{' '}
                    {renderStatusBadge(seasonProjection.loadedTeamSummary.worldsStatus)}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    Gap to median DCMP / States cutoff:{' '}
                    {fmt(seasonProjection.loadedTeamSummary.dcmpGapToMedianCutoff, 0)}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    Gap to median Worlds cutoff:{' '}
                    {fmt(seasonProjection.loadedTeamSummary.worldsGapToMedianCutoff, 0)}
                  </div>
                  <div className="muted" style={{ marginTop: 10, fontSize: 11, lineHeight: 1.4 }}>
                    Status badges are conservative. Locked / eliminated only appear when the
                    official data or point ceilings make that outcome unavoidable. The percentages
                    remain projection-based and do not assign fake future judged-award odds.
                  </div>
                </div>
              ) : (
                <div className="muted">Select a loaded team to see the district focus summary.</div>
              )}
            </AnalyticsTableBlock>
          </div>
          <AnalyticsTableBlock
            title="District Event Schedule"
            description="Remaining performance and top-tier award envelope by FIT event."
          >
            <SimpleTable
              headers={[
                'Event',
                'Week',
                'Status',
                'Teams',
                'Remaining Performance',
                'Top-Tier Envelope',
              ]}
              rows={snapshot.season.events.map((event) => [
                event.shortName || event.name,
                event.week ?? '-',
                titleStatus(event.status),
                event.teamCount,
                event.remainingPerformanceCeiling,
                event.remainingTopTierAwardPoints,
              ])}
            />
          </AnalyticsTableBlock>
          <AnalyticsTableBlock
            title="District Field Projection"
            description="Season-wide FIT projection modeled after the district standing predictors."
          >
            <SimpleTable
              headers={[
                'Rank',
                'Team',
                'Current',
                'Min',
                'P5',
                'P50',
                'P95',
                'Max',
                'DCMP',
                'Worlds',
                'DCMP Status',
                'Worlds Status',
                'Notes',
              ]}
              rows={seasonProjectionRows.map((row) => [
                row.officialRank,
                `${row.teamNumber} ${row.nickname}`,
                row.currentTotal,
                row.minTotal,
                row.p5Total,
                row.p50Total,
                row.p95Total,
                row.maxTotal,
                pct(row.dcmpProbability),
                pct(row.worldsProbability),
                row.dcmpStatus,
                row.worldsStatus,
                row.autoReason ?? '-',
              ])}
            />
          </AnalyticsTableBlock>
          <div className="grid-2">
            <AnalyticsTableBlock
              title="DCMP / States Bubble Board"
              description="Teams around the projected DCMP / States cut line."
            >
              <div className="stack-8">
                {bubbleSlice(snapshot.advancementCounts.dcmp).map((row) => (
                  <div key={row.teamKey} className="panel-2" style={{ padding: 10 }}>
                    <div style={{ fontWeight: 900 }}>
                      {row.teamNumber} {row.nickname}
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      P50 {row.p50Total} | DCMP / States {pct(row.dcmpProbability)} |{' '}
                      <span className={toneClass(toneFromStatus(row.dcmpStatus))}>
                        {row.dcmpStatus}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </AnalyticsTableBlock>
            <AnalyticsTableBlock
              title="Worlds Bubble Board"
              description="Teams around the projected Worlds cut line."
            >
              <div className="stack-8">
                {bubbleSlice(snapshot.advancementCounts.cmp).map((row) => (
                  <div key={row.teamKey} className="panel-2" style={{ padding: 10 }}>
                    <div style={{ fontWeight: 900 }}>
                      {row.teamNumber} {row.nickname}
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      P50 {row.p50Total} | Worlds {pct(row.worldsProbability)} |{' '}
                      <span className={toneClass(toneFromStatus(row.worldsStatus))}>
                        {row.worldsStatus}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </AnalyticsTableBlock>
          </div>
          <div className="grid-2">
            <AnalyticsChartBlock
              title="Loaded-Team Season Histogram"
              data={seasonProjection?.loadedTeamHistogram ?? []}
              chartFamily="bar"
              series={[{ key: 'value', label: 'Runs', color: '#60a5fa' }]}
              valueFormatter={(value) => fmt(value, 0)}
            />
            <AnalyticsChartBlock
              title="District-Wide Probability Ranges"
              description="P5 / P50 / P95 final season totals."
              data={seasonRangeData}
              chartFamily="bar"
              series={[
                { key: 'p5', label: 'P5', color: '#f59e0b' },
                { key: 'p50', label: 'P50', color: '#60a5fa' },
                { key: 'p95', label: 'P95', color: '#34d399' },
              ]}
              valueFormatter={(value) => fmt(value, 0)}
            />
            <AnalyticsChartBlock
              title="DCMP / States / Worlds Cutoff Distribution"
              data={
                seasonProjection
                  ? [
                      {
                        label: 'DCMP',
                        p5: seasonProjection.dcmpCutoff.p5 ?? 0,
                        p50: seasonProjection.dcmpCutoff.p50 ?? 0,
                        p95: seasonProjection.dcmpCutoff.p95 ?? 0,
                      },
                      {
                        label: 'Worlds',
                        p5: seasonProjection.worldsCutoff.p5 ?? 0,
                        p50: seasonProjection.worldsCutoff.p50 ?? 0,
                        p95: seasonProjection.worldsCutoff.p95 ?? 0,
                      },
                    ]
                  : []
              }
              chartFamily="bar"
              series={[
                { key: 'p5', label: 'P5', color: '#f59e0b' },
                { key: 'p50', label: 'P50', color: '#60a5fa' },
                { key: 'p95', label: 'P95', color: '#34d399' },
              ]}
              valueFormatter={(value) => fmt(value, 0)}
            />
            <AnalyticsChartBlock
              title="Current vs Median Cutoff"
              description="Current official line versus the simulated median / high-end final line."
              data={cutoffSummaryData}
              chartFamily="bar"
              series={[
                { key: 'current', label: 'Current Line', color: '#60a5fa' },
                { key: 'median', label: 'Median Final Line', color: '#f59e0b' },
                { key: 'high', label: 'P95 Final Line', color: '#34d399' },
              ]}
              valueFormatter={(value) => fmt(value, 0)}
            />
            <AnalyticsChartBlock
              title="Current Total vs Qualification Odds"
              description="Current district points against simulated advancement odds."
              data={probabilityScatter}
              chartFamily="scatter"
              xKey="total"
              series={[
                { key: 'dcmp', label: 'DCMP %', color: '#60a5fa' },
                { key: 'worlds', label: 'Worlds %', color: '#f472b6' },
              ]}
              valueFormatter={(value) => fmt(value, 1)}
            />
            <AnalyticsChartBlock
              title="Remaining Points By Event"
              data={schedulePointsData}
              chartFamily="bar"
              series={[
                { key: 'performance', label: 'Performance', color: '#60a5fa' },
                { key: 'awards', label: 'Top-Tier Awards', color: '#f59e0b' },
              ]}
              valueFormatter={(value) => fmt(value, 0)}
            />
            <AnalyticsChartBlock
              title="Selected-Team Season Range"
              description="Focused final-season outlook for the selected team."
              data={
                selectedSeasonProjectionRow
                  ? [
                      {
                        label: String(selectedSeasonProjectionRow.teamNumber),
                        min: selectedSeasonProjectionRow.minTotal,
                        p5: selectedSeasonProjectionRow.p5Total,
                        p50: selectedSeasonProjectionRow.p50Total,
                        p95: selectedSeasonProjectionRow.p95Total,
                        max: selectedSeasonProjectionRow.maxTotal,
                      },
                    ]
                  : []
              }
              chartFamily="bar"
              series={[
                { key: 'min', label: 'Min', color: '#64748b' },
                { key: 'p5', label: 'P5', color: '#f59e0b' },
                { key: 'p50', label: 'P50', color: '#60a5fa' },
                { key: 'p95', label: 'P95', color: '#34d399' },
                { key: 'max', label: 'Max', color: '#a78bfa' },
              ]}
              valueFormatter={(value) => fmt(value, 0)}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
