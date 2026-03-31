import type { EventMediaEntry } from './types';

function normalizeYouTubeVideoId(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(normalized)) return null;
  return normalized;
}

export function getYouTubeVideoIdFromUrl(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();

    if (hostname === 'youtu.be') {
      return normalizeYouTubeVideoId(url.pathname.split('/').find(Boolean) ?? null);
    }

    if (
      hostname === 'youtube.com' ||
      hostname === 'www.youtube.com' ||
      hostname === 'm.youtube.com' ||
      hostname === 'youtube-nocookie.com' ||
      hostname === 'www.youtube-nocookie.com'
    ) {
      const watchId = normalizeYouTubeVideoId(url.searchParams.get('v'));
      if (watchId) return watchId;

      const parts = url.pathname.split('/').filter(Boolean);
      const embedSegment = parts.find(
        (part) => part === 'embed' || part === 'shorts' || part === 'live',
      );
      if (embedSegment) {
        const embedIndex = parts.indexOf(embedSegment);
        return normalizeYouTubeVideoId(parts[embedIndex + 1] ?? null);
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function getYouTubeVideoIdFromWebcast(
  webcast: EventMediaEntry | null | undefined,
): string | null {
  if (!webcast) return null;

  if (String(webcast.type ?? '').toLowerCase() === 'youtube') {
    const directChannel = normalizeYouTubeVideoId(webcast.channel);
    if (directChannel) return directChannel;
  }

  return (
    getYouTubeVideoIdFromUrl(webcast.embedUrl) ??
    getYouTubeVideoIdFromUrl(webcast.url) ??
    getYouTubeVideoIdFromUrl(webcast.file)
  );
}

export function isYouTubeEmbedCapableWebcast(webcast: EventMediaEntry | null | undefined): boolean {
  return Boolean(getYouTubeVideoIdFromWebcast(webcast));
}
