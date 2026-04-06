/* @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { buildTeamDossier } from './team-dossier';

describe('buildTeamDossier', () => {
  it('includes previous-event summary and recent trend flags', () => {
    const dossier = buildTeamDossier({
      generatedAtMs: 1,
      team: 5431,
      summary: null,
      seasonSummary: {
        epa: {
          norm: 22,
          total_points: { mean: 24 },
          breakdown: { auto_points: 7, teleop_points: 10, endgame_points: 7 },
        },
        record: { qual: { rank: 14, winrate: 0.5 } },
      },
      seasonRollups: null,
      playedEvents: [],
      upcomingEvents: [],
      teamEventsByKey: {},
      matches: [],
      loadedEventKey: '2026txcle',
      seasonEvents: [],
      currentEvent: {
        eventKey: '2026txcle',
        event: null,
        fieldAverages: { auto: 6, teleop: 8, endgame: 5, overall: 20 },
        eventRow: {
          overallEpa: 28,
          autoEpa: 9,
          teleopEpa: 12,
          endgameEpa: 7,
          rank: 6,
          record: { qual: { winrate: 0.7 } },
        },
        eventMatches: [
          { matchLabel: 'QM1', rp: 4, margin: 12 },
          { matchLabel: 'QM2', rp: 2, margin: 4 },
        ],
        eventStatusHtml: null,
        eventStatusText: null,
        derived: null,
      },
      historical2026: {
        seasonEvents: [],
        playedEvents: [
          {
            event: '2026txfor',
            event_name: 'Forney',
            record: { qual: { rank: 9 } },
          },
        ],
        upcomingEvents: [],
        matches: [
          {
            key: '2026txfor_qm1',
            eventKey: '2026txfor',
            eventName: 'Forney',
            matchLabel: 'QM1',
            compLevel: 'qm',
            time: 1_000,
            played: true,
            elim: false,
            alliance: 'red',
            partners: [],
            opponents: [],
            result: 'win',
            myScore: 150,
            oppScore: 120,
            margin: 30,
            redScore: 150,
            blueScore: 120,
            winningAlliance: 'red',
            epaTotal: 26,
            epaPost: 27,
            breakdown: null,
            week: 1,
            status: 'completed',
            dq: false,
            surrogate: false,
            sb: null,
            tba: null,
          },
          {
            key: '2026txfor_qm2',
            eventKey: '2026txfor',
            eventName: 'Forney',
            matchLabel: 'QM2',
            compLevel: 'qm',
            time: 2_000,
            played: true,
            elim: false,
            alliance: 'blue',
            partners: [],
            opponents: [],
            result: 'loss',
            myScore: 90,
            oppScore: 100,
            margin: -10,
            redScore: 100,
            blueScore: 90,
            winningAlliance: 'red',
            epaTotal: 20,
            epaPost: 20,
            breakdown: null,
            week: 1,
            status: 'completed',
            dq: false,
            surrogate: false,
            sb: null,
            tba: null,
          },
        ],
      },
    });

    expect(dossier.previousEventSummary?.eventKey).toBe('2026txfor');
    expect(dossier.previousEventSummary?.eventName).toBe('Forney');
    expect(dossier.recentTrendFlags.length).toBeGreaterThan(0);
    expect(dossier.recentEvents[0]?.eventKey).toBe('2026txfor');
    expect(dossier.recentEventTrend[0]?.label).toBe('Forney');
  });
});
