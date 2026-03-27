/* @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/fit-district', () => ({
  parseDistrictSimulationRequest: vi.fn((body: unknown) => body),
  simulateFitDistrictEvent: vi.fn(() =>
    Promise.resolve({
      generatedAtMs: 1,
      mode: 'event',
      runs: 100,
      rows: [],
      loadedTeamHistogram: [],
      loadedTeamSummary: null,
    }),
  ),
  simulateFitDistrictSeason: vi.fn(() =>
    Promise.resolve({
      generatedAtMs: 1,
      mode: 'season',
      runs: 100,
      rows: [],
      dcmpCutoff: { min: null, p5: null, p50: null, p95: null, max: null },
      worldsCutoff: { min: null, p5: null, p50: null, p95: null, max: null },
      loadedTeamHistogram: [],
      loadedTeamSummary: null,
    }),
  ),
}));

import { POST } from './route';

describe('/api/district-points/simulate', () => {
  it('returns event simulation payloads', async () => {
    const response = await POST(
      new Request('http://localhost/api/district-points/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: '2026test',
          team: 5431,
          runs: 100,
          mode: 'event',
        }),
      }),
    );
    const body = (await response.json()) as { mode: string; runs: number };

    expect(response.status).toBe(200);
    expect(body.mode).toBe('event');
    expect(body.runs).toBe(100);
  });

  it('returns season simulation payloads', async () => {
    const response = await POST(
      new Request('http://localhost/api/district-points/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: '2026test',
          team: 5431,
          runs: 100,
          mode: 'season',
        }),
      }),
    );
    const body = (await response.json()) as { mode: string };

    expect(response.status).toBe(200);
    expect(body.mode).toBe('season');
  });
});
