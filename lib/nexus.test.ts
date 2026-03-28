import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NexusEnv } from './env';

const envMocks = vi.hoisted(() => ({
  hasNexusEnv: vi.fn(),
  getNexusEnv: vi.fn<() => NexusEnv>(),
}));

const cacheMocks = vi.hoisted(() => ({
  cachedSourceJson: vi.fn(),
}));

vi.mock('./env', () => ({
  hasNexusEnv: envMocks.hasNexusEnv,
  getNexusEnv: envMocks.getNexusEnv,
}));

vi.mock('./source-cache-server', () => ({
  cachedSourceJson: cacheMocks.cachedSourceJson,
}));

import { loadNexusOpsSnapshot } from './nexus';

describe('loadNexusOpsSnapshot', () => {
  const defaultEnv: NexusEnv = {
    NEXUS_API_BASE_URL: 'https://frc.nexus/api/v1',
    NEXUS_API_KEY: 'key',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(envMocks.hasNexusEnv).mockReturnValue(true);
    vi.mocked(envMocks.getNexusEnv).mockReturnValue(defaultEnv);
  });

  it('uses the root event endpoint and tolerates optional 404 sidecars', async () => {
    cacheMocks.cachedSourceJson.mockImplementation((_source: string, path: string) => {
      if (path === '/event/2026txcle') {
        return {
          eventKey: '2026txcle',
          matches: [
            { label: 'Qualification 1', status: 'On field' },
            { label: 'Qualification 2', status: 'Queued' },
          ],
          announcements: [],
          partsRequests: [{ id: 'p1', teamNumber: 5431, text: 'Battery', status: 'open' }],
        };
      }
      if (path === '/event/2026txcle/map') {
        throw new Error('Fetch failed 404');
      }
      if (path === '/event/2026txcle/pits') {
        throw new Error('Fetch failed 404');
      }
      if (path === '/event/2026txcle/inspection') {
        throw new Error('Fetch failed 404');
      }
      throw new Error(`unexpected path ${path}`);
    });

    const snapshot = await loadNexusOpsSnapshot('2026txcle');

    expect(snapshot).toEqual(
      expect.objectContaining({
        supported: true,
        status: 'available',
        currentMatchKey: 'Qualification 1',
        nextMatchKey: 'Qualification 2',
        queueMatchesAway: 1,
        queueText: 'On field: Qualification 1',
        pitMapUrl: null,
        pitsStatus: 'unsupported',
        inspectionStatus: 'unsupported',
        pitMapStatus: 'unsupported',
        pitAddressByTeam: {},
        inspectionByTeam: {},
      }),
    );
    expect(snapshot?.matches[0]).toEqual(
      expect.objectContaining({
        label: 'Qualification 1',
        status: 'On field',
      }),
    );
    expect(snapshot?.partsRequests).toHaveLength(1);
  });

  it('returns disabled when Nexus env is not configured', async () => {
    vi.mocked(envMocks.hasNexusEnv).mockReturnValue(false);

    const snapshot = await loadNexusOpsSnapshot('2026txcle');

    expect(snapshot?.status).toBe('disabled');
    expect(snapshot?.supported).toBe(false);
  });

  it('normalizes optional pit and inspection maps when present', async () => {
    cacheMocks.cachedSourceJson.mockImplementation((_source: string, path: string) => {
      if (path === '/event/2026txcle') {
        return {
          eventKey: '2026txcle',
          matches: [
            {
              label: 'Qualification 3',
              status: 'Queued',
              redTeams: ['5431', '111', '222'],
              blueTeams: ['333', '444', '555'],
              times: {
                estimatedQueueTime: 1710000000000,
                estimatedOnDeckTime: 1710000060000,
              },
            },
          ],
          announcements: [],
          partsRequests: [],
        };
      }
      if (path === '/event/2026txcle/pits') {
        return {
          '5431': 'P-12',
          '111': 'P-03',
        };
      }
      if (path === '/event/2026txcle/inspection') {
        return {
          '5431': 'Passed',
          '111': 'Pending',
        };
      }
      if (path === '/event/2026txcle/map') {
        return { url: 'https://example.com/pit-map' };
      }
      throw new Error(`unexpected path ${path}`);
    });

    const snapshot = await loadNexusOpsSnapshot('2026txcle');

    expect(snapshot?.pitAddressByTeam).toEqual({
      '111': 'P-03',
      '5431': 'P-12',
    });
    expect(snapshot?.inspectionByTeam).toEqual({
      '111': 'Pending',
      '5431': 'Passed',
    });
    expect(snapshot?.pitMapStatus).toBe('available');
    expect(snapshot?.inspectionStatus).toBe('available');
    expect(snapshot?.pitsStatus).toBe('available');
  });
});
