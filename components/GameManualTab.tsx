'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import { fetchJsonOrThrow } from '../lib/httpCache';
import type {
  GameManualSearchResult,
  GameManualSection,
  GameManualSnapshot,
  GameManualTocItem,
} from '../lib/types';
import { useDashboardPreferences } from './providers/DashboardPreferencesProvider';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeSearch(value: string): string[] {
  return value.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function buildSnippet(text: string, tokens: string[]): string {
  if (!tokens.length) return text.slice(0, 160);

  const lowered = text.toLowerCase();
  const firstMatchIndex = tokens.reduce((bestIndex, token) => {
    const matchIndex = lowered.indexOf(token);
    if (matchIndex < 0) return bestIndex;
    if (bestIndex < 0) return matchIndex;
    return Math.min(bestIndex, matchIndex);
  }, -1);

  if (firstMatchIndex < 0) {
    return text.slice(0, 160);
  }

  const start = Math.max(0, firstMatchIndex - 60);
  const end = Math.min(text.length, firstMatchIndex + 100);
  const prefix = start > 0 ? '... ' : '';
  const suffix = end < text.length ? ' ...' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function highlightPlainText(text: string, tokens: string[]): string {
  const escaped = escapeHtml(text);
  if (!tokens.length) return escaped;
  const regex = new RegExp(`(${tokens.map(escapeRegex).join('|')})`, 'gi');
  return escaped.replace(regex, '<mark>$1</mark>');
}

function highlightHtml(html: string, tokens: string[]): string {
  if (!tokens.length) return html;
  const regex = new RegExp(`(${tokens.map(escapeRegex).join('|')})`, 'gi');
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith('<') ? part : part.replace(regex, '<mark>$1</mark>')))
    .join('');
}

export default function GameManualTab(): ReactElement {
  const { formatDateTime, t } = useDashboardPreferences();
  const [snapshot, setSnapshot] = useState<GameManualSnapshot | null>(null);
  const [errorText, setErrorText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(searchInput);
  const sectionElementsRef = useRef<Record<string, HTMLElement | null>>({});

  const loadSnapshot = useCallback(async () => {
    setIsLoading(true);
    setErrorText('');

    try {
      const json = await fetchJsonOrThrow<GameManualSnapshot>(
        '/api/game-manual',
        { cache: 'default' },
        'Game manual failed to load',
      );
      setSnapshot(json);
      setActiveSectionId(json.sections[0]?.id ?? null);
    } catch (error) {
      setSnapshot(null);
      setErrorText(error instanceof Error ? error.message : 'Unknown game manual error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const searchTokens = useMemo(() => tokenizeSearch(deferredSearch), [deferredSearch]);
  const searchResults = useMemo<GameManualSearchResult[]>(() => {
    if (!snapshot || !searchTokens.length) return [];

    return snapshot.sections
      .filter((section) => {
        const haystack = `${section.title} ${section.text}`.toLowerCase();
        return searchTokens.every((token) => haystack.includes(token));
      })
      .map((section) => ({
        id: section.id,
        title: section.title,
        number: section.number,
        level: section.level,
        snippet: buildSnippet(section.text, searchTokens),
      }));
  }, [searchTokens, snapshot]);

  const visibleSections = useMemo<GameManualSection[]>(() => {
    if (!snapshot) return [];
    if (!searchTokens.length) return snapshot.sections;
    const visibleIds = new Set(searchResults.map((result) => result.id));
    return snapshot.sections.filter((section) => visibleIds.has(section.id));
  }, [searchResults, searchTokens, snapshot]);

  const sidebarItems = useMemo<(GameManualTocItem | GameManualSearchResult)[]>(() => {
    if (!snapshot) return [];
    return searchTokens.length ? searchResults : snapshot.toc;
  }, [searchResults, searchTokens.length, snapshot]);

  const jumpToSection = useCallback((sectionId: string) => {
    setActiveSectionId(sectionId);
    requestAnimationFrame(() => {
      sectionElementsRef.current[sectionId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }, []);

  const lastModifiedText = useMemo(() => {
    if (!snapshot?.lastModified) return '-';
    const date = new Date(snapshot.lastModified);
    if (!Number.isFinite(date.getTime())) return snapshot.lastModified;
    return formatDateTime(date, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [formatDateTime, snapshot?.lastModified]);

  return (
    <div className="stack-12">
      <div className="panel reference-hero">
        <div className="reference-hero-header">
          <div>
            <div className="reference-title">
              {snapshot?.title ?? t('game_manual.default_title', '2026 FRC Game Manual')}
            </div>
            <div className="reference-summary">
              {t(
                'game_manual.summary',
                'Official FIRST game manual embedded as a searchable in-app reader.',
              )}
            </div>
            <div className="reference-status">
              {t('game_manual.last_updated', 'Last updated: {{value}}', {
                value: lastModifiedText,
              })}
            </div>
          </div>
          <div className="reference-link-group">
            <a
              className="button"
              href={snapshot?.sourceUrl ?? '#'}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t('game_manual.open_html', 'Open Official HTML')}
            </a>
            <a
              className="button"
              href={snapshot?.pdfUrl ?? '#'}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t('game_manual.open_pdf', 'Open Official PDF')}
            </a>
          </div>
        </div>
      </div>

      <div className="panel reference-toolbar">
        <div className="reference-toolbar-row">
          <input
            className="input"
            value={searchInput}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchInput(event.target.value)}
            placeholder={t('game_manual.search_placeholder', 'Search the 2026 game manual')}
            style={{ width: 320, maxWidth: '100%' }}
          />
          <div className="reference-status" style={{ marginTop: 0 }}>
            {searchTokens.length
              ? t('game_manual.matching_sections', '{{count}} matching sections', {
                  count: searchResults.length,
                })
              : t('game_manual.sections_loaded', '{{count}} sections loaded', {
                  count: snapshot?.sections.length ?? 0,
                })}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="panel reference-toolbar">
          {t('game_manual.loading', 'Loading game manual...')}
        </div>
      ) : null}

      {errorText ? (
        <div className="panel reference-toolbar" style={{ borderColor: '#7f1d1d' }}>
          <div className="reference-title" style={{ fontSize: 20 }}>
            {t('game_manual.unavailable', 'Game Manual Unavailable')}
          </div>
          <div className="reference-summary">{errorText}</div>
          <div className="reference-link-group" style={{ marginTop: 12 }}>
            <a
              className="button"
              href="https://firstfrc.blob.core.windows.net/frc2026/Manual/HTML/2026GameManual.htm"
              target="_blank"
              rel="noreferrer noopener"
            >
              {t('game_manual.open_html', 'Open Official HTML')}
            </a>
            <a
              className="button"
              href="https://firstfrc.blob.core.windows.net/frc2026/Manual/2026GameManual.pdf"
              target="_blank"
              rel="noreferrer noopener"
            >
              {t('game_manual.open_pdf', 'Open Official PDF')}
            </a>
          </div>
        </div>
      ) : null}

      {snapshot ? (
        <div className="reference-layout">
          <div className="panel reference-rail">
            <div className="reference-rail-header">
              {searchTokens.length
                ? t('game_manual.search_results', 'Search Results')
                : t('game_manual.toc', 'Table Of Contents')}
            </div>
            <div className="reference-rail-list">
              {sidebarItems.map((item) => (
                <button
                  key={item.id}
                  className={`tab-button reference-rail-button ${activeSectionId === item.id ? 'active' : ''}`}
                  style={{
                    paddingLeft: 12 + Math.max(0, item.level - 1) * 12,
                  }}
                  onClick={() => jumpToSection(item.id)}
                >
                  <div>
                    <div
                      dangerouslySetInnerHTML={{
                        __html: highlightPlainText(item.title, searchTokens),
                      }}
                    />
                    {'snippet' in item ? (
                      <div
                        className="reference-rail-snippet"
                        dangerouslySetInnerHTML={{
                          __html: highlightPlainText(item.snippet, searchTokens),
                        }}
                      />
                    ) : null}
                  </div>
                </button>
              ))}
              {!sidebarItems.length ? (
                <div className="muted">
                  {t(
                    'game_manual.no_results',
                    'No manual sections matched your search. Try a broader term.',
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="stack-12 reference-content">
            {visibleSections.map((section) => (
              <article
                key={section.id}
                ref={(element) => {
                  sectionElementsRef.current[section.id] = element;
                }}
                className={`panel reference-article ${activeSectionId === section.id ? 'active' : ''}`}
              >
                <div className="reference-article-title">{section.title}</div>
                <div
                  className="reference-richtext"
                  dangerouslySetInnerHTML={{
                    __html: highlightHtml(section.html, searchTokens),
                  }}
                />
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
