/* @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { buildPitOpsResponse } from './pit-ops';
import type { AppSnapshot, PitTimelineMatchRow } from './types';

function createSnapshot(): AppSnapshot {
  return {
    generatedAtMs: 1_710_000_000_000,
    inputs: {
      eventKey: '2026txcle',
      team: 5431,
      teamKey: 'frc5431',
    },
    tba: {
      event: {
        key: '2026txcle',
        short_name: 'Clear Lake',
        name: 'Clear Lake District Event',
      },
      matches: [
        {
          key: '2026txcle_qm1',
          comp_level: 'qm',
          set_number: 1,
          match_number: 1,
          predicted_time: 1_710_000_600,
          time: 1_710_000_600,
          actual_time: 1_710_000_600,
          post_result_time: 1_710_000_660,
          alliances: {
            red: { team_keys: ['frc5431', 'frc148', 'frc118'], score: 120 },
            blue: { team_keys: ['frc1114', 'frc254', 'frc2056'], score: 110 },
          },
        },
        {
          key: '2026txcle_qm4',
          comp_level: 'qm',
          set_number: 1,
          match_number: 4,
          predicted_time: 1_710_003_000,
          time: 1_710_003_000,
          actual_time: null,
          post_result_time: null,
          alliances: {
            red: { team_keys: ['frc1678', 'frc111', 'frc16'], score: -1 },
            blue: { team_keys: ['frc5431', 'frc118', 'frc3310'], score: -1 },
          },
        },
        {
          key: '2026txcle_sf1m1',
          comp_level: 'sf',
          set_number: 1,
          match_number: 1,
          predicted_time: 1_710_007_200,
          time: 1_710_007_200,
          actual_time: null,
          post_result_time: null,
          alliances: {
            red: { team_keys: ['frc5431', 'frc118', 'frc3310'], score: -1 },
            blue: { team_keys: ['frc148', 'frc2056', 'frc254'], score: -1 },
          },
        },
      ],
      rankings: null,
      oprs: null,
      alliances: null,
      status: null,
      insights: null,
      awards: [],
      teams: [],
    },
    sb: {
      matches: [],
      teamEvents: [],
      teamMatches: [],
    },
    official: null,
    nexus: {
      supported: true,
      status: 'available',
      currentMatchKey: null,
      nextMatchKey: '2026txcle_qm4',
      queueMatchesAway: 2,
      queueText: 'QUEUE_2',
      pitMapUrl: null,
      pitsStatus: 'available',
      inspectionStatus: 'available',
      pitMapStatus: 'available',
      announcements: [],
      partsRequests: [],
      inspectionSummary: null,
      pits: [],
      matches: [],
      pitAddressByTeam: {},
      inspectionByTeam: {},
      loadedTeamOps: {
        teamNumber: 5431,
        pitAddress: 'A12',
        inspectionStatus: 'Ready',
        currentMatchLabel: null,
        nextMatchLabel: 'QM4',
        queueState: 'QUEUE_2',
        allianceColor: 'blue',
        bumperColor: 'BLUE',
        queueMatchesAway: 2,
        partsRequestCount: 0,
        estimatedQueueTimeMs: 1_710_002_400_000,
        estimatedOnDeckTimeMs: 1_710_002_700_000,
        estimatedOnFieldTimeMs: 1_710_002_880_000,
        estimatedStartTimeMs: 1_710_003_000_000,
        actualQueueTimeMs: null,
        actualOnDeckTimeMs: null,
        actualOnFieldTimeMs: null,
        actualStartTimeMs: null,
      },
      raw: {
        status: null,
        pits: [],
        pitMap: null,
        inspection: [],
        announcements: [],
        partsRequests: [],
      },
    },
    media: null,
    validation: null,
    liveSignals: [],
  } as AppSnapshot;
}

describe('buildPitOpsResponse', () => {
  it('builds turnaround rows and keeps playoff matches in the pit timeline', () => {
    const response = buildPitOpsResponse({
      workspaceKey: 'event:2026txcle',
      eventKey: '2026txcle',
      teamNumber: 5431,
      snapshot: createSnapshot(),
      nowMs: 1_710_001_800_000,
    });

    expect(response.eventName).toBe('Clear Lake');
    expect(response.queueState).toBe('QUEUE_2');
    expect(response.queueLadder.length).toBe(4);
    expect(response.pitAddress).toBe('A12');

    const turnaround = response.timeline.find((row) => row.kind === 'turnaround');
    expect(turnaround).toBeTruthy();
    if (turnaround?.kind !== 'turnaround') {
      throw new Error('Expected a turnaround row in the pit timeline.');
    }
    expect(turnaround.fromLabel).toBe('QM1');
    expect(turnaround.toLabel).toBe('QM4');

    const semifinalRow = response.timeline.find(
      (row): row is PitTimelineMatchRow => row.kind === 'match' && row.compLevel === 'sf',
    );
    expect(semifinalRow).toBeTruthy();
    expect(semifinalRow?.isLoadedTeamMatch).toBe(true);
    expect(semifinalRow?.label).toContain('Semifinal');
    expect(response.countdownMs).not.toBeNull();
  });
});
