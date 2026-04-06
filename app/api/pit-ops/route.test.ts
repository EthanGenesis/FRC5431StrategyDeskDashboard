/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pitOpsRouteMocks = vi.hoisted(() => ({
  buildPitOpsResponse: vi.fn(),
  loadSnapshotCacheRecord: vi.fn(),
  saveSnapshotCacheRecord: vi.fn(),
  loadSharedActiveTarget: vi.fn(),
}));

vi.mock('../../../lib/pit-ops', () => ({
  buildPitOpsResponse: pitOpsRouteMocks.buildPitOpsResponse,
}));

vi.mock('../../../lib/source-cache-server', () => ({
  loadSnapshotCacheRecord: pitOpsRouteMocks.loadSnapshotCacheRecord,
  saveSnapshotCacheRecord: pitOpsRouteMocks.saveSnapshotCacheRecord,
}));

vi.mock('../../../lib/shared-target-server', () => ({
  loadSharedActiveTarget: pitOpsRouteMocks.loadSharedActiveTarget,
}));

import { GET } from './route';

describe('/api/pit-ops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pitOpsRouteMocks.saveSnapshotCacheRecord.mockResolvedValue(undefined);
    pitOpsRouteMocks.loadSharedActiveTarget.mockResolvedValue({
      workspaceKey: 'shared',
      eventKey: '',
      teamNumber: null,
    });
  });

  it('returns an empty typed response when there is no loaded event/team', async () => {
    const response = await GET(new Request('http://localhost/api/pit-ops'));
    const body = (await response.json()) as { eventKey: string | null; timeline: unknown[] };

    expect(response.status).toBe(200);
    expect(body.eventKey).toBeNull();
    expect(body.timeline).toEqual([]);
  });

  it('returns a warmed pit payload when the cache already exists', async () => {
    pitOpsRouteMocks.loadSharedActiveTarget.mockResolvedValue({
      workspaceKey: 'event:2026txcle',
      eventKey: '2026txcle',
      teamNumber: 5431,
    });
    pitOpsRouteMocks.loadSnapshotCacheRecord.mockResolvedValueOnce({
      generatedAtMs: 1,
      workspaceKey: 'event:2026txcle',
      eventKey: '2026txcle',
      eventName: 'Clear Lake',
      teamNumber: 5431,
      currentMatchLabel: null,
      nextMatchLabel: 'QM4',
      countdownMs: 1_000,
      bumperColor: 'BLUE',
      allianceColor: 'blue',
      queueState: 'QUEUE_2',
      queueMatchesAway: 2,
      queueLadder: [],
      pitAddress: 'A12',
      inspectionStatus: 'Ready',
      estimatedQueueTimeMs: null,
      estimatedOnDeckTimeMs: null,
      estimatedOnFieldTimeMs: null,
      estimatedStartTimeMs: null,
      timeline: [],
    });

    const response = await GET(new Request('http://localhost/api/pit-ops'));
    const body = (await response.json()) as { nextMatchLabel: string };

    expect(response.status).toBe(200);
    expect(body.nextMatchLabel).toBe('QM4');
    expect(pitOpsRouteMocks.buildPitOpsResponse).not.toHaveBeenCalled();
  });

  it('builds and persists a pit payload when the warm cache misses', async () => {
    pitOpsRouteMocks.loadSharedActiveTarget.mockResolvedValue({
      workspaceKey: 'event:2026txcle',
      eventKey: '2026txcle',
      teamNumber: 5431,
    });
    pitOpsRouteMocks.loadSnapshotCacheRecord
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ generatedAtMs: 77 });
    pitOpsRouteMocks.buildPitOpsResponse.mockReturnValue({
      generatedAtMs: 123,
      workspaceKey: 'event:2026txcle',
      eventKey: '2026txcle',
      eventName: 'Clear Lake',
      teamNumber: 5431,
      currentMatchLabel: null,
      nextMatchLabel: 'QM4',
      countdownMs: 1_000,
      bumperColor: 'BLUE',
      allianceColor: 'blue',
      queueState: 'QUEUE_2',
      queueMatchesAway: 2,
      queueLadder: [],
      pitAddress: 'A12',
      inspectionStatus: 'Ready',
      estimatedQueueTimeMs: null,
      estimatedOnDeckTimeMs: null,
      estimatedOnFieldTimeMs: null,
      estimatedStartTimeMs: null,
      timeline: [],
    });

    const response = await GET(new Request('http://localhost/api/pit-ops'));

    expect(response.status).toBe(200);
    expect(pitOpsRouteMocks.buildPitOpsResponse).toHaveBeenCalled();
    expect(pitOpsRouteMocks.saveSnapshotCacheRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'pit_ops',
        eventKey: '2026txcle',
        teamNumber: 5431,
      }),
    );
  });
});
