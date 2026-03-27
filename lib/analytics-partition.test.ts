import { buildHistoricalEventRows, partitionItemsByEventKey } from './analytics';

describe('analytics event partition helpers', () => {
  it('separates current-event and historical items using the loaded event key', () => {
    const items = [
      { eventKey: '2026txda', value: 1 },
      { eventKey: '2026txel', value: 2 },
      { event: '2026txda', value: 3 },
      { event: '2026okok', value: 4 },
    ];

    const result = partitionItemsByEventKey(items, '2026txda');

    expect(result.currentEventItems).toEqual([
      { eventKey: '2026txda', value: 1 },
      { event: '2026txda', value: 3 },
    ]);
    expect(result.historicalItems).toEqual([
      { eventKey: '2026txel', value: 2 },
      { event: '2026okok', value: 4 },
    ]);
  });

  it('filters the loaded event out of historical rows', () => {
    const played = [{ event: '2026txda' }, { event: '2026okok' }];
    const upcoming = [{ event: '2026txel' }, { event: '2026txda' }];

    expect(buildHistoricalEventRows(played, upcoming, '2026txda')).toEqual([
      { event: '2026okok' },
      { event: '2026txel' },
    ]);
  });
});
