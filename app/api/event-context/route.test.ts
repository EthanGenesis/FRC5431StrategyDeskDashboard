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
      official: {
        status: 'available',
        event: { name: 'Test Regional' },
        matches: [],
        rankings: null,
        awards: [],
        district: null,
      },
      nexus: {
        supported: true,
        status: 'available',
        currentMatchKey: null,
        nextMatchKey: '2026miket_qm2',
        queueMatchesAway: 1,
        queueText: 'Queue 1 away',
        pitMapUrl: null,
        announcements: [],
        partsRequests: [],
        inspectionSummary: null,
        pits: [],
        raw: {
          status: null,
          pits: [],
          pitMap: null,
          inspection: [],
          announcements: [],
          partsRequests: [],
        },
      },
      media: { preferredWebcastUrl: 'https://example.com/stream', webcasts: [], media: [] },
      validation: {
        generatedAtMs: 1,
        firstStatus: 'available',
        nexusStatus: 'available',
        officialAvailability: 'full',
        officialCounts: {
          eventPresent: true,
          rankings: 0,
          matches: 0,
          awards: 0,
        },
        discrepancies: [],
        staleSeconds: 0,
        officialTimestamp: null,
        summary: 'Aligned',
      },
      liveSignals: [],
    });

    const response = await GET(
      new Request('http://localhost/api/event-context?eventKey=2026miket'),
    );
    const body = (await response.json()) as {
      inputs: { eventKey: string };
      tba: { event: { key: string } };
      official: { status: string };
      nexus: { status: string };
      media: { preferredWebcastUrl: string };
      validation: { summary: string };
      liveSignals: unknown[];
    };

    expect(response.status).toBe(200);
    expect(body.inputs).toEqual({ eventKey: '2026miket' });
    expect(body.tba.event).toEqual({ key: '2026miket' });
    expect(body.official.status).toBe('available');
    expect(body.nexus.status).toBe('available');
    expect(body.media.preferredWebcastUrl).toContain('example.com');
    expect(body.validation.summary).toBe('Aligned');
    expect(body.liveSignals).toEqual([]);
    expect(serverDataMocks.loadEventContext).toHaveBeenCalledWith('2026miket', null);
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
