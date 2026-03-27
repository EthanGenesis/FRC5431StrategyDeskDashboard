/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serverDataMocks = vi.hoisted(() => ({
  loadEventContext: vi.fn(),
  parseRequiredEventKey: vi.fn((value: unknown) => String(value)),
}));

vi.mock('../../../lib/server-data', () => ({
  loadEventContext: serverDataMocks.loadEventContext,
  parseRequiredEventKey: serverDataMocks.parseRequiredEventKey,
}));

import { GET } from './route';

describe('/api/event-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the event context payload for a valid event request', async () => {
    serverDataMocks.loadEventContext.mockResolvedValue({
      tba: {
        event: { key: '2026miket' },
        matches: [{ key: '2026miket_qm1' }],
        rankings: { rankings: [] },
        oprs: { oprs: {} },
        alliances: [],
        status: {},
        insights: {},
        awards: [],
        teams: [],
      },
      sb: {
        matches: [],
        teamEvents: [],
        teamMatches: [],
      },
    });

    const response = await GET(
      new Request('http://localhost/api/event-context?eventKey=2026miket'),
    );
    const body = (await response.json()) as {
      inputs: { eventKey: string };
      tba: { event: { key: string } };
    };

    expect(response.status).toBe(200);
    expect(body.inputs).toEqual({ eventKey: '2026miket' });
    expect(body.tba.event).toEqual({ key: '2026miket' });
  });

  it('returns 400 for invalid event keys', async () => {
    serverDataMocks.parseRequiredEventKey.mockImplementationOnce(() => {
      throw new Error('Expected string to contain at least 1 character(s)');
    });

    const response = await GET(new Request('http://localhost/api/event-context'));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('Expected string');
  });
});
