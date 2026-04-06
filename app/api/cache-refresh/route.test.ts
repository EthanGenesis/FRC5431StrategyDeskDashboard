/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheRefreshRouteMocks = vi.hoisted(() => ({
  refreshSharedTargetCaches: vi.fn(),
  loadSharedActiveTarget: vi.fn(),
  getBootstrapRoute: vi.fn(),
  getSnapshotRoute: vi.fn(),
  getEventContextRoute: vi.fn(),
  getTeamProfileRoute: vi.fn(),
  getDataSuperRoute: vi.fn(),
  getDistrictPointsRoute: vi.fn(),
  getGameManualRoute: vi.fn(),
  getDeskOpsRoute: vi.fn(),
  getTeamDossierRoute: vi.fn(),
  getPickListAnalysisRoute: vi.fn(),
  getPlayoffSummaryRoute: vi.fn(),
  getPitOpsRoute: vi.fn(),
}));

vi.mock('../../../lib/shared-target-server', () => ({
  loadSharedActiveTarget: cacheRefreshRouteMocks.loadSharedActiveTarget,
}));

vi.mock('../refresh-active-target/refresh', () => ({
  refreshSharedTargetCaches: cacheRefreshRouteMocks.refreshSharedTargetCaches,
}));

vi.mock('../bootstrap/route', () => ({
  GET: cacheRefreshRouteMocks.getBootstrapRoute,
}));

vi.mock('../snapshot/route', () => ({
  GET: cacheRefreshRouteMocks.getSnapshotRoute,
}));

vi.mock('../event-context/route', () => ({
  GET: cacheRefreshRouteMocks.getEventContextRoute,
}));

vi.mock('../team-profile/route', () => ({
  GET: cacheRefreshRouteMocks.getTeamProfileRoute,
}));

vi.mock('../data-super/route', () => ({
  GET: cacheRefreshRouteMocks.getDataSuperRoute,
}));

vi.mock('../district-points/route', () => ({
  GET: cacheRefreshRouteMocks.getDistrictPointsRoute,
}));

vi.mock('../game-manual/route', () => ({
  GET: cacheRefreshRouteMocks.getGameManualRoute,
}));

vi.mock('../desk-ops/route', () => ({
  GET: cacheRefreshRouteMocks.getDeskOpsRoute,
}));

vi.mock('../team-dossier/route', () => ({
  GET: cacheRefreshRouteMocks.getTeamDossierRoute,
}));

vi.mock('../pick-list-analysis/route', () => ({
  GET: cacheRefreshRouteMocks.getPickListAnalysisRoute,
}));

vi.mock('../playoff-summary/route', () => ({
  GET: cacheRefreshRouteMocks.getPlayoffSummaryRoute,
}));

vi.mock('../pit-ops/route', () => ({
  GET: cacheRefreshRouteMocks.getPitOpsRoute,
}));

import { POST } from './route';

describe('/api/cache-refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheRefreshRouteMocks.loadSharedActiveTarget.mockResolvedValue({
      workspaceKey: 'event:2026txcle',
      eventKey: '2026txcle',
      teamNumber: 5431,
    });
    cacheRefreshRouteMocks.refreshSharedTargetCaches.mockResolvedValue({ ok: true });
    cacheRefreshRouteMocks.getBootstrapRoute.mockResolvedValue(
      Response.json({ generatedAtMs: 101 }),
    );
    cacheRefreshRouteMocks.getSnapshotRoute.mockResolvedValue(
      Response.json({ generatedAtMs: 201 }),
    );
    cacheRefreshRouteMocks.getEventContextRoute.mockResolvedValue(
      Response.json({ generatedAtMs: 202 }),
    );
    cacheRefreshRouteMocks.getTeamProfileRoute.mockResolvedValue(
      Response.json({ generatedAtMs: 203 }),
    );
    cacheRefreshRouteMocks.getDataSuperRoute.mockResolvedValue(
      Response.json({ generatedAtMs: 204 }),
    );
    cacheRefreshRouteMocks.getDistrictPointsRoute.mockResolvedValue(
      Response.json({ generatedAtMs: 205 }),
    );
    cacheRefreshRouteMocks.getGameManualRoute.mockResolvedValue(
      Response.json({ generatedAtMs: 206 }),
    );
    cacheRefreshRouteMocks.getDeskOpsRoute.mockResolvedValue(Response.json({ generatedAtMs: 207 }));
    cacheRefreshRouteMocks.getTeamDossierRoute.mockResolvedValue(
      Response.json({ generatedAtMs: 208 }),
    );
    cacheRefreshRouteMocks.getPickListAnalysisRoute.mockResolvedValue(
      Response.json({ generatedAtMs: 209 }),
    );
    cacheRefreshRouteMocks.getPlayoffSummaryRoute.mockResolvedValue(
      Response.json({ generatedAtMs: 210 }),
    );
    cacheRefreshRouteMocks.getPitOpsRoute.mockResolvedValue(Response.json({ generatedAtMs: 211 }));
  });

  it('rejects requests that contain no valid surface ids', async () => {
    const response = await POST(
      new Request('http://localhost/api/cache-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surfaces: ['not-a-surface'] }),
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('No valid refresh surfaces');
  });

  it('refreshes bootstrap and pit mode through the new cache control route', async () => {
    const response = await POST(
      new Request('http://localhost/api/cache-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: '2026txcle',
          team: 5431,
          surfaces: ['bootstrap', 'pit-ops'],
        }),
      }),
    );
    const body = (await response.json()) as {
      results: { surface: string; ok: boolean }[];
    };

    expect(response.status).toBe(200);
    expect(body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ surface: 'bootstrap', ok: true }),
        expect.objectContaining({ surface: 'pit-ops', ok: true }),
      ]),
    );
    expect(cacheRefreshRouteMocks.refreshSharedTargetCaches).toHaveBeenCalled();
    expect(cacheRefreshRouteMocks.getBootstrapRoute).toHaveBeenCalled();
    expect(cacheRefreshRouteMocks.getPitOpsRoute).toHaveBeenCalled();
  });
});
