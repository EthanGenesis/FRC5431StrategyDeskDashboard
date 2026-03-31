/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMocks = vi.hoisted(() => ({
  getAppEnv: vi.fn(),
}));

const tbaMocks = vi.hoisted(() => ({
  tbaGet: vi.fn(),
}));

vi.mock('../../../lib/env', () => ({
  getAppEnv: envMocks.getAppEnv,
}));

vi.mock('../../../lib/tba', () => ({
  tbaGet: tbaMocks.tbaGet,
}));

import { GET } from './route';

describe('/api/event-search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(envMocks.getAppEnv).mockReturnValue({
      TBA_AUTH_KEY: 'test-key',
      TBA_WEBHOOK_SECRET: 'secret',
    });
  });

  it('scopes to the team event list when a valid team number is provided', async () => {
    vi.mocked(tbaMocks.tbaGet).mockResolvedValue([
      {
        key: '2026txfar',
        name: 'Farmersville Event',
        short_name: 'Farmersville',
        city: 'Farmersville',
        state_prov: 'TX',
        country: 'USA',
      },
    ]);

    const response = await GET(
      new Request('http://localhost/api/event-search?query=farm&team=5431'),
    );
    const body = (await response.json()) as {
      events: { key: string; name: string; shortName: string; location: string }[];
    };

    expect(tbaMocks.tbaGet).toHaveBeenCalledWith('/team/frc5431/events/2026/simple', 'test-key');
    expect(body.events).toEqual([
      {
        key: '2026txfar',
        name: 'Farmersville Event',
        shortName: 'Farmersville',
        location: 'Farmersville, TX, USA',
      },
    ]);
  });

  it('falls back to the global 2026 event list when no team number is provided', async () => {
    vi.mocked(tbaMocks.tbaGet).mockResolvedValue([
      {
        key: '2026txcle',
        name: 'Space City',
        short_name: 'Space City',
      },
    ]);

    const response = await GET(new Request('http://localhost/api/event-search?query=space'));
    const body = (await response.json()) as {
      events: { key: string }[];
    };

    expect(tbaMocks.tbaGet).toHaveBeenCalledWith('/events/2026/simple', 'test-key');
    expect(body.events[0]?.key).toBe('2026txcle');
  });

  it('returns the full team-scoped event list when the team is valid and the query is blank', async () => {
    vi.mocked(tbaMocks.tbaGet).mockResolvedValue([
      {
        key: '2026txcle',
        name: 'Space City',
        short_name: 'Space City',
      },
      {
        key: '2026txfar',
        name: 'Farmersville Event',
        short_name: 'Farmersville',
      },
    ]);

    const response = await GET(new Request('http://localhost/api/event-search?query=&team=5431'));
    const body = (await response.json()) as {
      events: { key: string }[];
    };

    expect(tbaMocks.tbaGet).toHaveBeenCalledWith('/team/frc5431/events/2026/simple', 'test-key');
    expect(body.events.map((row) => row.key)).toEqual(['2026txcle', '2026txfar']);
  });
});
