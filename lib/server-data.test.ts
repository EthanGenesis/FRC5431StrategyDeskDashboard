import { describe, expect, it } from 'vitest';

import {
  buildValidationSnapshot,
  comparableOfficialAwardCount,
  comparableOfficialMatchSummary,
} from './server-data';

describe('server-data validation normalization', () => {
  it('normalizes grouped FIRST awards and ignorable official match rows inside event-context validation', () => {
    const tbaAwards = [
      { award_type: 1, name: 'District Event Winner' },
      { award_type: 2, name: 'District Event Finalist' },
    ];
    const official = {
      status: 'available' as const,
      event: { name: 'Test Event', nameShort: 'Test Event', dateStart: '2026-03-30' },
      rankings: { Rankings: [{ rank: 1 }] },
      matches: [
        { tournamentLevel: 'Qualification', description: 'Qualification 1', matchNumber: 1 },
        {
          tournamentLevel: 'Playoff',
          description: 'Final Tiebreaker',
          matchNumber: 3,
          actualStartTime: null,
          scoreRedFinal: null,
          scoreBlueFinal: null,
        },
        { tournamentLevel: 'None', description: 'Test Match', matchNumber: 999 },
      ],
      awards: [
        { awardId: 609, name: 'District Event Winner', teamNumber: 1 },
        { awardId: 609, name: 'District Event Winner', teamNumber: 2 },
        { awardId: 611, name: 'District Event Finalist', teamNumber: 3 },
      ],
      district: null,
    };

    expect(comparableOfficialMatchSummary(official.matches)).toMatchObject({
      comparableCount: 1,
      ignoredCount: 2,
    });
    expect(comparableOfficialAwardCount(official.awards)).toBe(2);

    const validation = buildValidationSnapshot({
      eventKey: '2026test',
      tbaEvent: { name: 'Test Event' },
      tbaMatches: [{ key: 'qm1' }],
      tbaRankings: { rankings: [{ rank: 1 }] },
      tbaAwards,
      official,
      nexus: null,
      liveSignals: [],
    });

    const discrepancies = validation.discrepancies as Record<string, unknown>[];
    const matchCount = discrepancies.find((item) => item.key === 'match_count');
    const awardCount = discrepancies.find((item) => item.key === 'award_count');

    expect(matchCount).toMatchObject({
      status: 'match',
      workingValue: '1',
      officialValue: '1',
    });
    expect(matchCount?.detail).toEqual(expect.stringContaining('test/practice row'));
    expect(matchCount?.detail).toEqual(
      expect.stringContaining('unused playoff tiebreaker placeholder'),
    );
    expect(awardCount).toMatchObject({
      status: 'match',
      workingValue: '2',
      officialValue: '2',
    });
    expect(awardCount?.detail).toEqual(expect.stringContaining('one row per recipient'));
  });
});
