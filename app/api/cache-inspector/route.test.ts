/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheInspectorRouteMocks = vi.hoisted(() => ({
  loadCacheInspectorSummary: vi.fn(),
  loadSharedActiveTarget: vi.fn(),
}));

vi.mock('../../../lib/desk-health', () => ({
  loadCacheInspectorSummary: cacheInspectorRouteMocks.loadCacheInspectorSummary,
}));

vi.mock('../../../lib/shared-target-server', () => ({
  loadSharedActiveTarget: cacheInspectorRouteMocks.loadSharedActiveTarget,
}));

import { GET } from './route';

describe('/api/cache-inspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheInspectorRouteMocks.loadSharedActiveTarget.mockResolvedValue({
      workspaceKey: 'event:2026txcle',
      eventKey: '2026txcle',
      teamNumber: 5431,
    });
    cacheInspectorRouteMocks.loadCacheInspectorSummary.mockResolvedValue({
      generatedAtMs: 1,
      workspaceKey: 'event:2026txcle',
      eventKey: '2026txcle',
      teamNumber: 5431,
      surfaces: [{ id: 'bootstrap', label: 'Bootstrap', source: 'bootstrap', kind: 'hot' }],
    });
  });

  it('returns the cache inspector summary for the loaded desk target', async () => {
    const response = await GET(new Request('http://localhost/api/cache-inspector'));
    const body = (await response.json()) as { surfaces: { id: string }[] };

    expect(response.status).toBe(200);
    expect(body.surfaces[0]?.id).toBe('bootstrap');
    expect(cacheInspectorRouteMocks.loadCacheInspectorSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceKey: 'event:2026txcle',
        eventKey: '2026txcle',
        teamNumber: 5431,
      }),
    );
  });
});
