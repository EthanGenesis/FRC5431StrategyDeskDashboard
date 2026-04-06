/* @vitest-environment node */
import { describe, expect, it } from 'vitest';

import {
  buildDeskOpsDelayDiagnostics,
  buildDeskOpsImpactSummary,
  buildDeskOpsKeyMatchWatchRows,
  buildDeskOpsRivalPressureRows,
} from './desk-ops-insights';
import type { CompareTeamEventRow, MatchSimple } from './types';

describe('desk ops insights', () => {
  const eventRows: CompareTeamEventRow[] = [
    {
      teamKey: 'frc5431',
      teamNumber: 5431,
      nickname: 'Titan',
      rank: 6,
      compositeRank: 4,
      rpAverage: 2.25,
      totalRp: 18,
      overallEpa: 25,
      autoEpa: 8,
      teleopEpa: 11,
      endgameEpa: 6,
      opr: 22,
      copr: 21,
      dpr: 12,
      ccwm: 10,
      composite: 88,
      compositeRaw: 0.8,
      playedSos: 51,
      remainingSos: 49,
      totalSos: 51,
      districtPoints: null,
      district_points: null,
      eventStatus: null,
      record: '5-3-0',
      matchesPlayed: 8,
    },
    {
      teamKey: 'frc118',
      teamNumber: 118,
      nickname: 'Robonauts',
      rank: 5,
      compositeRank: 2,
      rpAverage: 2.5,
      totalRp: 20,
      overallEpa: 29,
      autoEpa: 9,
      teleopEpa: 12,
      endgameEpa: 8,
      opr: 25,
      copr: 24,
      dpr: 11,
      ccwm: 14,
      composite: 94,
      compositeRaw: 1.1,
      playedSos: 55,
      remainingSos: 54,
      totalSos: 55,
      districtPoints: null,
      district_points: null,
      eventStatus: null,
      record: '6-2-0',
      matchesPlayed: 8,
    },
    {
      teamKey: 'frc148',
      teamNumber: 148,
      nickname: 'Robowranglers',
      rank: 7,
      compositeRank: 6,
      rpAverage: 2.1,
      totalRp: 17,
      overallEpa: 24,
      autoEpa: 7,
      teleopEpa: 11,
      endgameEpa: 6,
      opr: 21,
      copr: 20,
      dpr: 12,
      ccwm: 9,
      composite: 84,
      compositeRaw: 0.6,
      playedSos: 52,
      remainingSos: 51,
      totalSos: 52,
      districtPoints: null,
      district_points: null,
      eventStatus: null,
      record: '4-4-0',
      matchesPlayed: 8,
    },
    {
      teamKey: 'frc9999',
      teamNumber: 9999,
      nickname: 'Far Away',
      rank: 18,
      compositeRank: 17,
      rpAverage: 1,
      totalRp: 8,
      overallEpa: 12,
      autoEpa: 3,
      teleopEpa: 6,
      endgameEpa: 3,
      opr: 10,
      copr: 8,
      dpr: 15,
      ccwm: -5,
      composite: 40,
      compositeRaw: -0.8,
      playedSos: 40,
      remainingSos: 38,
      totalSos: 40,
      districtPoints: null,
      district_points: null,
      eventStatus: null,
      record: '2-6-0',
      matchesPlayed: 8,
    },
  ];

  const matches: MatchSimple[] = [
    {
      key: '2026txcle_qm70',
      comp_level: 'qm',
      set_number: 1,
      match_number: 70,
      alliances: {
        red: { team_keys: ['frc5431', 'frc624', 'frc3847'] },
        blue: { team_keys: ['frc118', 'frc148', 'frc3310'] },
      },
      winning_alliance: '',
      time: 1_000,
      predicted_time: 2_000,
      actual_time: null,
      post_result_time: null,
      score_breakdown: null,
      videos: [],
    },
    {
      key: '2026txcle_qm71',
      comp_level: 'qm',
      set_number: 1,
      match_number: 71,
      alliances: {
        red: { team_keys: ['frc118', 'frc2468', 'frc5414'] },
        blue: { team_keys: ['frc148', 'frc1678', 'frc973'] },
      },
      winning_alliance: '',
      time: 3_000,
      predicted_time: 4_000,
      actual_time: null,
      post_result_time: null,
      score_breakdown: null,
      videos: [],
    },
  ];

  it('builds rival pressure rows around the loaded team', () => {
    const rows = buildDeskOpsRivalPressureRows(eventRows, 5431);

    expect(rows.map((row) => row.teamKey)).toContain('frc5431');
    expect(rows.map((row) => row.teamKey)).toContain('frc118');
    expect(rows.map((row) => row.teamKey)).not.toContain('frc9999');
    expect(rows[0]?.isLoadedTeam).toBe(true);
  });

  it('builds key watchlist matches with rival narratives', () => {
    const rivalPressure = buildDeskOpsRivalPressureRows(eventRows, 5431);
    const rows = buildDeskOpsKeyMatchWatchRows({
      matches: [...matches],
      sbMatches: [
        {
          key: '2026txcle_qm71',
          pred: {
            red_win_prob: 0.62,
            red_score: 148,
            blue_score: 132,
          },
        },
      ],
      rivalPressure,
      teamNumber: 5431,
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.rivalTeamKey === 'frc118')).toBe(true);
    expect(rows[0]?.narrative.length).toBeGreaterThan(0);
  });

  it('summarizes impact and timing diagnostics for the next match', () => {
    const impact = buildDeskOpsImpactSummary({
      eventRows,
      matches: [...matches],
      teamNumber: 5431,
    });
    const delay = buildDeskOpsDelayDiagnostics({
      matches: [...matches],
      teamNumber: 5431,
      preferredMatchKey: '2026txcle_qm70',
      loadedTeamOps: {
        teamNumber: 5431,
        pitAddress: null,
        inspectionStatus: null,
        currentMatchLabel: 'QM69',
        nextMatchLabel: 'QM70',
        queueState: 'QUEUE_2',
        allianceColor: 'red',
        bumperColor: 'red',
        queueMatchesAway: 1,
        partsRequestCount: 0,
        estimatedQueueTimeMs: 1_500,
        estimatedOnDeckTimeMs: 1_700,
        estimatedOnFieldTimeMs: 2_100,
        estimatedStartTimeMs: 2_700,
        actualQueueTimeMs: null,
        actualOnDeckTimeMs: null,
        actualOnFieldTimeMs: null,
        actualStartTimeMs: null,
      },
    });

    expect(impact?.selectedMatchLabel).toBe('QM70');
    expect(impact?.quickCalls.length).toBeGreaterThan(0);
    expect(delay?.fieldLagMinutes).toBe(0);
    expect(delay?.summary).toContain('close');
  });
});
