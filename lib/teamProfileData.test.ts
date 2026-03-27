import { buildSeasonRollups, splitSeasonEvents } from './teamProfileData';

describe('team profile data helpers', () => {
  it('splits 2026 events into played and upcoming buckets', () => {
    const rows = [
      { event: '2026txda', year: 2026, status: 'complete', time: 20 },
      { event: '2026txel', year: 2026, status: 'upcoming', time: 30 },
      { event: '2025miket', year: 2025, status: 'complete', time: 10 },
      { event: '2026okok', year: 2026, status: 'in_progress', time: 25 },
    ];

    const result = splitSeasonEvents(rows);

    expect(result.seasonRows.map((row) => row.event)).toEqual(['2026txda', '2026okok', '2026txel']);
    expect(result.playedEvents.map((row) => row.event)).toEqual(['2026okok', '2026txda']);
    expect(result.upcomingEvents.map((row) => row.event)).toEqual(['2026txel']);
    expect(result.teamEventsByKey['2026txda']).toMatchObject({
      event: '2026txda',
    });
  });

  it('builds season rollups from played events and played matches only', () => {
    const playedEvents = [
      {
        record: {
          qual: { count: 10, wins: 8, losses: 2, ties: 0 },
          elim: { count: 4, wins: 3, losses: 1, ties: 0 },
        },
        epa: { norm: 84.2 },
      },
    ];
    const upcomingEvents = [{ event: '2026future' }];
    const matches = [
      {
        played: true,
        epaTotal: 82,
        breakdown: { auto_points: 18, teleop_points: 42, endgame_points: 22 },
      },
      {
        played: false,
        epaTotal: 999,
        breakdown: {
          auto_points: 999,
          teleop_points: 999,
          endgame_points: 999,
        },
      },
      {
        played: true,
        epaTotal: 86,
        breakdown: { auto_points: 20, teleop_points: 44, endgame_points: 24 },
      },
    ];

    const rollups = buildSeasonRollups(playedEvents, upcomingEvents, matches);

    expect(rollups.playedEventCount).toBe(1);
    expect(rollups.upcomingEventCount).toBe(1);
    expect(rollups.totalMatchCount).toBe(14);
    expect(rollups.wins).toBe(11);
    expect(rollups.losses).toBe(3);
    expect(rollups.avgEventEpa).toBe(84.2);
    expect(rollups.avgMatchEpa).toBe(84);
    expect(rollups.avgAutoPoints).toBe(19);
    expect(rollups.avgTeleopPoints).toBe(43);
    expect(rollups.avgEndgamePoints).toBe(23);
  });
});
