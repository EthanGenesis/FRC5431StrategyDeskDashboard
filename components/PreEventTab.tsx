'use client';
import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import { fetchJsonOrThrow } from '../lib/httpCache';
import type { PreEventScoutResponse } from '../lib/strategy-types';
import type { CompareTeamEventRow, MatchSimple } from '../lib/types';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMatchLabel, safeNumber, tbaTeamKey } from '../lib/logic';
import DisclosureSection from './ui/DisclosureSection';

type LooseRecord = Record<string, any>;

type PreEventMode = 'pre_event' | 'event' | 'rankings' | 'playoffs' | 'strategy';
type SortMode =
  | 'season_epa'
  | 'season_rank'
  | 'district_points'
  | 'auto'
  | 'teleop'
  | 'endgame'
  | 'mean_total';

type SeasonScoutRow = PreEventScoutResponse['teams'][number];

type MergedScoutRow = CompareTeamEventRow & {
  seasonSummary: LooseRecord | null;
  seasonRollups: LooseRecord | null;
  playedEvents: LooseRecord[];
  upcomingEvents: LooseRecord[];
  seasonCurrentEpa: number | null;
  seasonMeanTotal: number | null;
  seasonAuto: number | null;
  seasonTeleop: number | null;
  seasonEndgame: number | null;
  seasonWorldRank: number | null;
  seasonCountryRank: number | null;
  seasonStateRank: number | null;
  seasonDistrictRank: number | null;
  seasonCountryPercentile: number | null;
  seasonDistrictPercentile: number | null;
  districtPoints: number | null;
  seasonRecordText: string;
};

type PreEventTabProps = {
  loadedEventKey?: string;
  loadedTeam?: number | null;
  eventTeamRows: CompareTeamEventRow[];
  ourUpcomingMatches: MatchSimple[];
  keyMatches: MatchSimple[];
  renderKeyMatchCard: (match: MatchSimple) => ReactElement;
  onOpenTeamProfile: (teamNumber: number) => void;
  onAddToCompare?: (teamNumber: number) => void;
  mode?: PreEventMode;
};

type SpecialtyMetricKey =
  | 'seasonCurrentEpa'
  | 'seasonAuto'
  | 'seasonTeleop'
  | 'seasonEndgame'
  | 'districtPoints'
  | 'seasonMeanTotal';

function fmt(value: unknown, digits = 1): string {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(digits);
}
function pct(value: unknown): string {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return `${Math.round(Number(value) * 100)}%`;
}
function safeValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function humanizeKey(key: string): string {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/\brp\b/gi, 'RP')
    .replace(/\bepa\b/gi, 'EPA')
    .replace(/\bteleop\b/gi, 'Teleop')
    .replace(/\bendgame\b/gi, 'Endgame')
    .replace(/\bauto\b/gi, 'Auto')
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}
function seasonCurrentEpa(summary: LooseRecord | null | undefined): number | null {
  return safeValue(
    summary?.epa?.norm ?? summary?.norm_epa?.current ?? summary?.epa?.total_points?.mean,
  );
}
function seasonMeanTotal(summary: LooseRecord | null | undefined): number | null {
  return safeValue(summary?.epa?.total_points?.mean ?? summary?.epa?.breakdown?.total_points);
}
function seasonBreakdown(summary: LooseRecord | null | undefined, key: string): number | null {
  return safeValue(summary?.epa?.breakdown?.[key]);
}
function rankValue(summary: LooseRecord | null | undefined, key: string): number | null {
  return safeValue(summary?.epa?.ranks?.[key]?.rank);
}
function percentileValue(summary: LooseRecord | null | undefined, key: string): number | null {
  return safeValue(summary?.epa?.ranks?.[key]?.percentile);
}
function recordText(
  summary: LooseRecord | null | undefined,
  rollups: LooseRecord | null | undefined,
): string {
  const record = summary?.record;
  if (record?.wins != null || record?.losses != null || record?.ties != null) {
    return `${record?.wins ?? 0}-${record?.losses ?? 0}-${record?.ties ?? 0}`;
  }
  if (rollups) {
    return `${rollups?.wins ?? 0}-${rollups?.losses ?? 0}-${rollups?.ties ?? 0}`;
  }
  return '-';
}
function eventTypeLabel(event: LooseRecord | null | undefined): string {
  return event?.event_type_string ?? event?.event_type ?? '-';
}
function isNumber(value: number | null): value is number {
  return value != null;
}
export default function PreEventTab({
  loadedEventKey,
  loadedTeam,
  eventTeamRows,
  ourUpcomingMatches,
  keyMatches,
  renderKeyMatchCard,
  onOpenTeamProfile,
  onAddToCompare,
  mode = 'pre_event',
}: PreEventTabProps): ReactElement {
  const [scoutData, setScoutData] = useState<PreEventScoutResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('season_epa');
  useEffect(() => {
    if (!loadedEventKey) {
      setScoutData(null);
      setErrorText('');
      setIsLoading(false);
      return;
    }
    const eventKey = loadedEventKey;
    let cancelled = false;
    async function loadScout() {
      setIsLoading(true);
      setErrorText('');
      try {
        const json = await fetchJsonOrThrow<PreEventScoutResponse>(
          `/api/pre-event-scout?eventKey=${encodeURIComponent(eventKey)}`,
          { cache: 'no-store' },
          'Pre-event scout load failed',
        );
        if (!cancelled) setScoutData(json);
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : 'Unknown pre-event scout error');
          setScoutData(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadScout();
    return () => {
      cancelled = true;
    };
  }, [loadedEventKey]);
  const seasonMap = useMemo(() => {
    const map = new Map<number, SeasonScoutRow>();
    for (const row of scoutData?.teams ?? []) {
      const teamNumber = Number(row?.teamNumber ?? 0);
      if (Number.isFinite(teamNumber) && teamNumber > 0) map.set(teamNumber, row);
    }
    return map;
  }, [scoutData]);
  const mergedRows = useMemo<MergedScoutRow[]>(() => {
    return eventTeamRows.map((row: CompareTeamEventRow) => {
      const seasonRow = seasonMap.get(Number(row.teamNumber)) ?? null;
      const seasonSummary = (seasonRow?.seasonSummary as LooseRecord | null) ?? null;
      const seasonRollups = (seasonRow?.seasonRollups as LooseRecord | null) ?? null;
      return {
        ...row,
        seasonSummary,
        seasonRollups,
        playedEvents: (seasonRow?.playedEvents as LooseRecord[] | undefined) ?? [],
        upcomingEvents: (seasonRow?.upcomingEvents as LooseRecord[] | undefined) ?? [],
        seasonCurrentEpa: seasonCurrentEpa(seasonSummary),
        seasonMeanTotal: seasonMeanTotal(seasonSummary),
        seasonAuto: seasonBreakdown(seasonSummary, 'auto_points'),
        seasonTeleop: seasonBreakdown(seasonSummary, 'teleop_points'),
        seasonEndgame: seasonBreakdown(seasonSummary, 'endgame_points'),
        seasonWorldRank: rankValue(seasonSummary, 'total'),
        seasonCountryRank: rankValue(seasonSummary, 'country'),
        seasonStateRank: rankValue(seasonSummary, 'state'),
        seasonDistrictRank: rankValue(seasonSummary, 'district'),
        seasonCountryPercentile: percentileValue(seasonSummary, 'country'),
        seasonDistrictPercentile: percentileValue(seasonSummary, 'district'),
        districtPoints: safeValue(seasonSummary?.district_points),
        seasonRecordText: recordText(seasonSummary, seasonRollups),
      };
    });
  }, [eventTeamRows, seasonMap]);
  const filteredRows = useMemo<MergedScoutRow[]>(() => {
    const q = search.trim().toLowerCase();
    const rows = mergedRows.filter((row: MergedScoutRow) => {
      if (!q) return true;
      return (
        String(row.teamNumber).includes(q) ||
        String(row.teamKey ?? '')
          .toLowerCase()
          .includes(q) ||
        String(row.nickname ?? '')
          .toLowerCase()
          .includes(q)
      );
    });
    const sorters: Record<SortMode, (row: MergedScoutRow) => number> = {
      season_epa: (row: MergedScoutRow) => safeNumber(row.seasonCurrentEpa, -999999),
      season_rank: (row: MergedScoutRow) =>
        safeNumber(row.seasonWorldRank != null ? 100000 - row.seasonWorldRank : -999999, -999999),
      district_points: (row: MergedScoutRow) => safeNumber(row.districtPoints, -999999),
      auto: (row: MergedScoutRow) => safeNumber(row.seasonAuto, -999999),
      teleop: (row: MergedScoutRow) => safeNumber(row.seasonTeleop, -999999),
      endgame: (row: MergedScoutRow) => safeNumber(row.seasonEndgame, -999999),
      mean_total: (row: MergedScoutRow) => safeNumber(row.seasonMeanTotal, -999999),
    };
    const sorter = sorters[sortMode];
    return [...rows].sort((a, b) => {
      const aValue = sorter(a);
      const bValue = sorter(b);
      if (bValue !== aValue) return bValue - aValue;
      return String(a.teamKey ?? '').localeCompare(String(b.teamKey ?? ''));
    });
  }, [mergedRows, search, sortMode]);
  const event = (scoutData?.event as LooseRecord | null) ?? null;
  const eventAverages = useMemo(() => {
    if (!mergedRows.length) {
      return {
        seasonCurrentEpa: null,
        seasonMeanTotal: null,
        districtPoints: null,
      };
    }
    const currentEpas = mergedRows.map((row) => row.seasonCurrentEpa).filter(isNumber);
    const meanTotals = mergedRows.map((row) => row.seasonMeanTotal).filter(isNumber);
    const districtPoints = mergedRows.map((row) => row.districtPoints).filter(isNumber);
    return {
      seasonCurrentEpa: currentEpas.length
        ? currentEpas.reduce((sum: number, value: number) => sum + value, 0) / currentEpas.length
        : null,
      seasonMeanTotal: meanTotals.length
        ? meanTotals.reduce((sum: number, value: number) => sum + value, 0) / meanTotals.length
        : null,
      districtPoints: districtPoints.length
        ? districtPoints.reduce((sum: number, value: number) => sum + value, 0) /
          districtPoints.length
        : null,
    };
  }, [mergedRows]);
  const likelyCaptains = useMemo(() => {
    return [...mergedRows]
      .sort((a, b) => {
        const aWorldRankScore = a.seasonWorldRank != null ? 100000 - Number(a.seasonWorldRank) : 0;
        const bWorldRankScore = b.seasonWorldRank != null ? 100000 - Number(b.seasonWorldRank) : 0;
        const aScore =
          Number(a.seasonCurrentEpa ?? -999) * 0.7 +
          Number(a.districtPoints ?? 0) * 0.15 +
          aWorldRankScore * 0.00015;
        const bScore =
          Number(b.seasonCurrentEpa ?? -999) * 0.7 +
          Number(b.districtPoints ?? 0) * 0.15 +
          bWorldRankScore * 0.00015;
        return bScore - aScore;
      })
      .slice(0, 8);
  }, [mergedRows]);
  const specialtyBoards = useMemo(() => {
    const groups: { label: string; key: SpecialtyMetricKey }[] = [
      { label: 'Season EPA Leaders', key: 'seasonCurrentEpa' },
      { label: 'Auto Specialists', key: 'seasonAuto' },
      { label: 'Teleop Specialists', key: 'seasonTeleop' },
      { label: 'Endgame Specialists', key: 'seasonEndgame' },
      { label: 'District Points', key: 'districtPoints' },
      { label: 'Season Mean Total', key: 'seasonMeanTotal' },
    ];
    return groups.map((group) => ({
      ...group,
      rows: [...mergedRows]
        .filter((row) => row[group.key] != null)
        .sort((a, b) => Number(b[group.key] ?? -999999) - Number(a[group.key] ?? -999999))
        .slice(0, 6),
    }));
  }, [mergedRows]);
  const rawSpecialtyBoards = useMemo(() => {
    const keys = [
      'auto_fuel',
      'teleop_fuel',
      'endgame_tower',
      'total_tower',
      'rp_1',
      'rp_2',
      'rp_3',
    ];
    return keys
      .map((key) => ({
        key,
        label: humanizeKey(key),
        rows: [...mergedRows]
          .filter((row) => seasonBreakdown(row.seasonSummary, key) != null)
          .sort(
            (a, b) =>
              Number(seasonBreakdown(b.seasonSummary, key) ?? -999999) -
              Number(seasonBreakdown(a.seasonSummary, key) ?? -999999),
          )
          .slice(0, 5),
      }))
      .filter((group) => group.rows.length > 0);
  }, [mergedRows]);
  const historicalChartRows = useMemo(() => {
    const metricMap: Record<SortMode, (row: MergedScoutRow) => number | null> = {
      season_epa: (row: MergedScoutRow) => safeValue(row.seasonCurrentEpa),
      season_rank: (row: MergedScoutRow) =>
        row.seasonWorldRank != null ? 100000 - Number(row.seasonWorldRank) : null,
      district_points: (row: MergedScoutRow) => safeValue(row.districtPoints),
      auto: (row: MergedScoutRow) => safeValue(row.seasonAuto),
      teleop: (row: MergedScoutRow) => safeValue(row.seasonTeleop),
      endgame: (row: MergedScoutRow) => safeValue(row.seasonEndgame),
      mean_total: (row: MergedScoutRow) => safeValue(row.seasonMeanTotal),
    };
    return filteredRows.slice(0, 12).map((row) => ({
      label: String(row.teamNumber),
      value: metricMap[sortMode](row) ?? null,
    }));
  }, [filteredRows, sortMode]);
  const historicalBreakdownRows = useMemo(() => {
    return filteredRows.slice(0, 10).map((row) => ({
      label: String(row.teamNumber),
      auto: safeValue(row.seasonAuto) ?? 0,
      teleop: safeValue(row.seasonTeleop) ?? 0,
      endgame: safeValue(row.seasonEndgame) ?? 0,
    }));
  }, [filteredRows]);
  const ourTeamKey = loadedTeam != null ? tbaTeamKey(loadedTeam) : null;
  const showHistoricalCharts = mode === 'pre_event' || mode === 'event' || mode === 'rankings';
  const showMainTable = mode === 'pre_event' || mode === 'event' || mode === 'rankings';
  const showCaptainBoards = mode === 'pre_event' || mode === 'rankings' || mode === 'playoffs';
  const showThreatBoards = mode === 'pre_event' || mode === 'rankings' || mode === 'playoffs';
  const showRawSpecialtyBoards = mode === 'pre_event' || mode === 'rankings' || mode === 'playoffs';
  const showMatchupBoard = mode === 'pre_event' || mode === 'strategy';
  const showWatchlist = mode === 'pre_event' || mode === 'strategy' || mode === 'event';
  const matchupMatches = useMemo<MatchSimple[]>(() => {
    if (!ourTeamKey) return [];
    return ourUpcomingMatches
      .filter((match: MatchSimple) => match?.comp_level === 'qm')
      .slice(0, 6);
  }, [ourUpcomingMatches, ourTeamKey]);
  const mergedMapByKey = useMemo(() => {
    const map = new Map<string, MergedScoutRow>();
    for (const row of mergedRows) {
      if (row?.teamKey) map.set(String(row.teamKey), row);
    }
    return map;
  }, [mergedRows]);
  function renderAllianceLine(teamKeys: string[], ourKey: string | null): ReactElement {
    return (
      <div className="stack-8">
        {teamKeys.map((teamKey: string) => {
          const row = mergedMapByKey.get(teamKey) ?? null;
          const teamNumber = row?.teamNumber ?? Number(String(teamKey).replace(/\D/g, ''));
          const isUs = ourKey != null && teamKey === ourKey;
          return (
            <div
              key={teamKey}
              className="panel-2"
              style={{
                padding: 10,
                background: isUs ? '#132033' : undefined,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <div style={{ fontWeight: 900 }}>
                  {teamNumber} {row?.nickname ?? ''}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="button" onClick={() => onOpenTeamProfile(teamNumber)}>
                    TEAM_PROFILE
                  </button>
                  <button className="button" onClick={() => onAddToCompare?.(teamNumber)}>
                    COMPARE
                  </button>
                </div>
              </div>
              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                Season EPA {fmt(row?.seasonCurrentEpa, 1)} | Mean {fmt(row?.seasonMeanTotal, 1)} |
                Auto {fmt(row?.seasonAuto, 1)} | Tele {fmt(row?.seasonTeleop, 1)} | End{' '}
                {fmt(row?.seasonEndgame, 1)}
              </div>
              <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                World Rank {row?.seasonWorldRank ?? '-'} | Country %{' '}
                {pct(row?.seasonCountryPercentile)} | District Pts {row?.districtPoints ?? '-'} |
                2026 Record {row?.seasonRecordText ?? '-'}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  if (!loadedEventKey) {
    return (
      <div className="panel" style={{ padding: 16, marginTop: 12 }}>
        <div className="muted">Load an event first to build the 2026 pre-scout board.</div>
      </div>
    );
  }
  return (
    <div className="stack-12" style={{ marginTop: 12 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 12,
        }}
      >
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, fontSize: 20 }}>{event?.name ?? loadedEventKey}</div>
          <div className="muted" style={{ marginTop: 6 }}>
            Event Key {loadedEventKey} | Type {eventTypeLabel(event)} | Week {event?.week ?? '-'}
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            Teams {mergedRows.length} | Generated{' '}
            {scoutData?.generatedAtMs
              ? new Date(scoutData.generatedAtMs).toLocaleTimeString()
              : '-'}
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isLoading ? (
              <span className="badge badge-green">Loading 2026 season scouts...</span>
            ) : null}
            {!isLoading && scoutData ? (
              <span className="badge">2026 season scouts loaded</span>
            ) : null}
            {errorText ? <span className="badge badge-red">{errorText}</span> : null}
          </div>
        </div>

        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Event Baseline</div>
          <div className="panel-2" style={{ padding: 12 }}>
            <div>Avg season current EPA {fmt(eventAverages.seasonCurrentEpa, 1)}</div>
            <div style={{ marginTop: 6 }}>
              Avg season total points {fmt(eventAverages.seasonMeanTotal, 1)}
            </div>
            <div style={{ marginTop: 6 }}>
              Avg district points {fmt(eventAverages.districtPoints, 1)}
            </div>
            <div style={{ marginTop: 6 }}>
              Historical-only scouting mode for the loaded event roster.
            </div>
          </div>
        </div>

        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Our Team Focus</div>
          <div className="panel-2" style={{ padding: 12 }}>
            <div>Our team {loadedTeam ?? '-'}</div>
            <div style={{ marginTop: 6 }}>Upcoming quals {matchupMatches.length}</div>
            <div style={{ marginTop: 6 }}>
              Next match {matchupMatches[0] ? formatMatchLabel(matchupMatches[0]) : '-'}
            </div>
            <div style={{ marginTop: 6 }}>
              Key watchlist matches {Math.min(10, keyMatches.length)}
            </div>
          </div>
        </div>
      </div>

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
            value={search}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
            placeholder="Search event team"
            style={{ width: 240 }}
          />
          <select
            className="input"
            value={sortMode}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              setSortMode(event.target.value as SortMode)
            }
          >
            <option value="season_epa">Sort: Season EPA</option>
            <option value="season_rank">Sort: 2026 World Rank</option>
            <option value="district_points">Sort: District Points</option>
            <option value="mean_total">Sort: Season Mean Total</option>
            <option value="auto">Sort: Season Auto</option>
            <option value="teleop">Sort: Season Teleop</option>
            <option value="endgame">Sort: Season Endgame</option>
          </select>
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          {mode === 'pre_event'
            ? 'PRE_EVENT is historical-only: 2026 season scouting for the teams attending this event, with no live event metrics mixed into the rankings.'
            : `Historical-only ${mode.toUpperCase()} view for the loaded event roster.`}
        </div>
      </div>

      {showHistoricalCharts ? (
        <DisclosureSection
          storageKey={`ui.pre_event.${mode}.charts`}
          title="Historical Distribution Charts"
          description="Season-level leaderboard and phase-distribution context for the loaded event field."
          defaultOpen
        >
          <div className="grid-2">
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Historical Leaderboard Chart</div>
              <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer>
                  <BarChart data={historicalChartRows}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#223048" />
                    <XAxis dataKey="label" stroke="#b7c2d6" />
                    <YAxis stroke="#b7c2d6" />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="value" fill="#4bb3fd" name={sortMode} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>
                Historical Breakdown Distribution
              </div>
              <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer>
                  <BarChart data={historicalBreakdownRows}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#223048" />
                    <XAxis dataKey="label" stroke="#b7c2d6" />
                    <YAxis stroke="#b7c2d6" />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="auto" stackId="a" fill="#ff7a59" name="Auto" />
                    <Bar dataKey="teleop" stackId="a" fill="#38bdf8" name="Teleop" />
                    <Bar dataKey="endgame" stackId="a" fill="#a3e635" name="Endgame" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </DisclosureSection>
      ) : null}

      {showMainTable ? (
        <DisclosureSection
          storageKey={`ui.pre_event.${mode}.main_table`}
          title="Main Scouting Table"
          description="The full historical scouting matrix for every team in the loaded event field."
          defaultOpen
        >
          <div className="panel" style={{ padding: 16 }}>
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
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Team</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Season EPA</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Mean Pts</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Auto</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Tele</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>End</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>World Rank</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Country %</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>District</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>2026 Record</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Played / Up</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>District Pts</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>District Rank</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Country Rank</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Played Events</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>
                      Upcoming Events
                    </th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.teamKey}>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        <div style={{ fontWeight: 900 }}>{row.teamNumber}</div>
                        <div className="muted">{row.nickname}</div>
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {fmt(row.seasonCurrentEpa, 1)}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {fmt(row.seasonMeanTotal, 1)}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {fmt(row.seasonAuto, 1)}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {fmt(row.seasonTeleop, 1)}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {fmt(row.seasonEndgame, 1)}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.seasonWorldRank ?? '-'}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {pct(row.seasonCountryPercentile)}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.districtPoints ?? '-'}
                        <div className="muted" style={{ fontSize: 11 }}>
                          Rk {row.seasonDistrictRank ?? '-'}
                        </div>
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.seasonRecordText}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.seasonRollups?.playedEventCount ?? 0} /{' '}
                        {row.seasonRollups?.upcomingEventCount ?? 0}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.districtPoints ?? '-'}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.seasonDistrictRank ?? '-'}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.seasonCountryRank ?? '-'}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.playedEvents?.length ?? 0}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.upcomingEvents?.length ?? 0}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            className="button"
                            onClick={() => onOpenTeamProfile(row.teamNumber)}
                          >
                            TEAM_PROFILE
                          </button>
                          <button
                            className="button"
                            onClick={() => onAddToCompare?.(row.teamNumber)}
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
        </DisclosureSection>
      ) : null}

      {showCaptainBoards || showThreatBoards ? (
        <DisclosureSection
          storageKey={`ui.pre_event.${mode}.boards`}
          title="Alliance Leaders + Watch Boards"
          description="Captain projections, specialty leaders, and threat groupings for the loaded event roster."
        >
          <div className="grid-2">
            {showCaptainBoards ? (
              <div className="panel" style={{ padding: 16 }}>
                <div style={{ fontWeight: 900, marginBottom: 10 }}>
                  Likely Captains / Alliance Leaders
                </div>
                <div className="stack-8">
                  {likelyCaptains.map((row, index) => (
                    <div key={row.teamKey} className="panel-2" style={{ padding: 10 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                          alignItems: 'center',
                        }}
                      >
                        <div style={{ fontWeight: 900 }}>
                          #{index + 1} {row.teamNumber} {row.nickname}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className="button"
                            onClick={() => onOpenTeamProfile(row.teamNumber)}
                          >
                            TEAM_PROFILE
                          </button>
                          <button
                            className="button"
                            onClick={() => onAddToCompare?.(row.teamNumber)}
                          >
                            COMPARE
                          </button>
                        </div>
                      </div>
                      <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                        Season EPA {fmt(row.seasonCurrentEpa, 1)} | Mean{' '}
                        {fmt(row.seasonMeanTotal, 1)} | World Rank {row.seasonWorldRank ?? '-'} |
                        Country % {pct(row.seasonCountryPercentile)}
                      </div>
                      <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                        District Pts {row.districtPoints ?? '-'} | District Rank{' '}
                        {row.seasonDistrictRank ?? '-'} | Country Rank{' '}
                        {row.seasonCountryRank ?? '-'} | 2026 Record {row.seasonRecordText}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div />
            )}

            {showThreatBoards ? (
              <div className="panel" style={{ padding: 16 }}>
                <div style={{ fontWeight: 900, marginBottom: 10 }}>Threat / Watchlist</div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 12,
                  }}
                >
                  {specialtyBoards.map((group) => (
                    <div key={group.label} className="panel-2" style={{ padding: 10 }}>
                      <div style={{ fontWeight: 900, marginBottom: 8 }}>{group.label}</div>
                      <div className="stack-8">
                        {group.rows.map((row, index) => (
                          <div key={`${group.label}_${row.teamKey}`} style={{ fontSize: 12 }}>
                            {index + 1}. {row.teamNumber} {row.nickname} - {fmt(row[group.key], 1)}
                          </div>
                        ))}
                        {!group.rows.length ? <div className="muted">No values yet.</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div />
            )}
          </div>
        </DisclosureSection>
      ) : null}

      {showRawSpecialtyBoards ? (
        <DisclosureSection
          storageKey={`ui.pre_event.${mode}.raw_specialty`}
          title="Raw Specialty Leaders"
          description="Raw 2026 breakdown leaderboards for deeper scouting review."
        >
          <div className="panel" style={{ padding: 16 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 12,
              }}
            >
              {rawSpecialtyBoards.map((group) => (
                <div key={group.key} className="panel-2" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>{group.label}</div>
                  <div className="stack-8">
                    {group.rows.map((row, index) => (
                      <div key={`${group.key}_${row.teamKey}`} style={{ fontSize: 12 }}>
                        {index + 1}. {row.teamNumber} {row.nickname} -{' '}
                        {fmt(seasonBreakdown(row.seasonSummary, group.key), 2)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {!rawSpecialtyBoards.length ? (
                <div className="muted">No raw 2026 specialty fields available yet.</div>
              ) : null}
            </div>
          </div>
        </DisclosureSection>
      ) : null}

      {showMatchupBoard ? (
        <DisclosureSection
          storageKey={`ui.pre_event.${mode}.matchup`}
          title="Our-Team Matchup Board"
          description="Qualification matchups for the loaded team with alliance-by-alliance context."
          defaultOpen={mode === 'strategy'}
        >
          <div className="panel" style={{ padding: 16 }}>
            {!loadedTeam ? (
              <div className="muted">Load a team to render the alliance matchup board.</div>
            ) : !matchupMatches.length ? (
              <div className="muted">No upcoming qualification matches found for our team.</div>
            ) : (
              <div className="stack-12">
                {matchupMatches.map((match) => {
                  const ourOnRed =
                    ourTeamKey != null && match?.alliances?.red?.team_keys?.includes(ourTeamKey);
                  return (
                    <div key={match.key} className="panel-2" style={{ padding: 12 }}>
                      <div style={{ fontWeight: 900, fontSize: 18 }}>{formatMatchLabel(match)}</div>
                      <div className="muted" style={{ marginTop: 6 }}>
                        Our color {ourOnRed ? 'red' : 'blue'} | Match Key {match.key}
                      </div>
                      <div className="grid-2" style={{ marginTop: 12 }}>
                        <div>
                          <div style={{ fontWeight: 900, marginBottom: 8 }}>Red Alliance</div>
                          {renderAllianceLine(match?.alliances?.red?.team_keys ?? [], ourTeamKey)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 900, marginBottom: 8 }}>Blue Alliance</div>
                          {renderAllianceLine(match?.alliances?.blue?.team_keys ?? [], ourTeamKey)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DisclosureSection>
      ) : null}

      {showWatchlist ? (
        <DisclosureSection
          storageKey={`ui.pre_event.${mode}.watchlist`}
          title="Key Matches Watchlist"
          description="The highest-priority watchlist matches for ranking, scouting, and alliance implications."
          defaultOpen={mode === 'event'}
        >
          <div className="panel" style={{ padding: 16 }}>
            <div className="stack-8" style={{ maxHeight: 720, overflow: 'auto' }}>
              {keyMatches.slice(0, 12).map((match) => renderKeyMatchCard(match))}
              {!keyMatches.length ? <div className="muted">No watchlist matches found.</div> : null}
            </div>
          </div>
        </DisclosureSection>
      ) : null}
    </div>
  );
}
