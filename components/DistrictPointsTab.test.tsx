import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import DistrictPointsTab from './DistrictPointsTab';
import { fetchJsonOrThrow } from '../lib/httpCache';
import type { DistrictEventProjection, DistrictSnapshotResponse } from '../lib/types';

vi.mock('../lib/httpCache', () => ({
  fetchJsonOrThrow: vi.fn(),
}));

const snapshotPayload: DistrictSnapshotResponse = {
  generatedAtMs: 1,
  applicable: true,
  reason: null,
  districtKey: '2026fit',
  districtName: 'FIRST in Texas',
  loadedEventKey: '2026txfar',
  loadedTeam: 5431,
  loadedEventIsFitDistrict: true,
  advancementCounts: { dcmp: 90, cmp: 28 },
  standings: [],
  loadedTeamStanding: null,
  advancement: {},
  season: {
    currentDcmpLinePoints: 53,
    currentWorldsLinePoints: 137,
    pointsRemainingDistrictCeiling: 1000,
    remainingTopTierAwards: {
      impact: 1,
      engineeringInspiration: 1,
      rookieAllStar: 1,
    },
    events: [],
  },
  loadedTeamSeason: {
    rookieBonus: 0,
    currentOfficialTotal: 21,
    totalExcludingLoadedEvent: 21,
    currentRank: 114,
    officialDcmpQualified: false,
    officialCmpQualified: false,
  },
  currentEvent: {
    event: null,
    teamCount: 32,
    districtCmp: false,
    eventRows: [],
    officialRows: [],
    awardedOfficialPoints: 0,
    awardedPerformancePoints: 0,
    remainingPerformanceCeiling: 798,
    remainingTopTierAwardPoints: 26,
    remainingTopTierAwards: {
      impact: 1,
      engineeringInspiration: 1,
      rookieAllStar: 1,
    },
  },
};

const eventProjectionPayload: DistrictEventProjection = {
  generatedAtMs: 1,
  mode: 'event',
  runs: 100,
  rows: [],
  loadedTeamHistogram: [],
  loadedTeamSummary: null,
};

describe('DistrictPointsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchJsonOrThrow)
      .mockResolvedValueOnce(snapshotPayload)
      .mockResolvedValueOnce(eventProjectionPayload);
  });

  it('allows manually toggling the DCMP x3 multiplier in the calculator', async () => {
    render(<DistrictPointsTab scope="current" loadedEventKey="2026txfar" loadedTeam={5431} />);

    const checkbox = await screen.findByRole('checkbox', { name: /DCMP x3 multiplier/i });
    await waitFor(() => expect(checkbox).not.toBeDisabled());

    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});
