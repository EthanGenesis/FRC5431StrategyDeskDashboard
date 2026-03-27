import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GameManualTab from './GameManualTab';
import { fetchJsonOrThrow } from '../lib/httpCache';
import type { GameManualSnapshot } from '../lib/types';

vi.mock('../lib/httpCache', () => ({
  fetchJsonOrThrow: vi.fn(),
}));

const snapshotPayload: GameManualSnapshot = {
  fetchedAtMs: 1,
  title: '2026 FRC Game Manual',
  sourceUrl: 'https://example.com/manual.html',
  pdfUrl: 'https://example.com/manual.pdf',
  lastModified: 'Tue, 24 Mar 2026 21:46:05 GMT',
  toc: [
    { id: 'manual-1', title: '1 Introduction', number: '1', level: 1 },
    { id: 'manual-2', title: '2 Arena', number: '2', level: 1 },
  ],
  sections: [
    {
      id: 'manual-1',
      title: '1 Introduction',
      number: '1',
      level: 1,
      html: '<p>Welcome to the game manual.</p>',
      text: 'Welcome to the game manual.',
    },
    {
      id: 'manual-2',
      title: '2 Arena',
      number: '2',
      level: 1,
      html: '<p>The ARENA includes field dimensions and staging.</p>',
      text: 'The ARENA includes field dimensions and staging.',
    },
  ],
};

let scrollIntoViewMock = vi.fn();

describe('GameManualTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchJsonOrThrow).mockResolvedValue(snapshotPayload);
    scrollIntoViewMock = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders official links and filters the manual search results', async () => {
    render(<GameManualTab />);

    expect(await screen.findByText('2026 FRC Game Manual')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Official HTML' })).toHaveAttribute(
      'href',
      'https://example.com/manual.html',
    );

    fireEvent.change(screen.getByPlaceholderText('Search the 2026 game manual'), {
      target: { value: 'arena' },
    });

    expect(await screen.findByText('2 Arena')).toBeVisible();
    await waitFor(() => expect(screen.queryByText('1 Introduction')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /2 Arena/i }));
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });
});
