/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharedTargetServerMocks = vi.hoisted(() => ({
  loadSharedActiveTarget: vi.fn(),
  loadSharedRefreshStatus: vi.fn(),
  saveSharedActiveTarget: vi.fn(),
  refreshSharedTargetCaches: vi.fn(),
}));

vi.mock('../../../lib/shared-target-server', () => ({
  loadSharedActiveTarget: sharedTargetServerMocks.loadSharedActiveTarget,
  loadSharedRefreshStatus: sharedTargetServerMocks.loadSharedRefreshStatus,
  saveSharedActiveTarget: sharedTargetServerMocks.saveSharedActiveTarget,
  refreshSharedTargetCaches: sharedTargetServerMocks.refreshSharedTargetCaches,
}));

import { GET, POST } from './route';

describe('/api/active-target', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedTargetServerMocks.loadSharedActiveTarget.mockResolvedValue({
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
      lastRefreshedAt: null,
      refreshState: 'idle',
      refreshError: null,
      updatedAt: null,
    });
    sharedTargetServerMocks.loadSharedRefreshStatus.mockResolvedValue({
      workspaceKey: 'shared',
      state: 'ready',
      lastRunAt: null,
      lastSuccessAt: '2026-04-01T00:00:00.000Z',
      lastErrorAt: null,
      lastError: null,
      detail: null,
      updatedAt: null,
    });
  });

  it('returns the shared active target payload', async () => {
    const response = await GET(new Request('http://localhost/api/active-target'));
    const body = (await response.json()) as {
      target: { eventKey: string };
      refreshStatus: { state: string };
    };

    expect(response.status).toBe(200);
    expect(body.target.eventKey).toBe('2026txfor');
    expect(body.refreshStatus.state).toBe('ready');
  });

  it('persists shared target metadata through POST', async () => {
    sharedTargetServerMocks.saveSharedActiveTarget.mockResolvedValue({
      workspaceKey: 'shared',
      seasonYear: 2026,
      teamNumber: 5431,
      eventKey: '2026txwac',
      eventName: 'Waco District Event',
      eventShortName: 'Waco',
      eventLocation: 'Waco, TX, USA',
      startDate: '2026-03-19',
      endDate: '2026-03-22',
      lastSnapshotGeneratedAt: null,
      lastEventContextGeneratedAt: null,
      lastTeamCatalogGeneratedAt: null,
      lastRefreshedAt: null,
      refreshState: 'idle',
      refreshError: null,
      updatedAt: null,
    });

    const response = await POST(
      new Request('http://localhost/api/active-target', {
        method: 'POST',
        body: JSON.stringify({
          teamNumber: 5431,
          eventKey: '2026txwac',
          eventName: 'Waco District Event',
          eventShortName: 'Waco',
          eventLocation: 'Waco, TX, USA',
        }),
      }),
    );
    const body = (await response.json()) as {
      target: { eventKey: string; eventName: string };
    };

    expect(response.status).toBe(200);
    expect(sharedTargetServerMocks.saveSharedActiveTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        teamNumber: 5431,
        eventKey: '2026txwac',
        eventName: 'Waco District Event',
        eventShortName: 'Waco',
      }),
    );
    expect(body.target.eventKey).toBe('2026txwac');
    expect(body.target.eventName).toBe('Waco District Event');
  });
});
