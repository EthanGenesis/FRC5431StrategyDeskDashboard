/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gameManualMocks = vi.hoisted(() => ({
  loadGameManualSnapshot: vi.fn(),
}));

vi.mock('../../../lib/game-manual', () => ({
  loadGameManualSnapshot: gameManualMocks.loadGameManualSnapshot,
}));

import { GET } from './route';

describe('/api/game-manual', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gameManualMocks.loadGameManualSnapshot.mockResolvedValue({
      fetchedAtMs: 1,
      title: '2026 FRC Game Manual',
      sourceUrl: 'https://example.com/manual.html',
      pdfUrl: 'https://example.com/manual.pdf',
      lastModified: '2026-03-24T00:00:00.000Z',
      sections: [
        {
          id: 'manual-section-1',
          title: '1 Introduction',
          number: '1',
          level: 1,
          html: '<p>Welcome</p>',
          text: 'Welcome',
        },
      ],
      toc: [{ id: 'manual-section-1', title: '1 Introduction', number: '1', level: 1 }],
    });
  });

  it('returns the parsed game manual snapshot', async () => {
    const response = await GET(new Request('http://localhost/api/game-manual'));
    const body = (await response.json()) as { title: string; sections: { id: string }[] };

    expect(response.status).toBe(200);
    expect(body.title).toBe('2026 FRC Game Manual');
    expect(body.sections[0]?.id).toBe('manual-section-1');
  });

  it('returns a typed error payload when the manual fetch fails', async () => {
    gameManualMocks.loadGameManualSnapshot.mockRejectedValueOnce(new Error('manual offline'));

    const response = await GET(new Request('http://localhost/api/game-manual'));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toContain('manual offline');
  });
});
