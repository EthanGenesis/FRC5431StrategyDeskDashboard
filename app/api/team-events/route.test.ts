/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharedTargetServerMocks = vi.hoisted(() => ({
  loadTeamEventCatalog: vi.fn(),
}));

vi.mock('../../../lib/shared-target-server', () => ({
  loadTeamEventCatalog: sharedTargetServerMocks.loadTeamEventCatalog,
}));

import { GET } from './route';

describe('/api/team-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the cached team event catalog filtered by query', async () => {
    sharedTargetServerMocks.loadTeamEventCatalog.mockResolvedValue({
      generatedAt: '2026-04-01T00:00:00.000Z',
      cached: true,
      events: [
        {
          key: '2026txfor',
          name: 'Forney District Event',
          shortName: 'Forney',
          location: 'Forney, TX, USA',
          startDate: '2026-03-12',
          endDate: '2026-03-15',
        },
        {
          key: '2026txwac',
          name: 'Waco District Event',
          shortName: 'Waco',
          location: 'Waco, TX, USA',
          startDate: '2026-03-19',
          endDate: '2026-03-22',
        },
      ],
    });

    const response = await GET(
      new Request('http://localhost/api/team-events?team=5431&query=waco'),
    );
    const body = (await response.json()) as {
      cached: boolean;
      events: { key: string }[];
    };

    expect(response.status).toBe(200);
    expect(sharedTargetServerMocks.loadTeamEventCatalog).toHaveBeenCalledWith(5431, {
      year: 2026,
    });
    expect(body.cached).toBe(true);
    expect(body.events).toEqual([
      expect.objectContaining({
        key: '2026txwac',
      }),
    ]);
  });

  it('returns 400 when the team number is missing', async () => {
    const response = await GET(new Request('http://localhost/api/team-events'));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe('Missing or invalid team');
  });
});
