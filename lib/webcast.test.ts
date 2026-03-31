import { describe, expect, it } from 'vitest';

import {
  getYouTubeVideoIdFromUrl,
  getYouTubeVideoIdFromWebcast,
  isYouTubeEmbedCapableWebcast,
} from './webcast';

describe('webcast helpers', () => {
  it('extracts YouTube video ids from known URLs', () => {
    expect(getYouTubeVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    );
    expect(getYouTubeVideoIdFromUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    );
    expect(getYouTubeVideoIdFromUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('prefers direct webcast channel ids for youtube rows', () => {
    expect(
      getYouTubeVideoIdFromWebcast({
        type: 'youtube',
        channel: 'dQw4w9WgXcQ',
        file: null,
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      }),
    ).toBe('dQw4w9WgXcQ');
  });

  it('detects non-youtube rows as not embed-capable', () => {
    expect(
      isYouTubeEmbedCapableWebcast({
        type: 'twitch',
        channel: 'frc',
        file: null,
        url: 'https://www.twitch.tv/frc',
        embedUrl: null,
      }),
    ).toBe(false);
  });
});
