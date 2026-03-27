import { describe, expect, it } from 'vitest';

import { districtStatusFromBounds } from './fit-district';

describe('districtStatusFromBounds', () => {
  it('marks official advancement as AUTO', () => {
    const status = districtStatusFromBounds({
      teamKey: 'frc1',
      slotCount: 2,
      floorsByTeam: new Map([
        ['frc1', 100],
        ['frc2', 90],
      ]),
      ceilingsByTeam: new Map([
        ['frc1', 100],
        ['frc2', 90],
      ]),
      automatic: true,
    });

    expect(status).toBe('AUTO');
  });

  it('only marks LOCKED when too few teams can still reach the floor', () => {
    const status = districtStatusFromBounds({
      teamKey: 'frc1',
      slotCount: 2,
      floorsByTeam: new Map([
        ['frc1', 149],
        ['frc2', 80],
        ['frc3', 70],
      ]),
      ceilingsByTeam: new Map([
        ['frc1', 149],
        ['frc2', 100],
        ['frc3', 90],
      ]),
    });

    expect(status).toBe('LOCKED');
  });

  it('only marks ELIMINATED when enough teams are already guaranteed above the ceiling', () => {
    const status = districtStatusFromBounds({
      teamKey: 'frc1',
      slotCount: 2,
      floorsByTeam: new Map([
        ['frc1', 21],
        ['frc2', 90],
        ['frc3', 91],
      ]),
      ceilingsByTeam: new Map([
        ['frc1', 53],
        ['frc2', 120],
        ['frc3', 130],
      ]),
    });

    expect(status).toBe('ELIMINATED');
  });

  it('keeps the status at BUBBLE when a live ceiling path still exists', () => {
    const status = districtStatusFromBounds({
      teamKey: 'frc5431',
      slotCount: 3,
      floorsByTeam: new Map([
        ['frc5431', 21],
        ['frc148', 135],
        ['frc118', 129],
        ['frc624', 123],
        ['frc3005', 61],
      ]),
      ceilingsByTeam: new Map([
        ['frc5431', 333],
        ['frc148', 369],
        ['frc118', 363],
        ['frc624', 357],
        ['frc3005', 333],
      ]),
    });

    expect(status).toBe('BUBBLE');
  });
});
