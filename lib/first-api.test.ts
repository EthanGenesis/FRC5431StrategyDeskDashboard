import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FirstApiEnv } from './env';

const envMocks = vi.hoisted(() => ({
  hasFirstApiEnv: vi.fn(),
  getFirstApiEnv: vi.fn<() => FirstApiEnv>(),
}));

const cacheMocks = vi.hoisted(() => ({
  cachedSourceJson: vi.fn(),
}));

vi.mock('./env', () => ({
  hasFirstApiEnv: envMocks.hasFirstApiEnv,
  getFirstApiEnv: envMocks.getFirstApiEnv,
}));

vi.mock('./source-cache-server', () => ({
  cachedSourceJson: cacheMocks.cachedSourceJson,
}));

import { loadOfficialEventSnapshot } from './first-api';

describe('loadOfficialEventSnapshot', () => {
  const defaultEnv: FirstApiEnv = {
    FIRST_API_BASE_URL: 'https://frc-api.firstinspires.org/v3.0',
    FIRST_API_USERNAME: 'user',
    FIRST_API_AUTH_TOKEN: 'token',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(envMocks.hasFirstApiEnv).mockReturnValue(true);
    vi.mocked(envMocks.getFirstApiEnv).mockReturnValue(defaultEnv);
  });

  it('keeps official data available even if awards fail', async () => {
    cacheMocks.cachedSourceJson.mockImplementation((_source: string, path: string) => {
      if (String(path).includes('/events?eventCode=')) {
        return {
          Events: [{ name: 'Space City', districtCode: 'FIT', districtName: 'FIRST In Texas' }],
        };
      }
      if (String(path).includes('/matches/')) {
        return { Matches: [{ matchNumber: 1 }] };
      }
      if (String(path).includes('/rankings/')) {
        return { Rankings: [{ rank: 1, teamNumber: 5431 }] };
      }
      if (String(path).includes('/awards/event/')) {
        throw new Error('awards unavailable');
      }
      throw new Error(`unexpected path ${path}`);
    });

    const snapshot = await loadOfficialEventSnapshot('2026txcle');

    expect(snapshot?.status).toBe('available');
    expect(snapshot?.event).toEqual(
      expect.objectContaining({
        name: 'Space City',
      }),
    );
    expect(snapshot?.matches).toEqual([{ matchNumber: 1 }]);
    expect(snapshot?.rankings).toEqual({ Rankings: [{ rank: 1, teamNumber: 5431 }] });
    expect(snapshot?.awards).toEqual([]);
  });

  it('returns disabled when FIRST env is not configured', async () => {
    vi.mocked(envMocks.hasFirstApiEnv).mockReturnValue(false);

    const snapshot = await loadOfficialEventSnapshot('2026txcle');

    expect(snapshot).toEqual({
      status: 'disabled',
      event: null,
      matches: [],
      rankings: null,
      awards: [],
      district: null,
    });
  });

  it('does not report empty official payloads as available', async () => {
    cacheMocks.cachedSourceJson.mockResolvedValue({});

    const snapshot = await loadOfficialEventSnapshot('2026txcle');

    expect(snapshot?.status).toBe('partial');
    expect(snapshot?.event).toBeNull();
    expect(snapshot?.matches).toEqual([]);
    expect(snapshot?.awards).toEqual([]);
  });

  it('marks partial official payloads as partial', async () => {
    cacheMocks.cachedSourceJson.mockImplementation((_source: string, path: string) => {
      if (String(path).includes('/events?eventCode=')) {
        return {
          Events: [{ name: 'Space City', districtCode: 'FIT', districtName: 'FIRST In Texas' }],
        };
      }
      if (String(path).includes('/matches/')) {
        return { Matches: [] };
      }
      if (String(path).includes('/rankings/')) {
        throw new Error('rankings unavailable');
      }
      if (String(path).includes('/awards/event/')) {
        return { Awards: [] };
      }
      throw new Error(`unexpected path ${path}`);
    });

    const snapshot = await loadOfficialEventSnapshot('2026txcle');

    expect(snapshot?.status).toBe('partial');
    expect(snapshot?.event).toEqual(
      expect.objectContaining({
        name: 'Space City',
      }),
    );
  });
});
