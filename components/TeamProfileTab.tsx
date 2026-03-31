'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import { fetchJsonOrThrow } from '../lib/httpCache';
import { teamNumberFromKey } from '../lib/logic';
import { deriveTeamOpsFromNexusSnapshot } from '../lib/nexus-ops';
import type { TeamProfileMatch, TeamProfileRouteResponse } from '../lib/strategy-types';
import type { NexusOpsSnapshot } from '../lib/types';
import AnalyticsChartBlock from './AnalyticsChartBlock';
import SafeRichText from './SafeRichText';
import DisclosureSection from './ui/DisclosureSection';

type LooseRecord = Record<string, any>;

type TeamProfileScope = 'current' | 'historical';

type StrategyTarget = {
  eventKey: string;
  matchKey: string;
};

type TeamProfileTabProps = {
  suggestedTeamNumber?: number | null;
  forcedTeamNumber?: number | null;
  loadedEventKey?: string;
  nexusSnapshot?: NexusOpsSnapshot | null;
  onOpenStrategy?: (target: StrategyTarget) => void;
  onAddToCompare?: (teamNumber: number) => void;
  scope?: TeamProfileScope;
};

function fmt(value: unknown, digits = 1): string {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(digits);
}
function pct(value: unknown): string {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return `${Math.round(Number(value) * 100)}%`;
}
function numericValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function averageNumbers(values: (number | null | undefined)[]): number | null {
  const cleaned = values.filter((value): value is number => Number.isFinite(Number(value)));
  if (!cleaned.length) return null;
  return cleaned.reduce((sum, value) => sum + value, 0) / cleaned.length;
}
function humanizeKey(key: string): string {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/\brp\b/gi, 'RP')
    .replace(/\bepa\b/gi, 'EPA')
    .replace(/\bqual\b/gi, 'Qual')
    .replace(/\belim\b/gi, 'Elim')
    .replace(/\bteleop\b/gi, 'Teleop')
    .replace(/\bendgame\b/gi, 'Endgame')
    .replace(/\bauto\b/gi, 'Auto')
    .replace(/\btotal\b/gi, 'Total')
    .replace(/\bpoints\b/gi, 'Points')
    .replace(/\bmean\b/gi, 'Mean')
    .replace(/\bsd\b/gi, 'SD')
    .replace(/\bpre champs\b/gi, 'Pre-Champs')
    .replace(/\bnext event\b/gi, 'Next Event')
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}
function summarizeHistoricalPatterns(matches: TeamProfileMatch[]) {
  const sorted = [...matches].sort((a, b) => Number(b.time ?? 0) - Number(a.time ?? 0));
  const opponentCounts = new Map<number, number>();

  for (const match of sorted) {
    for (const teamKey of match.opponents ?? []) {
      const teamNumber = teamNumberFromKey(teamKey);
      if (teamNumber == null) continue;
      opponentCounts.set(teamNumber, (opponentCounts.get(teamNumber) ?? 0) + 1);
    }
  }

  const topOpponents = [...opponentCounts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0] - b[0];
    })
    .slice(0, 5)
    .map(([teamNumber, count]) => ({ teamNumber, count }));

  return {
    count: sorted.length,
    avgScore: averageNumbers(sorted.map((match) => numericValue(match.myScore))),
    avgOppScore: averageNumbers(sorted.map((match) => numericValue(match.oppScore))),
    avgMargin: averageNumbers(sorted.map((match) => numericValue(match.margin))),
    avgAuto: averageNumbers(sorted.map((match) => numericValue(match.breakdown?.auto_points))),
    avgTeleop: averageNumbers(sorted.map((match) => numericValue(match.breakdown?.teleop_points))),
    avgEndgame: averageNumbers(
      sorted.map((match) => numericValue(match.breakdown?.endgame_points)),
    ),
    avgEpa: averageNumbers(sorted.map((match) => numericValue(match.epaTotal))),
    avgPostEpa: averageNumbers(sorted.map((match) => numericValue(match.epaPost))),
    playoffCount: sorted.filter((match) => match.compLevel !== 'qm').length,
    topOpponents,
    recentMatches: sorted.slice(0, 5),
  };
}
export default function TeamProfileTab({
  suggestedTeamNumber,
  forcedTeamNumber,
  loadedEventKey,
  nexusSnapshot,
  onOpenStrategy,
  onAddToCompare,
  scope = 'current',
}: TeamProfileTabProps): ReactElement {
  const [searchInput, setSearchInput] = useState(() =>
    suggestedTeamNumber != null ? String(suggestedTeamNumber) : '',
  );
  const [activeTeamNumber, setActiveTeamNumber] = useState(suggestedTeamNumber ?? null);
  const [profile, setProfile] = useState<TeamProfileRouteResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [eventFilter, setEventFilter] = useState('all');
  const [compFilter, setCompFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState('all');
  const lastForcedRef = useRef<number | null>(null);
  const loadTeamProfile = useCallback(
    async (teamNumber: number) => {
      setIsLoading(true);
      setErrorText('');
      try {
        const query = new URLSearchParams({
          team: String(teamNumber),
        });
        if (loadedEventKey) query.set('eventKey', String(loadedEventKey));
        const json = await fetchJsonOrThrow<TeamProfileRouteResponse>(
          `/api/team-profile?${query.toString()}`,
          {
            cache: 'no-store',
          },
          'Team profile failed',
        );
        setProfile(json);
        setActiveTeamNumber(teamNumber);
        setEventFilter('all');
        setCompFilter('all');
        setResultFilter('all');
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : 'Unknown team-profile error');
        setProfile(null);
      } finally {
        setIsLoading(false);
      }
    },
    [loadedEventKey],
  );
  function handleSearch() {
    const teamNumber = Number(searchInput);
    if (!Number.isFinite(teamNumber) || teamNumber <= 0) {
      setErrorText('Enter a valid team number.');
      return;
    }
    void loadTeamProfile(Math.floor(teamNumber));
  }
  useEffect(() => {
    if (suggestedTeamNumber != null && !searchInput) {
      setSearchInput(String(suggestedTeamNumber));
    }
  }, [suggestedTeamNumber, searchInput]);
  useEffect(() => {
    if (forcedTeamNumber == null || forcedTeamNumber === lastForcedRef.current) return;
    lastForcedRef.current = forcedTeamNumber;
    setSearchInput(String(forcedTeamNumber));
    void loadTeamProfile(forcedTeamNumber);
  }, [forcedTeamNumber, loadTeamProfile]);
  useEffect(() => {
    if (activeTeamNumber == null) return;
    void loadTeamProfile(activeTeamNumber);
  }, [activeTeamNumber, loadTeamProfile]);
  const seasonSummary = useMemo<LooseRecord | null>(
    () => (profile?.seasonSummary as LooseRecord | null) ?? null,
    [profile],
  );
  const legacySummary = useMemo<LooseRecord | null>(
    () => (profile?.summary as LooseRecord | null) ?? null,
    [profile],
  );
  const currentEvent = useMemo(() => profile?.currentEvent ?? null, [profile]);
  const historical2026 = useMemo(() => profile?.historical2026 ?? null, [profile]);
  const currentEventRow = useMemo<LooseRecord | null>(
    () => (currentEvent?.eventRow as LooseRecord | null) ?? null,
    [currentEvent],
  );
  const currentEventInfo = useMemo<LooseRecord | null>(
    () => (currentEvent?.event as LooseRecord | null) ?? null,
    [currentEvent],
  );
  const currentEventMatches = useMemo<LooseRecord[]>(
    () => (currentEvent?.eventMatches as LooseRecord[] | undefined) ?? [],
    [currentEvent],
  );
  const currentEventChartRows = useMemo(() => {
    return currentEventMatches.map((match: LooseRecord) => ({
      label: match.matchLabel,
      rp: numericValue(match.rp),
      epa: numericValue(match.epaTotal),
      score: numericValue(match.myScore),
      opp: numericValue(match.oppScore),
      margin: numericValue(match.margin),
      auto: numericValue(match.breakdown?.auto_points),
      teleop: numericValue(match.breakdown?.teleop_points),
      endgame: numericValue(match.breakdown?.endgame_points),
      rollingOpr: numericValue(match.rollingOpr),
      rollingCopr: numericValue(match.rollingCopr),
      rollingDpr: numericValue(match.rollingDpr),
      rollingCcwm: numericValue(match.rollingCcwm),
    }));
  }, [currentEventMatches]);
  const historicalEventChartRows = useMemo(() => {
    return (historical2026?.seasonEvents ?? []).map((eventRow: LooseRecord, index: number) => ({
      label: eventRow?.event_name ?? eventRow?.event ?? `Event ${index + 1}`,
      epa: numericValue(eventRow?.epa?.norm),
      districtPoints: numericValue(eventRow?.district_points),
      qualRank: numericValue(eventRow?.record?.qual?.rank),
      qualWins: numericValue(eventRow?.record?.qual?.wins),
    }));
  }, [historical2026]);
  const historicalMatches = useMemo<TeamProfileMatch[]>(
    () => (historical2026?.matches as TeamProfileMatch[] | undefined) ?? [],
    [historical2026],
  );
  const visibleHistoricalMatches = useMemo(() => {
    return historicalMatches.filter((match: TeamProfileMatch) => {
      if (eventFilter !== 'all' && match.eventKey !== eventFilter) return false;
      if (compFilter === 'quals' && match.compLevel !== 'qm') return false;
      if (compFilter === 'playoffs' && match.compLevel === 'qm') return false;
      if (resultFilter !== 'all' && match.result !== resultFilter) return false;
      return true;
    });
  }, [historicalMatches, eventFilter, compFilter, resultFilter]);
  const historicalMatchChartRows = useMemo(() => {
    return visibleHistoricalMatches.slice(-28).map((match: TeamProfileMatch, index: number) => ({
      label: match?.matchLabel ?? `Match ${index + 1}`,
      epa: match?.epaTotal ?? null,
      post: match?.epaPost ?? null,
      auto: numericValue(match?.breakdown?.auto_points),
      teleop: numericValue(match?.breakdown?.teleop_points),
      endgame: numericValue(match?.breakdown?.endgame_points),
      score: match?.myScore ?? null,
      opp: match?.oppScore ?? null,
      margin: match?.margin ?? null,
    }));
  }, [visibleHistoricalMatches]);
  const visibleHistoricalLosses = useMemo(
    () => visibleHistoricalMatches.filter((match) => match.result === 'loss'),
    [visibleHistoricalMatches],
  );
  const visibleHistoricalWins = useMemo(
    () => visibleHistoricalMatches.filter((match) => match.result === 'win'),
    [visibleHistoricalMatches],
  );
  const lossPatternSummary = useMemo(
    () => summarizeHistoricalPatterns(visibleHistoricalLosses),
    [visibleHistoricalLosses],
  );
  const winPatternSummary = useMemo(
    () => summarizeHistoricalPatterns(visibleHistoricalWins),
    [visibleHistoricalWins],
  );
  const breakdownEntries = useMemo<[string, unknown][]>(
    () => Object.entries(seasonSummary?.epa?.breakdown ?? {}) as [string, unknown][],
    [seasonSummary],
  );
  const rankEntries = useMemo<[string, LooseRecord][]>(
    () =>
      Object.entries(seasonSummary?.epa?.ranks ?? {}).map(([key, value]) => [
        key,
        (value as LooseRecord | null) ?? {},
      ]),
    [seasonSummary],
  );
  const historicalPlayedEvents = useMemo<LooseRecord[]>(
    () => (historical2026?.playedEvents as LooseRecord[] | undefined) ?? [],
    [historical2026],
  );
  const currentEventOps = useMemo(
    () => deriveTeamOpsFromNexusSnapshot(nexusSnapshot ?? null, activeTeamNumber),
    [activeTeamNumber, nexusSnapshot],
  );
  const currentNormEpa = seasonSummary?.epa?.norm ?? legacySummary?.norm_epa?.current ?? null;
  const recentNormEpa =
    legacySummary?.norm_epa?.recent ?? seasonSummary?.epa?.stats?.pre_champs ?? null;
  const meanNormEpa =
    legacySummary?.norm_epa?.mean ?? seasonSummary?.epa?.total_points?.mean ?? null;
  const maxNormEpa = legacySummary?.norm_epa?.max ?? seasonSummary?.epa?.stats?.max ?? null;
  const epaSd = seasonSummary?.epa?.total_points?.sd ?? null;
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
            value={searchInput}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              handleSearch();
            }}
            placeholder="Search 2026 team number"
            style={{ width: 220 }}
          />
          <button className="button" onClick={handleSearch}>
            Load TEAM_PROFILE
          </button>
          <button
            className="button"
            onClick={() => onAddToCompare?.(activeTeamNumber ?? Number(searchInput))}
            disabled={
              !Number.isFinite(Number(activeTeamNumber ?? searchInput)) ||
              Number(activeTeamNumber ?? searchInput) <= 0
            }
          >
            Add To COMPARE
          </button>
          {activeTeamNumber != null ? (
            <span className="badge">Active Team: {activeTeamNumber}</span>
          ) : null}
          <span className="badge">
            {scope === 'current' ? 'Current Event Only' : 'Historical Only'}
          </span>
          {isLoading ? <span className="badge badge-green">Loading...</span> : null}
          {errorText ? <span className="badge badge-red">{errorText}</span> : null}
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          {scope === 'current'
            ? 'Current-event-only TEAM_PROFILE view with loaded-event charts, loaded-event match history, and status context.'
            : 'Historical-only TEAM_PROFILE view using 2026 data excluding the loaded event.'}
        </div>
      </div>

      {!profile ? (
        <div className="panel" style={{ padding: 16 }}>
          <div className="muted">Search a team to load 2026 scouting data.</div>
        </div>
      ) : scope === 'current' ? (
        <>
          {currentEvent ? (
            <>
              <div className="panel" style={{ padding: 16 }}>
                <div style={{ fontSize: 24, fontWeight: 900 }}>
                  Loaded Event: {currentEventInfo?.name ?? currentEvent?.eventKey ?? loadedEventKey}
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  Rank {currentEventRow?.rank ?? '-'} | RP {fmt(currentEventRow?.totalRp, 1)} |
                  Record {currentEventRow?.record ?? '-'} | EPA{' '}
                  {fmt(currentEventRow?.overallEpa, 1)} | OPR {fmt(currentEventRow?.opr, 1)} | COPR{' '}
                  {fmt(currentEventRow?.copr, 1)} | SOS {fmt(currentEventRow?.totalSos, 1)}
                </div>
                <div style={{ marginTop: 10 }}>
                  <SafeRichText html={currentEvent?.eventStatusHtml ?? '-'} />
                </div>
                {currentEventOps ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    {currentEventOps.pitAddress ? (
                      <span className="badge">Pit {currentEventOps.pitAddress}</span>
                    ) : null}
                    {currentEventOps.inspectionStatus ? (
                      <span className="badge">Inspection {currentEventOps.inspectionStatus}</span>
                    ) : null}
                    {currentEventOps.queueState ? (
                      <span className="badge">{currentEventOps.queueState}</span>
                    ) : null}
                    {currentEventOps.bumperColor ? (
                      <span className="badge">Bumper {currentEventOps.bumperColor}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <DisclosureSection
                storageKey="ui.team_profile.current.event_analytics"
                title="Loaded Event Analytics"
                description="Current-event trend packs, phase output, and match history for the active team."
              >
                <div className="grid-2">
                  <AnalyticsChartBlock
                    title="Loaded Event Match Trend: RP / Score"
                    description="Current-event-only match chronology."
                    data={currentEventChartRows}
                    chartFamily="line"
                    series={[
                      { key: 'rp', label: 'RP', color: '#4bb3fd' },
                      { key: 'score', label: 'Score', color: '#ff6b6b' },
                      { key: 'opp', label: 'Opp Score', color: '#94a3b8' },
                    ]}
                    valueFormatter={(value) => fmt(value, 1)}
                  />
                  <AnalyticsChartBlock
                    title="Loaded Event Rolling Linear Metrics"
                    description="Current-event-only form and drop-off detection."
                    data={currentEventChartRows}
                    chartFamily="line"
                    series={[
                      { key: 'rollingOpr', label: 'rOPR', color: '#f97316' },
                      { key: 'rollingCopr', label: 'rCOPR', color: '#ec4899' },
                      { key: 'rollingDpr', label: 'rDPR', color: '#facc15' },
                      { key: 'rollingCcwm', label: 'rCCWM', color: '#60a5fa' },
                    ]}
                    valueFormatter={(value) => fmt(value, 1)}
                  />
                </div>

                <div className="grid-2">
                  <AnalyticsChartBlock
                    title="Loaded Event Phase Output"
                    description="Per-match phase breakdown and role shape."
                    data={currentEventChartRows}
                    chartFamily="area"
                    series={[
                      { key: 'auto', label: 'Auto', color: '#8ad17d' },
                      { key: 'teleop', label: 'Teleop', color: '#2dd4bf' },
                      { key: 'endgame', label: 'Endgame', color: '#c084fc' },
                    ]}
                    valueFormatter={(value) => fmt(value, 1)}
                  />
                  <AnalyticsChartBlock
                    title="Loaded Event EPA / Margin / Opponent Score"
                    description="Current-event-only drop-off, volatility, and opponent pressure."
                    data={currentEventChartRows}
                    chartFamily="line"
                    series={[
                      { key: 'epa', label: 'EPA', color: '#ff9f68' },
                      { key: 'margin', label: 'Margin', color: '#facc15' },
                      { key: 'opp', label: 'Opp Score', color: '#94a3b8' },
                    ]}
                    valueFormatter={(value) => fmt(value, 1)}
                  />
                </div>

                <div className="grid-2">
                  <AnalyticsChartBlock
                    title="Loaded Event Rolling COPR / DPR / CCWM"
                    description="Current-event-only linear strength trend by completed match."
                    data={currentEventChartRows}
                    chartFamily="line"
                    series={[
                      { key: 'rollingCopr', label: 'rCOPR', color: '#ec4899' },
                      { key: 'rollingDpr', label: 'rDPR', color: '#facc15' },
                      { key: 'rollingCcwm', label: 'rCCWM', color: '#60a5fa' },
                    ]}
                    valueFormatter={(value) => fmt(value, 1)}
                  />
                  <div className="panel" style={{ padding: 16 }}>
                    <div style={{ fontWeight: 900, marginBottom: 10 }}>
                      Loaded Event Match History
                    </div>
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
                            <th
                              style={{
                                padding: 8,
                                borderBottom: '1px solid #223048',
                              }}
                            >
                              Match
                            </th>
                            <th
                              style={{
                                padding: 8,
                                borderBottom: '1px solid #223048',
                              }}
                            >
                              Result
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
                              Score
                            </th>
                            <th
                              style={{
                                padding: 8,
                                borderBottom: '1px solid #223048',
                              }}
                            >
                              OPR
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentEventMatches.map((match: LooseRecord, index: number) => (
                            <tr key={String(match.key ?? match.matchLabel ?? index)}>
                              <td
                                style={{
                                  padding: 8,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {match.matchLabel}
                              </td>
                              <td
                                style={{
                                  padding: 8,
                                  borderBottom: '1px solid #1a2333',
                                  textTransform: 'capitalize',
                                }}
                              >
                                {match.result}
                              </td>
                              <td
                                style={{
                                  padding: 8,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {fmt(match.rp, 1)}
                              </td>
                              <td
                                style={{
                                  padding: 8,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {fmt(match.epaTotal, 1)}
                              </td>
                              <td
                                style={{
                                  padding: 8,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {fmt(match.myScore, 0)} / {fmt(match.oppScore, 0)}
                              </td>
                              <td
                                style={{
                                  padding: 8,
                                  borderBottom: '1px solid #1a2333',
                                }}
                              >
                                {fmt(match.rollingOpr, 1)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </DisclosureSection>
            </>
          ) : (
            <div className="panel" style={{ padding: 16 }}>
              <div className="muted">
                Load an event to populate the current-event TEAM_PROFILE view.
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontSize: 26, fontWeight: 900 }}>
              {profile.team} {seasonSummary?.name ?? legacySummary?.name ?? ''}
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              Historical-only 2026 view | District {seasonSummary?.district ?? '-'} | State{' '}
              {seasonSummary?.state ?? '-'} | Rookie Year {seasonSummary?.rookie_year ?? '-'}
            </div>
            <div
              style={{
                marginTop: 12,
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <button className="button" onClick={() => onAddToCompare?.(profile.team)}>
                Add {profile.team} To COMPARE
              </button>
              <span className="badge">Current EPA {fmt(currentNormEpa, 1)}</span>
              <span className="badge">Recent EPA {fmt(recentNormEpa, 1)}</span>
              <span className="badge">Mean EPA {fmt(meanNormEpa, 1)}</span>
              <span className="badge">Max EPA {fmt(maxNormEpa, 1)}</span>
              <span className="badge">SD {fmt(epaSd, 2)}</span>
            </div>
          </div>

          <div className="grid-2">
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>
                Historical Rank / Percentile Context
              </div>
              <div className="grid-2">
                {rankEntries.map(([contextKey, row]) => (
                  <div key={contextKey} className="panel-2" style={{ padding: 12 }}>
                    <div style={{ fontWeight: 900 }}>{humanizeKey(contextKey)}</div>
                    <div style={{ marginTop: 6 }}>
                      Rank {row?.rank ?? '-'} / {row?.team_count ?? '-'}
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      Percentile {pct(row?.percentile)}
                    </div>
                  </div>
                ))}
                {!rankEntries.length ? (
                  <div className="muted">No 2026 rank context available yet.</div>
                ) : null}
              </div>
            </div>

            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>
                Historical Raw Breakdown Fields
              </div>
              <div className="grid-2">
                {breakdownEntries.map(([key, value]) => (
                  <div key={key} className="panel-2" style={{ padding: 10 }}>
                    <div style={{ fontWeight: 900, fontSize: 12 }}>{humanizeKey(key)}</div>
                    <div style={{ marginTop: 6 }}>{fmt(value, 3)}</div>
                  </div>
                ))}
                {!breakdownEntries.length ? (
                  <div className="muted">No historical breakdown values available yet.</div>
                ) : null}
              </div>
            </div>
          </div>

          {historicalEventChartRows.length ? (
            <div className="grid-2">
              <AnalyticsChartBlock
                title="Historical 2026 Event Chronology"
                description="Historical events excluding the currently loaded event."
                data={historicalEventChartRows}
                chartFamily="line"
                series={[
                  { key: 'epa', label: 'Event EPA', color: '#ff9f68' },
                  {
                    key: 'districtPoints',
                    label: 'District Points',
                    color: '#8ad17d',
                  },
                ]}
                valueFormatter={(value) => fmt(value, 1)}
              />
              <AnalyticsChartBlock
                title="Historical 2026 Qual Rank Context"
                description="Historical event placement and qual wins."
                data={historicalEventChartRows}
                chartFamily="bar"
                series={[
                  { key: 'qualRank', label: 'Qual Rank', color: '#f3be3b' },
                  { key: 'qualWins', label: 'Qual Wins', color: '#4bb3fd' },
                ]}
                valueFormatter={(value) => fmt(value, 0)}
              />
            </div>
          ) : null}

          {historicalMatchChartRows.length ? (
            <div className="grid-2">
              <AnalyticsChartBlock
                title="Historical 2026 Match Chronology"
                description="Historical match EPA, post-match EPA, and margin."
                data={historicalMatchChartRows}
                chartFamily="line"
                series={[
                  { key: 'epa', label: 'EPA', color: '#ff9f68' },
                  { key: 'post', label: 'Post EPA', color: '#4bb3fd' },
                  { key: 'margin', label: 'Margin', color: '#facc15' },
                ]}
                valueFormatter={(value) => fmt(value, 1)}
              />
              <AnalyticsChartBlock
                title="Historical 2026 Match Phase Output"
                description="Historical auto, teleop, endgame, and score context."
                data={historicalMatchChartRows}
                chartFamily="bar"
                series={[
                  { key: 'auto', label: 'Auto', color: '#8ad17d' },
                  { key: 'teleop', label: 'Teleop', color: '#2dd4bf' },
                  { key: 'endgame', label: 'Endgame', color: '#c084fc' },
                  { key: 'score', label: 'Score', color: '#ff6b6b' },
                ]}
                valueFormatter={(value) => fmt(value, 1)}
              />
            </div>
          ) : null}

          <div className="grid-2">
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Historical Match Filters</div>
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
                  onClick={() => setEventFilter('all')}
                  style={{
                    background: eventFilter === 'all' ? '#182336' : undefined,
                  }}
                >
                  All Historical Matches
                </button>
                {historicalPlayedEvents.map((eventRow: LooseRecord) => (
                  <button
                    key={String(eventRow.event ?? eventRow.event_name ?? 'event')}
                    className="button"
                    onClick={() => setEventFilter(String(eventRow.event ?? ''))}
                    style={{
                      background:
                        eventFilter === String(eventRow.event ?? '') ? '#182336' : undefined,
                    }}
                  >
                    {String(eventRow.event_name ?? eventRow.event ?? 'Unknown Event')}
                  </button>
                ))}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  marginTop: 12,
                }}
              >
                <select
                  className="input"
                  value={compFilter}
                  onChange={(event) => setCompFilter(event.target.value)}
                >
                  <option value="all">All Matches</option>
                  <option value="quals">Quals Only</option>
                  <option value="playoffs">Playoffs Only</option>
                </select>
                <select
                  className="input"
                  value={resultFilter}
                  onChange={(event) => setResultFilter(event.target.value)}
                >
                  <option value="all">All Results</option>
                  <option value="win">Wins</option>
                  <option value="loss">Losses</option>
                  <option value="tie">Ties</option>
                  <option value="unknown">Unknown</option>
                </select>
                <span className="badge">Visible Matches: {visibleHistoricalMatches.length}</span>
              </div>
            </div>
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Historical Event Counts</div>
              <div className="stack-8">
                <div>Played events: {historical2026?.playedEvents?.length ?? 0}</div>
                <div>Upcoming events: {historical2026?.upcomingEvents?.length ?? 0}</div>
                <div>Historical matches: {historicalMatches.length}</div>
                <div>
                  2026 record: {seasonSummary?.record?.wins ?? 0}-
                  {seasonSummary?.record?.losses ?? 0}-{seasonSummary?.record?.ties ?? 0}
                </div>
                <div>District points: {seasonSummary?.district_points ?? '-'}</div>
                <div>District rank: {seasonSummary?.district_rank ?? '-'}</div>
              </div>
            </div>
          </div>

          <div className="grid-2">
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>What Beat Them Before?</div>
              {lossPatternSummary.count ? (
                <div className="stack-8">
                  <div className="grid-2">
                    <div className="panel-2" style={{ padding: 12 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        Losses In View
                      </div>
                      <div style={{ fontWeight: 900 }}>{lossPatternSummary.count}</div>
                    </div>
                    <div className="panel-2" style={{ padding: 12 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        Avg Margin
                      </div>
                      <div style={{ fontWeight: 900 }}>{fmt(lossPatternSummary.avgMargin, 1)}</div>
                    </div>
                    <div className="panel-2" style={{ padding: 12 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        Avg Opp Score
                      </div>
                      <div style={{ fontWeight: 900 }}>
                        {fmt(lossPatternSummary.avgOppScore, 1)}
                      </div>
                    </div>
                    <div className="panel-2" style={{ padding: 12 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        Avg Teleop In Losses
                      </div>
                      <div style={{ fontWeight: 900 }}>{fmt(lossPatternSummary.avgTeleop, 1)}</div>
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Opponents in losses:{' '}
                    {lossPatternSummary.topOpponents.length
                      ? lossPatternSummary.topOpponents
                          .map((entry) => `${entry.teamNumber} x${entry.count}`)
                          .join(', ')
                      : 'No repeated opponent pattern yet.'}
                  </div>
                  <div className="stack-8">
                    <div style={{ fontWeight: 900 }}>Recent Losses To Study</div>
                    {lossPatternSummary.recentMatches.map((match) => (
                      <div
                        key={`loss_${match.key}`}
                        className="panel-2"
                        style={{
                          padding: 12,
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 12,
                          flexWrap: 'wrap',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 900 }}>
                            {match.eventName} | {match.matchLabel}
                          </div>
                          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                            Score {fmt(match.myScore, 0)} / {fmt(match.oppScore, 0)} | Auto{' '}
                            {fmt(match.breakdown?.auto_points, 1)} | Tele{' '}
                            {fmt(match.breakdown?.teleop_points, 1)} | End{' '}
                            {fmt(match.breakdown?.endgame_points, 1)}
                          </div>
                          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                            Opponents:{' '}
                            {(match.opponents ?? [])
                              .map((teamKey) => teamNumberFromKey(teamKey) ?? teamKey)
                              .join(' ') || '-'}
                          </div>
                        </div>
                        <button
                          className="button"
                          onClick={() =>
                            onOpenStrategy?.({
                              eventKey: match.eventKey,
                              matchKey: match.key,
                            })
                          }
                          disabled={!onOpenStrategy}
                        >
                          Open in STRATEGY
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="muted">No historical losses match the current filters yet.</div>
              )}
            </div>

            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>What Works When They Win?</div>
              {winPatternSummary.count ? (
                <div className="stack-8">
                  <div className="grid-2">
                    <div className="panel-2" style={{ padding: 12 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        Wins In View
                      </div>
                      <div style={{ fontWeight: 900 }}>{winPatternSummary.count}</div>
                    </div>
                    <div className="panel-2" style={{ padding: 12 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        Avg Margin
                      </div>
                      <div style={{ fontWeight: 900 }}>{fmt(winPatternSummary.avgMargin, 1)}</div>
                    </div>
                    <div className="panel-2" style={{ padding: 12 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        Avg Score
                      </div>
                      <div style={{ fontWeight: 900 }}>{fmt(winPatternSummary.avgScore, 1)}</div>
                    </div>
                    <div className="panel-2" style={{ padding: 12 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        Avg Endgame In Wins
                      </div>
                      <div style={{ fontWeight: 900 }}>{fmt(winPatternSummary.avgEndgame, 1)}</div>
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Opponents in wins:{' '}
                    {winPatternSummary.topOpponents.length
                      ? winPatternSummary.topOpponents
                          .map((entry) => `${entry.teamNumber} x${entry.count}`)
                          .join(', ')
                      : 'No repeated opponent pattern yet.'}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    EPA trend in wins: {fmt(winPatternSummary.avgEpa, 1)} to Post{' '}
                    {fmt(winPatternSummary.avgPostEpa, 1)} | Playoff wins{' '}
                    {winPatternSummary.playoffCount}
                  </div>
                </div>
              ) : (
                <div className="muted">No historical wins match the current filters yet.</div>
              )}
            </div>
          </div>

          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Historical 2026 Match History</div>
            <div style={{ overflow: 'auto', maxHeight: 760 }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Event</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Match</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Time</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Alliance</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Partners</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Opponents</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Result</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>EPA</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Post</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Auto</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Tele</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>End</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Score</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleHistoricalMatches.map((match) => (
                    <tr key={match.key}>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {match.eventName}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                          fontWeight: 700,
                        }}
                      >
                        {match.matchLabel}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {match.time ? new Date(Number(match.time) * 1000).toLocaleString() : '-'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {match.alliance ?? '-'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                        className="mono"
                      >
                        {match.partners?.length
                          ? match.partners.map((key) => teamNumberFromKey(key) ?? key).join(' ')
                          : '-'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                        className="mono"
                      >
                        {match.opponents?.length
                          ? match.opponents.map((key) => teamNumberFromKey(key) ?? key).join(' ')
                          : '-'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                          textTransform: 'capitalize',
                        }}
                      >
                        {match.result}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(match.epaTotal, 2)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(match.epaPost, 2)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(match.breakdown?.auto_points, 2)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(match.breakdown?.teleop_points, 2)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {fmt(match.breakdown?.endgame_points, 2)}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        {match.redScore != null && match.blueScore != null
                          ? `R ${match.redScore} / B ${match.blueScore}`
                          : '-'}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: '1px solid #1a2333',
                        }}
                      >
                        <button
                          className="button"
                          onClick={() =>
                            onOpenStrategy?.({
                              eventKey: match.eventKey,
                              matchKey: match.key,
                            })
                          }
                          disabled={!onOpenStrategy}
                        >
                          Open in STRATEGY
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!visibleHistoricalMatches.length ? (
                    <tr>
                      <td
                        colSpan={14}
                        style={{
                          padding: 12,
                          borderBottom: '1px solid #1a2333',
                        }}
                        className="muted"
                      >
                        No historical matches match the current filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
