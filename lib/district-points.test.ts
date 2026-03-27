import { describe, expect, it } from 'vitest';

import {
  bestTwoRegularEventTotal,
  calculateDistrictPointsBreakdown,
  districtAlliancePointsForRole,
  districtAwardPoints,
  districtPlayoffPoints,
  districtQualificationPoints,
  rookieBonusPoints,
} from './district-points';

describe('district-points', () => {
  it('uses the official qualification range', () => {
    expect(districtQualificationPoints(1, 40)).toBe(22);
    expect(districtQualificationPoints(40, 40)).toBe(4);
  });

  it('maps alliance roles to the expected district points', () => {
    expect(districtAlliancePointsForRole('captain', 5)).toBe(12);
    expect(districtAlliancePointsForRole('first_pick', 5)).toBe(12);
    expect(districtAlliancePointsForRole('second_pick', 5)).toBe(5);
    expect(districtAlliancePointsForRole('unpicked', 5)).toBe(0);
  });

  it('applies double-elimination playoff values and finals wins', () => {
    expect(districtPlayoffPoints('winner', 2)).toBe(30);
    expect(districtPlayoffPoints('finalist', 1)).toBe(25);
    expect(districtPlayoffPoints('third')).toBe(13);
    expect(districtPlayoffPoints('fourth')).toBe(7);
  });

  it('maps award points and rookie bonuses', () => {
    expect(districtAwardPoints(['impact', 'quality'])).toBe(15);
    expect(rookieBonusPoints(2026)).toBe(10);
    expect(rookieBonusPoints(2025)).toBe(5);
    expect(rookieBonusPoints(2024)).toBe(0);
  });

  it('applies DCMP multiplier to season contribution only', () => {
    const breakdown = calculateDistrictPointsBreakdown({
      qualificationRank: 14,
      teamCount: 40,
      allianceRole: 'first_pick',
      allianceNumber: 5,
      playoffFinish: 'winner',
      finalsWins: 2,
      awardKeys: ['quality'],
      rookieBonusPoints: 0,
      dcmpMultiplier: true,
    });

    expect(breakdown.eventPoints).toBe(
      breakdown.qualPoints +
        breakdown.alliancePoints +
        breakdown.elimPoints +
        breakdown.awardPoints,
    );
    expect(breakdown.seasonContribution).toBe(breakdown.eventPoints * 3);
  });

  it('keeps only the best two regular events', () => {
    expect(bestTwoRegularEventTotal([20, 45, 37, 10])).toBe(82);
  });
});
