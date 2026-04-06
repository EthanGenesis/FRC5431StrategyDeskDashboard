/* @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { buildPickListAnalysis } from './decision-support';

describe('buildPickListAnalysis', () => {
  it('adds watchlist rows and specialty tags', () => {
    const response = buildPickListAnalysis({
      workspaceKey: 'event:2026txcle',
      eventKey: '2026txcle',
      teamNumber: 5431,
      activePickListId: 'pick_1',
      bundle: {
        generatedAtMs: 1,
        pickDeskRuntime: {} as never,
        candidateInsights: [
          {
            teamKey: 'frc118',
            teamNumber: 118,
            nickname: 'Robonauts',
            realRank: 2,
            overallEpa: 31,
            autoEpa: 12,
            teleopEpa: 10,
            endgameEpa: 9,
            opr: 28,
            composite: 96,
            chemistryScore: 85,
            coverageScore: 82,
            ceilingScore: 91,
            stabilityScore: 80,
            playoffReadyScore: 88,
            pickValueScore: 95,
            denialValueScore: 84,
            weakestArea: 'auto',
            rivalCaptain: 'frc148',
            bestUseCase: 'High ceiling',
            recommendationReason: 'Highest upside if we want more raw elimination power.',
            recommendation: 'Build us',
            record: '6-2-0',
            totalSos: 52,
          },
          {
            teamKey: 'frc148',
            teamNumber: 148,
            nickname: 'Robowranglers',
            realRank: 7,
            overallEpa: 27,
            autoEpa: 7,
            teleopEpa: 14,
            endgameEpa: 6,
            opr: 23,
            composite: 88,
            chemistryScore: 78,
            coverageScore: 79,
            ceilingScore: 74,
            stabilityScore: 72,
            playoffReadyScore: 76,
            pickValueScore: 82,
            denialValueScore: 92,
            weakestArea: 'teleop',
            rivalCaptain: 'frc118',
            bestUseCase: 'Rival denial',
            recommendationReason: 'Most dangerous if left for frc118.',
            recommendation: 'Deny rival',
            record: '5-3-0',
            totalSos: 50,
          },
        ],
        recommendationRows: [],
      },
      pickLists: [
        {
          id: 'pick_1',
          name: 'Main Board',
          createdAt: 1,
          first: [{ teamKey: 'frc118', comment: 'Top target' }],
          second: [{ teamKey: 'frc148' }],
          avoid: [],
        },
      ],
    });

    expect(response.bestByRole[0]?.tags.length).toBeGreaterThan(0);
    expect(response.likelyFirstPicks[0]?.teamKey).toBe('frc118');
    expect(response.captainThreats.map((row) => row.teamKey)).toContain('frc148');
    expect(response.captainThreats[0]?.tags).toContain('Captain band');
    expect(response.bucketBoards.find((row) => row.key === 'first')?.rows[0]?.teamKey).toBe(
      'frc118',
    );
    expect(response.decisionLogEntries[0]?.comment).toBe('Top target');
  });
});
