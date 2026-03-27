import { load } from 'cheerio';

import type { GameManualSection, GameManualSnapshot, GameManualTocItem } from './types';

export const GAME_MANUAL_HTML_URL =
  'https://firstfrc.blob.core.windows.net/frc2026/Manual/HTML/2026GameManual.htm';
export const GAME_MANUAL_PDF_URL =
  'https://firstfrc.blob.core.windows.net/frc2026/Manual/2026GameManual.pdf';

const GAME_MANUAL_TITLE = '2026 FRC Game Manual';
const GAME_MANUAL_TTL_MS = 1000 * 60 * 60;
const MANUAL_ASSET_BASE_URL = new URL('./', GAME_MANUAL_HTML_URL).toString();
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4']);
const ALLOWED_TAGS = new Set([
  'p',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'a',
  'img',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'sub',
  'sup',
  'br',
  'hr',
  'blockquote',
  'div',
]);

type ManualCacheEntry = {
  snapshot: GameManualSnapshot;
  expiresAtMs: number;
};

let gameManualCache: ManualCacheEntry | null = null;

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sectionNumberFromTitle(title: string): string | null {
  const match = /^\d+(?:\.\d+)*/.exec(normalizeWhitespace(title));
  return match?.[0] ?? null;
}

function absoluteManualUrl(value: string | undefined): string | null {
  const href = String(value ?? '').trim();
  if (!href) return null;
  if (
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('data:')
  ) {
    return href;
  }
  if (href.startsWith('#')) return href;
  return new URL(href, MANUAL_ASSET_BASE_URL).toString();
}

function cleanupManualHtml(fragmentHtml: string): { html: string; text: string } {
  const $ = load(`<div data-root="manual">${fragmentHtml}</div>`);
  const root = $('div[data-root="manual"]');

  root.find('script,style,meta,link,title,head,html,body').remove();
  root.find('o\\:p').remove();
  root.contents().each((_, node) => {
    if (String(node.type) === 'comment') $(node).remove();
  });

  root.find('*').each((_, element) => {
    const tagName = element.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tagName)) {
      $(element).replaceWith($(element).contents());
      return;
    }

    const attributes = { ...(element.attribs ?? {}) };
    Object.keys(attributes).forEach((attributeName) => {
      const attribute = attributeName.toLowerCase();
      const keepAttribute =
        (tagName === 'a' && ['href', 'target', 'rel'].includes(attribute)) ||
        (tagName === 'img' && ['src', 'alt', 'width', 'height'].includes(attribute)) ||
        (['th', 'td'].includes(tagName) && ['colspan', 'rowspan'].includes(attribute));

      if (!keepAttribute) {
        $(element).removeAttr(attributeName);
      }
    });

    if (tagName === 'a') {
      const href = absoluteManualUrl($(element).attr('href'));
      if (!href || href.startsWith('#')) {
        $(element).replaceWith($(element).contents());
        return;
      }
      $(element).attr('href', href);
      $(element).attr('target', '_blank');
      $(element).attr('rel', 'noreferrer noopener');
    }

    if (tagName === 'img') {
      const src = absoluteManualUrl($(element).attr('src'));
      if (!src) {
        $(element).remove();
        return;
      }
      $(element).attr('src', src);
      if (!$(element).attr('alt')) {
        $(element).attr('alt', 'Game manual figure');
      }
    }
  });

  const cleanedHtml = (root.html() ?? '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    html: cleanedHtml,
    text: normalizeWhitespace(root.text()),
  };
}

function buildSectionsAndToc(rawHtml: string): {
  sections: GameManualSection[];
  toc: GameManualTocItem[];
} {
  const $ = load(rawHtml);
  const body = $('body');
  const bodyChildren = body.children().toArray();

  const sections: GameManualSection[] = [];
  let sectionIndex = 0;
  let currentSection: {
    id: string;
    title: string;
    number: string | null;
    level: 1 | 2 | 3 | 4;
    chunks: string[];
  } | null = null;

  const finalizeCurrentSection = () => {
    if (!currentSection) return;
    const cleaned = cleanupManualHtml(currentSection.chunks.join(''));
    if (!currentSection.title || !cleaned.text) {
      currentSection = null;
      return;
    }
    sections.push({
      id: currentSection.id,
      title: currentSection.title,
      number: currentSection.number,
      level: currentSection.level,
      html: cleaned.html,
      text: cleaned.text,
    });
    currentSection = null;
  };

  for (const node of bodyChildren) {
    if (String(node.type) !== 'tag') continue;
    const tagName = node.tagName.toLowerCase();

    if (HEADING_TAGS.has(tagName)) {
      finalizeCurrentSection();
      sectionIndex += 1;
      const heading = $(node);
      const anchorNames = heading
        .find('a[name]')
        .map((_, anchor) => String($(anchor).attr('name') ?? '').trim())
        .get()
        .filter(Boolean);
      const id =
        anchorNames.find((value) => value.startsWith('_Toc')) ??
        anchorNames[0] ??
        `manual-section-${sectionIndex}`;
      const title = normalizeWhitespace(heading.text());
      currentSection = {
        id,
        title,
        number: sectionNumberFromTitle(title),
        level: Number(tagName.slice(1)) as 1 | 2 | 3 | 4,
        chunks: [],
      };
      continue;
    }

    if (!currentSection) continue;
    currentSection.chunks.push($.html(node) ?? '');
  }

  finalizeCurrentSection();

  const sectionIds = new Set(sections.map((section) => section.id));
  const toc = body
    .find('p[class^="MsoToc"] a[href^="#"]')
    .map((_, anchor) => {
      const anchorElement = $(anchor);
      const href = String(anchorElement.attr('href') ?? '').trim();
      const id = href.replace(/^#/, '');
      if (!sectionIds.has(id)) return null;
      const containerClass = String(anchorElement.parent().attr('class') ?? '');
      const levelMatch = /MsoToc(\d+)/i.exec(containerClass);
      const title = normalizeWhitespace(anchorElement.text());
      return {
        id,
        title,
        number: sectionNumberFromTitle(title),
        level: levelMatch ? Number(levelMatch[1]) : 1,
      } satisfies GameManualTocItem;
    })
    .get()
    .filter((item): item is GameManualTocItem => item != null);

  const fallbackToc =
    toc.length > 0
      ? toc
      : sections.map((section) => ({
          id: section.id,
          title: section.title,
          number: section.number,
          level: section.level,
        }));

  return { sections, toc: fallbackToc };
}

export function decodeGameManualBuffer(buffer: ArrayBuffer): string {
  return new TextDecoder('macintosh').decode(new Uint8Array(buffer));
}

export function parseGameManualHtml(
  rawHtml: string,
  lastModified: string | null,
): GameManualSnapshot {
  const { sections, toc } = buildSectionsAndToc(rawHtml);

  return {
    fetchedAtMs: Date.now(),
    title: GAME_MANUAL_TITLE,
    sourceUrl: GAME_MANUAL_HTML_URL,
    pdfUrl: GAME_MANUAL_PDF_URL,
    lastModified,
    sections,
    toc,
  };
}

export async function loadGameManualSnapshot(): Promise<GameManualSnapshot> {
  const now = Date.now();
  if (gameManualCache && gameManualCache.expiresAtMs > now) {
    return gameManualCache.snapshot;
  }

  const response = await fetch(GAME_MANUAL_HTML_URL, {
    next: { revalidate: Math.floor(GAME_MANUAL_TTL_MS / 1000) },
  });

  if (!response.ok) {
    throw new Error(`Game manual fetch failed with status ${response.status}`);
  }

  const rawHtml = decodeGameManualBuffer(await response.arrayBuffer());
  const snapshot = parseGameManualHtml(rawHtml, response.headers.get('last-modified'));
  gameManualCache = {
    snapshot,
    expiresAtMs: now + GAME_MANUAL_TTL_MS,
  };
  return snapshot;
}
