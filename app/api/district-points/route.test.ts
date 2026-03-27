/* @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/fit-district', () => ({
  loadFitDistrictSnapshot: vi.fn(() =>
    Promise.resolve({
      generatedAtMs: 1,
      applicable: false,
      reason: 'District points are only available for FIT district events in this view.',
      districtKey: '2026fit',
      districtName: 'FIRST in Texas',
      loadedEventKey: '2026test',
      loadedTeam: 5431,
      loadedEventIsFitDistrict: false,
      advancementCounts: { dcmp: 90, cmp: 28 },
      standings: [],
      loadedTeamStanding: null,
      advancement: {},
      season: {
        currentDcmpLinePoints: null,
        currentWorldsLinePoints: null,
        pointsRemainingDistrictCeiling: 0,
        remainingTopTierAwards: { impact: 0, engineeringInspiration: 0, rookieAllStar: 0 },
        events: [],
      },
      loadedTeamSeason: null,
      currentEvent: null,
    }),
  ),
}));

import { GET } from './route';

describe('/api/district-points', () => {
  it('returns the FIT snapshot payload', async () => {
    const response = await GET(
      new Request('http://localhost/api/district-points?eventKey=2026test&team=5431'),
    );
    const body = (await response.json()) as { applicable: boolean; districtKey: string };

    expect(response.status).toBe(200);
    expect(body.applicable).toBe(false);
    expect(body.districtKey).toBe('2026fit');
  });
});
