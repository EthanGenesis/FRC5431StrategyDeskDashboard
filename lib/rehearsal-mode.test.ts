/* @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { applyRehearsalMode, DEFAULT_REHEARSAL_MODE_CONFIG } from './rehearsal-mode';
import type { AppSnapshot } from './types';

function createSnapshot(): AppSnapshot {
  return {
    generatedAtMs: 1_710_000_000_000,
    inputs: {
      eventKey: '2026txcle',
      team: 5431,
      teamKey: 'frc5431',
    },
    tba: {
      event: { key: '2026txcle' },
      matches: [
        {
          key: '2026txcle_qm1',
          comp_level: 'qm',
          set_number: 1,
          match_number: 1,
          predicted_time: 1_710_000_600,
          time: 1_710_000_600,
          actual_time: null,
          post_result_time: null,
          alliances: {
            red: { team_keys: ['frc5431', 'frc148', 'frc118'], score: -1 },
            blue: { team_keys: ['frc1114', 'frc254', 'frc2056'], score: -1 },
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
    nexus: null,
    media: null,
    validation: null,
    liveSignals: [],
  } as AppSnapshot;
}

describe('applyRehearsalMode', () => {
  it('creates a session-local rehearsal snapshot without mutating live data', () => {
    const liveSnapshot = createSnapshot();

    const rehearsalSnapshot = applyRehearsalMode(liveSnapshot, 5431, {
      ...DEFAULT_REHEARSAL_MODE_CONFIG,
      active: true,
      currentMatchKey: '2026txcle_qm4',
      queueState: 'QUEUE_1',
      minutesToMatch: 11,
      bumperColor: 'BLUE',
      allianceColor: 'blue',
      pitAddress: 'Pit A12',
      inspectionStatus: 'Ready',
      signalTitle: 'Bring bumpers',
      signalBody: 'Blue bumpers needed now.',
    });

    expect(rehearsalSnapshot).not.toBe(liveSnapshot);
    expect(rehearsalSnapshot?.nexus?.queueText).toBe('QUEUE_1');
    expect(rehearsalSnapshot?.nexus?.loadedTeamOps?.pitAddress).toBe('Pit A12');
    expect(rehearsalSnapshot?.nexus?.loadedTeamOps?.bumperColor).toBe('BLUE');
    expect(rehearsalSnapshot?.liveSignals?.[0]?.title).toBe('Bring bumpers');

    expect(liveSnapshot.nexus).toBeNull();
    expect(liveSnapshot.liveSignals).toEqual([]);
  });
});
