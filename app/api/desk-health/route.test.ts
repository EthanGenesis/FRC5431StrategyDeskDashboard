/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deskHealthRouteMocks = vi.hoisted(() => ({
  loadDeskHealthSummary: vi.fn(),
  loadSharedActiveTarget: vi.fn(),
  loadSharedRefreshStatus: vi.fn(),
}));

vi.mock('../../../lib/desk-health', () => ({
  loadDeskHealthSummary: deskHealthRouteMocks.loadDeskHealthSummary,
}));

vi.mock('../../../lib/shared-target-server', () => ({
  loadSharedActiveTarget: deskHealthRouteMocks.loadSharedActiveTarget,
  loadSharedRefreshStatus: deskHealthRouteMocks.loadSharedRefreshStatus,
}));

import { GET } from './route';

describe('/api/desk-health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deskHealthRouteMocks.loadSharedActiveTarget.mockResolvedValue({
      workspaceKey: 'event:2026txcle',
      eventKey: '2026txcle',
      teamNumber: 5431,
    });
    deskHealthRouteMocks.loadSharedRefreshStatus.mockResolvedValue({
      state: 'ready',
      lastSuccessAt: '2026-04-05T00:00:05.000Z',
    });
    deskHealthRouteMocks.loadDeskHealthSummary.mockResolvedValue({
      generatedAtMs: 1,
      workspaceKey: 'event:2026txcle',
      eventKey: '2026txcle',
      teamNumber: 5431,
      refreshState: 'ready',
      lastSuccessAt: '2026-04-05T00:00:05.000Z',
      sourceTrust: null,
      bundleStateCounts: {},
      cacheStateCounts: {},
      paritySummary: { match: 0, diff: 0, error: 0, skipped: 0 },
      recentFailures: [],
      routeSummaries: [],
      staleOrErrorSurfaces: [],
    });
  });

  it('returns the summarized desk health payload', async () => {
    const response = await GET(new Request('http://localhost/api/desk-health'));
    const body = (await response.json()) as { refreshState: string; teamNumber: number };

    expect(response.status).toBe(200);
    expect(body.refreshState).toBe('ready');
    expect(body.teamNumber).toBe(5431);
    expect(deskHealthRouteMocks.loadDeskHealthSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceKey: 'event:2026txcle',
        eventKey: '2026txcle',
        teamNumber: 5431,
        refreshState: 'ready',
      }),
    );
  });
});
