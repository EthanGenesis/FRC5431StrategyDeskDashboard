/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharedTargetServerMocks = vi.hoisted(() => ({
  refreshSharedTargetCaches: vi.fn(),
}));

vi.mock('./refresh', () => ({
  refreshSharedTargetCaches: sharedTargetServerMocks.refreshSharedTargetCaches,
}));

import { POST } from './route';

describe('/api/refresh-active-target', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedTargetServerMocks.refreshSharedTargetCaches.mockResolvedValue({
      ok: true,
      target: {
        workspaceKey: 'shared',
        seasonYear: 2026,
        teamNumber: 5431,
        eventKey: '2026txfor',
        eventName: 'Forney District Event',
        eventShortName: 'Forney',
        eventLocation: 'Forney, TX, USA',
        startDate: '2026-03-12',
        endDate: '2026-03-15',
        lastSnapshotGeneratedAt: null,
        lastEventContextGeneratedAt: null,
        lastTeamCatalogGeneratedAt: null,
        lastRefreshedAt: '2026-04-01T00:00:00.000Z',
        refreshState: 'ready',
        refreshError: null,
        updatedAt: null,
      },
      refreshStatus: {
        workspaceKey: 'shared',
        state: 'ready',
        lastRunAt: '2026-04-01T00:00:00.000Z',
        lastSuccessAt: '2026-04-01T00:00:00.000Z',
        lastErrorAt: null,
        lastError: null,
        detail: null,
        updatedAt: null,
      },
      components: {
        snapshot: { ok: true, status: 200, error: null, generatedAtMs: 1_710_000_000_000 },
      },
    });
  });

  it('returns the composite warm-refresh result', async () => {
    const response = await POST(new Request('http://localhost/api/refresh-active-target'));
    const body = (await response.json()) as {
      ok: boolean;
      target: { eventKey: string };
      components: { snapshot: { ok: boolean } };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.target.eventKey).toBe('2026txfor');
    expect(body.components.snapshot.ok).toBe(true);
  });
});
