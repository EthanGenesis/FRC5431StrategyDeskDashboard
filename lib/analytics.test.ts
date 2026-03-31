import { describe, expect, it } from 'vitest';

import type { MatchSimple } from './types';
import { normalizeEventMatches } from './analytics';

function buildMatch(scoreBreakdown: Record<string, unknown> | null = null): MatchSimple {
  return {
    key: '2026txcle_qm1',
    comp_level: 'qm',
    set_number: 1,
    match_number: 1,
    alliances: {
      red: {
        team_keys: ['frc5431', 'frc111', 'frc222'],
        score: 120,
      },
      blue: {
        team_keys: ['frc333', 'frc444', 'frc555'],
        score: 98,
      },
    },
    winning_alliance: 'red',
    time: 1_710_000_000,
    predicted_time: 1_710_000_000,
    actual_time: 1_710_000_120,
    post_result_time: 1_710_000_180,
    score_breakdown: scoreBreakdown,
  };
}

describe('normalizeEventMatches', () => {
  it('falls back to Statbotics result breakdown when EPA breakdown is missing', () => {
    const rows = normalizeEventMatches(
      [buildMatch()],
      [
        {
          key: '2026txcle_qm1',
          result: {
            red_auto_points: 25,
            red_teleop_points: 61,
            red_endgame_points: 14,
            red_no_foul: 100,
          },
        },
      ],
      'frc5431',
    );

    expect(rows[0]?.epaTotal).toBe(100);
    expect(rows[0]?.breakdown).toEqual({
      auto_points: 25,
      teleop_points: 61,
      endgame_points: 14,
    });
  });

  it('falls back to TBA score breakdown when Statbotics result data is unavailable', () => {
    const rows = normalizeEventMatches(
      [
        buildMatch({
          red: {
            totalAutoPoints: 20,
            totalTeleopPoints: 66,
            hubScore: {
              endgamePoints: 18,
            },
            endGameTowerPoints: 8,
          },
        }),
      ],
      [{ key: '2026txcle_qm1' }],
      'frc5431',
    );

    expect(rows[0]?.epaTotal).toBe(86);
    expect(rows[0]?.breakdown).toEqual({
      auto_points: 20,
      teleop_points: 40,
      endgame_points: 26,
    });
  });
});
