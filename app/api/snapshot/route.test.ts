/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serverDataMocks = vi.hoisted(() => ({
  loadEventContext: vi.fn(),
  parsePositiveTeamNumber: vi.fn((value: unknown) => Number(value)),
  parseRequiredEventKey: vi.fn((value: unknown) => String(value)),
}));

const sourceCacheMocks = vi.hoisted(() => ({
  loadSnapshotCacheRecord: vi.fn(),
  saveSnapshotCacheRecord: vi.fn(),
}));

vi.mock('../../../lib/server-data', () => ({
  loadEventContext: serverDataMocks.loadEventContext,
  parsePositiveTeamNumber: serverDataMocks.parsePositiveTeamNumber,
  parseRequiredEventKey: serverDataMocks.parseRequiredEventKey,
}));

vi.mock('../../../lib/source-cache-server', () => ({
  loadSnapshotCacheRecord: sourceCacheMocks.loadSnapshotCacheRecord,
  saveSnapshotCacheRecord: sourceCacheMocks.saveSnapshotCacheRecord,
}));

import { GET } from './route';

describe('/api/snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sourceCacheMocks.loadSnapshotCacheRecord.mockResolvedValue(null);
  });

  it('returns the typed snapshot payload for a valid event/team request', async () => {
    serverDataMocks.loadEventContext.mockResolvedValue({
      tba: {
        event: { key: '2026miket' },
        matches: [],
        rankings: null,
        oprs: null,
        alliances: null,
        status: null,
        insights: null,
        awards: null,
        teams: [],
      },
      sb: {
        matches: [],
        teamEvents: [],
        teamMatches: [],
      },
      official: null,
      nexus: null,
      media: null,
      validation: null,
      liveSignals: [],
    });

    const response = await GET(
      new Request('http://localhost/api/snapshot?team=5431&eventKey=2026miket'),
    );
    const body = (await response.json()) as {
      inputs: { eventKey: string; team: number; teamKey: string };
      official: unknown;
      nexus: unknown;
      media: unknown;
      validation: unknown;
      liveSignals: unknown[];
    };

    expect(response.status).toBe(200);
    expect(body.inputs).toMatchObject({
      eventKey: '2026miket',
      team: 5431,
      teamKey: 'frc5431',
    });
    expect(body.official).toBeNull();
    expect(body.nexus).toBeNull();
    expect(body.media).toBeNull();
    expect(body.validation).toBeNull();
    expect(body.liveSignals).toEqual([]);
    expect(serverDataMocks.loadEventContext).toHaveBeenCalledWith('2026miket', 5431);
  });

  it('returns the warmed cached snapshot when requested and available', async () => {
    sourceCacheMocks.loadSnapshotCacheRecord.mockResolvedValue({
      generatedAtMs: 1_710_000_000_000,
      inputs: {
        eventKey: '2026miket',
        team: 5431,
        teamKey: 'frc5431',
      },
      tba: {
        event: { key: '2026miket' },
        matches: [],
        rankings: null,
        oprs: null,
        alliances: null,
        status: null,
        insights: null,
        awards: null,
        teams: [],
      },
      sb: {
        matches: [],
        teamEvents: [],
        teamMatches: [],
      },
      official: null,
      nexus: null,
      media: null,
      validation: null,
      liveSignals: [],
    });

    const response = await GET(
      new Request('http://localhost/api/snapshot?team=5431&eventKey=2026miket&warm=1'),
    );
    const body = (await response.json()) as {
      inputs: { eventKey: string; team: number; teamKey: string };
    };

    expect(response.status).toBe(200);
    expect(body.inputs).toMatchObject({
      eventKey: '2026miket',
      team: 5431,
      teamKey: 'frc5431',
    });
    expect(sourceCacheMocks.loadSnapshotCacheRecord).toHaveBeenCalledWith(
      'snapshot',
      '2026miket',
      5431,
      90,
    );
    expect(serverDataMocks.loadEventContext).not.toHaveBeenCalled();
  });

  it('maps invalid input errors to a 400 response', async () => {
    serverDataMocks.parseRequiredEventKey.mockImplementationOnce(() => {
      throw new Error('invalid eventKey');
    });

    const response = await GET(new Request('http://localhost/api/snapshot?team=5431'));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'invalid eventKey' });
  });
});
