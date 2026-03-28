import { describe, expect, it } from 'vitest';

import { buildAllianceCandidateInsights } from './alliance-insights';

describe('buildAllianceCandidateInsights', () => {
  it('prefers candidates that cover the current alliance weakness', () => {
    const eventRowMap = new Map([
      [
        'frc1',
        {
          teamKey: 'frc1',
          overallEpa: 20,
          autoEpa: 8,
          teleopEpa: 10,
          endgameEpa: 2,
          composite: 72,
        },
      ],
      [
        'frc10',
        {
          teamKey: 'frc10',
          teamNumber: 10,
          overallEpa: 22,
          autoEpa: 7,
          teleopEpa: 9,
          endgameEpa: 10,
          composite: 78,
        },
      ],
      [
        'frc11',
        {
          teamKey: 'frc11',
          teamNumber: 11,
          overallEpa: 22,
          autoEpa: 7,
          teleopEpa: 11,
          endgameEpa: 3,
          composite: 78,
        },
      ],
    ]);

    const rows = buildAllianceCandidateInsights({
      availableRows: [{ teamKey: 'frc10' }, { teamKey: 'frc11' }],
      captainSlots: [{ seed: 1, captain: 'frc1', picks: [] }],
      currentCaptainKey: 'frc1',
      eventRowMap,
    });

    const endgameCandidate = rows.find((row) => row.teamKey === 'frc10');
    const teleopCandidate = rows.find((row) => row.teamKey === 'frc11');

    expect(endgameCandidate?.weakestArea).toBe('endgame');
    expect((endgameCandidate?.chemistryScore ?? 0) > (teleopCandidate?.chemistryScore ?? 0)).toBe(
      true,
    );
  });

  it('identifies a rival captain for denial value', () => {
    const eventRowMap = new Map([
      [
        'frc1',
        {
          teamKey: 'frc1',
          overallEpa: 20,
          autoEpa: 8,
          teleopEpa: 10,
          endgameEpa: 2,
          composite: 72,
        },
      ],
      [
        'frc2',
        {
          teamKey: 'frc2',
          overallEpa: 24,
          autoEpa: 6,
          teleopEpa: 9,
          endgameEpa: 9,
          composite: 86,
        },
      ],
      [
        'frc30',
        {
          teamKey: 'frc30',
          teamNumber: 30,
          overallEpa: 23,
          autoEpa: 6,
          teleopEpa: 8,
          endgameEpa: 9,
          composite: 84,
        },
      ],
      [
        'frc31',
        {
          teamKey: 'frc31',
          teamNumber: 31,
          overallEpa: 21,
          autoEpa: 10,
          teleopEpa: 11,
          endgameEpa: 1,
          composite: 74,
        },
      ],
    ]);

    const rows = buildAllianceCandidateInsights({
      availableRows: [{ teamKey: 'frc30' }, { teamKey: 'frc31' }],
      captainSlots: [
        { seed: 1, captain: 'frc1', picks: [] },
        { seed: 2, captain: 'frc2', picks: [] },
      ],
      currentCaptainKey: 'frc1',
      eventRowMap,
    });

    const denialCandidate = rows.find((row) => row.teamKey === 'frc30');

    expect(denialCandidate?.rivalCaptain).toBe('frc2');
    expect(denialCandidate?.denialValueScore).toBeGreaterThanOrEqual(0);
  });

  it('separates high-ceiling picks from safer playoff-ready fits', () => {
    const eventRowMap = new Map([
      [
        'frc1',
        {
          teamKey: 'frc1',
          overallEpa: 20,
          autoEpa: 7,
          teleopEpa: 9,
          endgameEpa: 2,
          composite: 72,
          realRank: 1,
          matchesPlayed: 12,
          record: '10-2-0',
        },
      ],
      [
        'frc40',
        {
          teamKey: 'frc40',
          teamNumber: 40,
          overallEpa: 28,
          autoEpa: 8,
          teleopEpa: 15,
          endgameEpa: 5,
          composite: 70,
          opr: 30,
          realRank: 10,
          matchesPlayed: 4,
          record: '2-2-0',
        },
      ],
      [
        'frc41',
        {
          teamKey: 'frc41',
          teamNumber: 41,
          overallEpa: 24,
          autoEpa: 7,
          teleopEpa: 10,
          endgameEpa: 9,
          composite: 86,
          opr: 24,
          realRank: 2,
          matchesPlayed: 12,
          record: '10-2-0',
        },
      ],
    ]);

    const rows = buildAllianceCandidateInsights({
      availableRows: [{ teamKey: 'frc40' }, { teamKey: 'frc41' }],
      captainSlots: [{ seed: 1, captain: 'frc1', picks: [] }],
      currentCaptainKey: 'frc1',
      eventRowMap,
    });

    const ceilingCandidate = rows.find((row) => row.teamKey === 'frc40');
    const safeCandidate = rows.find((row) => row.teamKey === 'frc41');

    expect((ceilingCandidate?.ceilingScore ?? 0) > (safeCandidate?.ceilingScore ?? 0)).toBe(true);
    expect(
      (safeCandidate?.playoffReadyScore ?? 0) > (ceilingCandidate?.playoffReadyScore ?? 0),
    ).toBe(true);
    expect(ceilingCandidate?.bestUseCase).toBe('High ceiling');
    expect(safeCandidate?.bestUseCase).toBe('Safe playoff fit');
    expect(ceilingCandidate?.recommendationReason).toContain('Highest upside');
    expect(safeCandidate?.recommendationReason).toContain('playoff-ready');
  });
});
