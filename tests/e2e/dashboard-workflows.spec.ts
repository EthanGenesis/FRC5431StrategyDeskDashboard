import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const EVENT_KEY = '2026test';
const TEAM_NUMBERS = [5431, 111, 222, 333, 444, 555];

function buildTeam(teamNumber: number) {
  return {
    team_number: teamNumber,
    key: `frc${teamNumber}`,
    nickname: `Team ${teamNumber}`,
    name: `Team ${teamNumber}`,
  };
}

function buildRanking(teamNumber: number, rank: number) {
  return {
    team_key: `frc${teamNumber}`,
    rank,
    matches_played: 1,
    sort_orders: [2 - rank * 0.1],
    record: {
      wins: rank === 1 ? 1 : 0,
      losses: rank === 1 ? 0 : 1,
      ties: 0,
    },
  };
}

function buildSbTeamEvent(teamNumber: number, rank: number) {
  return {
    team_number: teamNumber,
    epa: {
      norm: 24 - rank,
      total_points: {
        mean: 24 - rank,
      },
      breakdown: {
        auto_points: 8 - rank * 0.2,
        teleop_points: 11 - rank * 0.1,
        endgame_points: 5 - rank * 0.1,
      },
      ranks: {
        total: { rank, team_count: 60, percentile: 0.95 - rank * 0.02 },
        country: { rank, team_count: 60, percentile: 0.95 - rank * 0.02 },
        district: { rank, team_count: 30, percentile: 0.9 - rank * 0.02 },
      },
      stats: {
        pre_champs: 23 - rank,
        max: 27 - rank,
      },
    },
    record: {
      wins: rank === 1 ? 9 : 7,
      losses: rank === 1 ? 1 : 3,
      ties: 0,
      winrate: rank === 1 ? 0.9 : 0.7,
    },
    district_points: 40 - rank,
    district_rank: rank,
  };
}

function buildCompareRow(teamNumber: number, rank: number) {
  const teamKey = `frc${teamNumber}`;
  return {
    teamNumber,
    teamKey,
    nickname: `Team ${teamNumber}`,
    seasonSummary: buildSbTeamEvent(teamNumber, rank),
    seasonRollups: {
      winRate: rank === 1 ? 0.9 : 0.7,
      totalMatchCount: 10,
      qualMatchCount: 8,
      playoffMatchCount: 2,
      wins: rank === 1 ? 9 : 7,
      losses: rank === 1 ? 1 : 3,
      ties: 0,
      playedEventCount: 1,
      upcomingEventCount: 1,
    },
    seasonEvents: [
      {
        event: '2026other',
        event_name: 'Other Regional',
        epa: { norm: 23 - rank },
        district_points: 35 - rank,
        record: { qual: { rank, wins: 7 } },
      },
    ],
    playedEvents: [{ event: '2026other', event_name: 'Other Regional' }],
    upcomingEvents: [{ event: '2026next', event_name: 'Next Regional' }],
    seasonMatches: [
      {
        key: '2026other_qm1',
        matchLabel: 'QM1',
        epaTotal: 23 - rank,
        margin: 12 - rank,
        breakdown: {
          auto_points: 8 - rank * 0.2,
          teleop_points: 11 - rank * 0.1,
          endgame_points: 5 - rank * 0.1,
        },
      },
    ],
    historicalSeasonEvents: [
      {
        event: '2026other',
        event_name: 'Other Regional',
        epa: { norm: 23 - rank },
        district_points: 35 - rank,
        record: { qual: { rank, wins: 7 } },
      },
    ],
    historicalPlayedEvents: [{ event: '2026other', event_name: 'Other Regional' }],
    historicalUpcomingEvents: [{ event: '2026next', event_name: 'Next Regional' }],
    historicalMatches: [
      {
        key: '2026other_qm1',
        eventKey: '2026other',
        eventName: 'Other Regional',
        matchLabel: 'QM1',
        compLevel: 'qm',
        time: 1_710_000_000,
        played: true,
        elim: false,
        alliance: rank <= 3 ? 'red' : 'blue',
        partners: rank <= 3 ? ['frc111', 'frc222'] : ['frc333', 'frc444'],
        opponents: rank <= 3 ? ['frc333', 'frc444', 'frc555'] : ['frc5431', 'frc111', 'frc222'],
        result: rank === 1 ? 'win' : 'loss',
        myScore: 120,
        oppScore: 100,
        margin: 20,
        redScore: 120,
        blueScore: 100,
        winningAlliance: 'red',
        epaTotal: 23 - rank,
        epaPost: 22 - rank,
        breakdown: {
          auto_points: 8 - rank * 0.2,
          teleop_points: 11 - rank * 0.1,
          endgame_points: 5 - rank * 0.1,
        },
        week: 1,
        status: 'played',
        dq: false,
        surrogate: false,
        sb: {},
        tba: {},
      },
    ],
    eventRow: {
      teamKey,
      teamNumber,
      nickname: `Team ${teamNumber}`,
      rank,
      compositeRank: rank,
      matchesPlayed: 1,
      rpAverage: 2 - rank * 0.1,
      totalRp: 2 - rank * 0.1,
      overallEpa: 24 - rank,
      autoEpa: 8 - rank * 0.2,
      teleopEpa: 11 - rank * 0.1,
      endgameEpa: 5 - rank * 0.1,
      opr: 25 - rank,
      copr: 24 - rank,
      dpr: 18 - rank,
      ccwm: 6 - rank * 0.1,
      record: rank === 1 ? '1-0-0' : '0-1-0',
      composite: 90 - rank,
      compositeRaw: 1.2 - rank * 0.1,
      playedSos: 0.4,
      remainingSos: 0.2,
      totalSos: 0.3,
      eventStatus: {},
    },
    eventMatches: [
      {
        key: `${EVENT_KEY}_qm1`,
        eventKey: EVENT_KEY,
        matchLabel: 'QM1',
        compLevel: 'qm',
        time: 1_710_000_000,
        played: true,
        elim: false,
        alliance: rank <= 3 ? 'red' : 'blue',
        partners: rank <= 3 ? ['frc111', 'frc222'] : ['frc333', 'frc444'],
        opponents: rank <= 3 ? ['frc333', 'frc444', 'frc555'] : ['frc5431', 'frc111', 'frc222'],
        result: rank === 1 ? 'win' : 'loss',
        myScore: 120,
        oppScore: 100,
        margin: 20,
        redScore: 120,
        blueScore: 100,
        winningAlliance: 'red',
        epaTotal: 24 - rank,
        epaPost: 23 - rank,
        breakdown: {
          auto_points: 8 - rank * 0.2,
          teleop_points: 11 - rank * 0.1,
          endgame_points: 5 - rank * 0.1,
        },
        rp: 2 - rank * 0.1,
        rollingOpr: 25 - rank,
        rollingCopr: 24 - rank,
        rollingDpr: 18 - rank,
        rollingCcwm: 6 - rank * 0.1,
      },
    ],
    derived: {
      eventRank: rank,
      eventEpa: 24 - rank,
      seasonCurrentEpa: 24 - rank,
    },
  };
}

function buildSnapshotPayload() {
  const match = {
    key: `${EVENT_KEY}_qm1`,
    event_key: EVENT_KEY,
    comp_level: 'qm',
    set_number: 1,
    match_number: 1,
    alliances: {
      red: {
        team_keys: ['frc5431', 'frc111', 'frc222'],
        score: 120,
      },
      blue: {
        team_keys: ['frc333', 'frc444', 'frc555'],
        score: 100,
      },
    },
    winning_alliance: 'red',
    time: 1_710_000_000,
    predicted_time: 1_710_000_000,
    actual_time: 1_710_000_100,
    post_result_time: 1_710_000_120,
    score_breakdown: null,
  };

  return {
    generatedAtMs: 1_710_000_000_000,
    inputs: {
      eventKey: EVENT_KEY,
      team: 5431,
      teamKey: 'frc5431',
    },
    tba: {
      event: { key: EVENT_KEY, name: 'Test Regional', week: 1 },
      matches: [match],
      rankings: {
        sort_order_info: [{ name: 'RP' }],
        rankings: TEAM_NUMBERS.map((teamNumber, index) => buildRanking(teamNumber, index + 1)),
      },
      oprs: {
        oprs: Object.fromEntries(
          TEAM_NUMBERS.map((teamNumber, index) => [`frc${teamNumber}`, 25 - index]),
        ),
        coprs: Object.fromEntries(
          TEAM_NUMBERS.map((teamNumber, index) => [`frc${teamNumber}`, 24 - index]),
        ),
        dprs: Object.fromEntries(
          TEAM_NUMBERS.map((teamNumber, index) => [`frc${teamNumber}`, 18 - index]),
        ),
        ccwms: Object.fromEntries(
          TEAM_NUMBERS.map((teamNumber, index) => [`frc${teamNumber}`, 6 - index * 0.1]),
        ),
      },
      alliances: null,
      status: null,
      insights: null,
      awards: [],
      teams: TEAM_NUMBERS.map(buildTeam),
      teamStatuses: {},
    },
    sb: {
      matches: [
        {
          match: `${EVENT_KEY}_qm1`,
          epa: {
            total_points: 24,
            post: 23,
            breakdown: {
              auto_points: 8,
              teleop_points: 11,
              endgame_points: 5,
            },
          },
          pred: {
            red_score: 118,
            blue_score: 103,
          },
        },
      ],
      teamEvents: TEAM_NUMBERS.map((teamNumber, index) => buildSbTeamEvent(teamNumber, index + 1)),
      teamMatches: [],
    },
  };
}

function buildTeamProfilePayload(teamNumber: number) {
  const compareRow = buildCompareRow(teamNumber, 1);

  return {
    generatedAtMs: 1_710_000_000_000,
    team: teamNumber,
    summary: {
      name: `Team ${teamNumber}`,
      norm_epa: {
        current: 24,
        recent: 23,
        mean: 22,
        max: 27,
      },
      record: {
        wins: 9,
        losses: 1,
        ties: 0,
      },
    },
    seasonSummary: compareRow.seasonSummary,
    seasonRollups: compareRow.seasonRollups,
    playedEvents: compareRow.playedEvents,
    upcomingEvents: compareRow.upcomingEvents,
    teamEventsByKey: {
      [EVENT_KEY]: {
        event_name: 'Test Regional',
      },
      '2026other': {
        event_name: 'Other Regional',
      },
    },
    matches: compareRow.eventMatches,
    loadedEventKey: EVENT_KEY,
    seasonEvents: compareRow.seasonEvents,
    currentEvent: {
      eventKey: EVENT_KEY,
      event: { key: EVENT_KEY, name: 'Test Regional' },
      fieldAverages: { eventEpa: 22, eventOpr: 23, eventComposite: 85 },
      eventRow: compareRow.eventRow,
      eventMatches: compareRow.eventMatches,
      eventStatusHtml: '<strong>Ready</strong> for strategy review.',
      eventStatusText: 'Ready for strategy review.',
      derived: compareRow.derived,
    },
    historical2026: {
      seasonEvents: compareRow.historicalSeasonEvents,
      playedEvents: compareRow.historicalPlayedEvents,
      upcomingEvents: compareRow.historicalUpcomingEvents,
      matches: compareRow.historicalMatches,
    },
  };
}

function buildComparePayload(teamNumbers: number[]) {
  const teams = (teamNumbers.length ? teamNumbers : [5431]).map((teamNumber, index) =>
    buildCompareRow(teamNumber, index + 1),
  );

  return {
    generatedAtMs: 1_710_000_000_000,
    eventKey: EVENT_KEY,
    event: { key: EVENT_KEY, name: 'Test Regional' },
    fieldAverages: {
      eventEpa: 22,
      eventOpr: 23,
      eventCopr: 22,
      eventComposite: 85,
      eventRpAverage: 1.7,
      eventTotalRp: 1.7,
      eventSos: 0.3,
    },
    teams,
  };
}

function buildDataSuperPayload() {
  return {
    generatedAtMs: 1_710_000_000_000,
    loadedEventKey: EVENT_KEY,
    loadedTeam: 5431,
    currentEvent: null,
    historicalTeam: null,
    compare: null,
    diagnostics: {
      eventTeamCount: 6,
      tbaMatchCount: 1,
      sbMatchCount: 1,
      sbTeamEventCount: 6,
      compareTeamCount: 0,
      generatedAtMs: 1_710_000_000_000,
    },
    rawPayloads: {
      tba: { eventKey: EVENT_KEY },
      sb: { eventKey: EVENT_KEY },
      historicalTeam: { teamNumber: 5431 },
    },
  };
}

function buildDistrictSnapshotPayload() {
  return {
    generatedAtMs: 1_710_000_000_000,
    applicable: false,
    reason: 'District points are only available for FIT district events in this view.',
    districtKey: '2026fit',
    districtName: 'FIRST in Texas',
    loadedEventKey: EVENT_KEY,
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
  };
}

async function mockDashboardApis(page: Page) {
  const snapshot = buildSnapshotPayload();
  const dataSuper = buildDataSuperPayload();
  const districtSnapshot = buildDistrictSnapshotPayload();

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === '/api/snapshot') {
      await route.fulfill({ json: snapshot });
      return;
    }

    if (url.pathname === '/api/team-profile') {
      const teamNumber = Number(url.searchParams.get('team') ?? '5431');
      await route.fulfill({ json: buildTeamProfilePayload(teamNumber) });
      return;
    }

    if (url.pathname === '/api/team-compare') {
      const rawBody: unknown =
        request.method() === 'POST' ? JSON.parse(request.postData() ?? '{}') : {};
      const body = rawBody && typeof rawBody === 'object' ? (rawBody as { teams?: unknown }) : {};
      const requestedTeams = Array.isArray(body.teams) ? body.teams : [];
      const teamNumbers = requestedTeams
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isFinite(value));
      await route.fulfill({ json: buildComparePayload(teamNumbers) });
      return;
    }

    if (url.pathname === '/api/data-super') {
      await route.fulfill({ json: dataSuper });
      return;
    }

    if (url.pathname === '/api/district-points') {
      await route.fulfill({ json: districtSnapshot });
      return;
    }

    if (url.pathname === '/api/district-points/simulate') {
      await route.fulfill({
        status: 400,
        json: { error: 'District points are only available for FIT district events in this view.' },
      });
      return;
    }

    if (url.pathname === '/api/event-context') {
      await route.fulfill({
        json: {
          generatedAtMs: snapshot.generatedAtMs,
          inputs: { eventKey: EVENT_KEY },
          tba: snapshot.tba,
          sb: snapshot.sb,
        },
      });
      return;
    }

    if (url.pathname === '/api/pre-event-scout') {
      await route.fulfill({
        json: {
          generatedAtMs: snapshot.generatedAtMs,
          eventKey: EVENT_KEY,
          event: snapshot.tba.event,
          teams: TEAM_NUMBERS.map((teamNumber, index) => ({
            teamNumber,
            teamKey: `frc${teamNumber}`,
            nickname: `Team ${teamNumber}`,
            seasonSummary: buildSbTeamEvent(teamNumber, index + 1),
            seasonRollups: {
              winRate: 0.7,
              totalMatchCount: 10,
              qualMatchCount: 8,
              playoffMatchCount: 2,
              wins: 7,
              losses: 3,
              ties: 0,
              playedEventCount: 1,
              upcomingEventCount: 1,
            },
            playedEvents: [{ event: '2026other', event_name: 'Other Regional' }],
            upcomingEvents: [{ event: '2026next', event_name: 'Next Regional' }],
          })),
        },
      });
      return;
    }

    await route.continue();
  });

  await page.addInitScript(
    ({ eventKey, teamNumber }) => {
      window.localStorage.clear();
      window.localStorage.setItem(
        'tbsb_dashboard_settings_v1',
        JSON.stringify({
          teamNumber,
          eventKey,
          lagMatches: 2,
          pollMs: 5000,
          repeatUntilAck: true,
          enablePlayingAnimation: true,
          recentStartQual: 1,
          scoutingUrl: '',
          logoDataUrl: null,
          weights: {
            overallEpa: 30,
            autoEpa: 10,
            teleopEpa: 15,
            endgameEpa: 10,
            opr: 10,
            ccwm: 10,
            rpPace: 10,
            recentTrend: 15,
          },
        }),
      );
    },
    { eventKey: EVENT_KEY, teamNumber: 5431 },
  );
}

test.beforeEach(async ({ page }) => {
  await mockDashboardApis(page);
});

async function loadMockedDeskState(page: Page) {
  await page.goto('/');

  await page.getByRole('spinbutton', { name: 'Team' }).fill('5431');
  await page.getByRole('textbox', { name: 'Event' }).fill(EVENT_KEY);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/api/snapshot?') && response.request().method() === 'GET',
    ),
    page.getByRole('button', { name: 'Load' }).click(),
  ]);

  const statusStrip = page.locator('.dashboard-status-strip');
  await expect(statusStrip.getByText(`Event ${EVENT_KEY}`)).toBeVisible();
  await expect(statusStrip.getByText('Team 5431')).toBeVisible();
}

test('match to strategy workflow is preserved', async ({ page }) => {
  await loadMockedDeskState(page);

  await page.getByRole('button', { name: 'SCHEDULE', exact: true }).click();
  await page.getByRole('button', { name: 'All Event Matches' }).click();
  await expect(page.getByText('QM1', { exact: true }).first()).toBeVisible();
  await page.getByText('QM1', { exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Open in STRATEGY' })).toBeVisible();

  await page.getByRole('button', { name: 'Open in STRATEGY' }).click();
  await expect(page.getByRole('button', { name: 'Pull Live 2026 Stats' })).toBeVisible();
});

test('team profile and compare workflows are preserved', async ({ page }) => {
  await loadMockedDeskState(page);

  await page.getByRole('button', { name: 'TEAM PROFILE' }).click();
  await expect(page.getByText('Loaded Event: Test Regional')).toBeVisible();

  await page.getByRole('button', { name: 'Add To COMPARE' }).first().click();
  await page.getByRole('button', { name: 'COMPARE', exact: true }).first().click();

  await expect(page.getByText('Loaded Event Compare', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /5431 Team 5431/ }).first()).toBeVisible();
});

test('settings raw payload explorer is preserved', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'SETTINGS' }).click();
  await page.getByRole('button', { name: /Diagnostics Coverage/i }).click();
  await page.getByRole('button', { name: /Raw Payload Explorer/i }).click();
  await expect(page.getByText('Raw Payload Explorer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'DATA Route' })).toBeVisible();
  await expect(page.getByText('"eventKey": "2026test"')).toBeVisible();
});

test('district tabs show FIT-only unavailable state for non-FIT events', async ({ page }) => {
  await loadMockedDeskState(page);

  await page.getByRole('button', { name: 'DISTRICT', exact: true }).click();
  await expect(page.getByText('FIT District Only')).toBeVisible();

  await page.getByRole('button', { name: 'HISTORICAL' }).click();
  await page.getByRole('button', { name: 'DISTRICT', exact: true }).click();
  await expect(page.getByText('FIT District Only')).toBeVisible();
});
