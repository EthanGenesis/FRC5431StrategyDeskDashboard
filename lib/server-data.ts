import { z } from 'zod';
import { loadOfficialEventSnapshot } from './first-api';
import {
  listEventLiveSignals,
  saveSnapshotCacheRecord,
  saveValidationSnapshot,
} from './source-cache-server';
import type {
  AppSnapshot,
  EventMediaEntry,
  EventMediaSnapshot,
  ExternalArray,
  ExternalRecord,
  LiveSignal,
  MatchSimple,
  SourceDiscrepancy,
  ValidationSnapshot,
} from './types';
import { getAppEnv } from './env';
import { loadNexusOpsSnapshot } from './nexus';
import { sbGet } from './statbotics';
import { tbaGet } from './tba';

export type LoadedEventContext = {
  tba: AppSnapshot['tba'];
  sb: AppSnapshot['sb'];
  official: AppSnapshot['official'];
  nexus: AppSnapshot['nexus'];
  media: AppSnapshot['media'];
  validation: AppSnapshot['validation'];
  liveSignals: AppSnapshot['liveSignals'];
};

const teamParamSchema = z.coerce.number().int().positive();
const eventKeySchema = z.string().trim().min(1);

const compareTeamsSchema = z
  .union([z.array(z.coerce.number().int().positive()), z.string(), z.null(), z.undefined()])
  .transform((value) => normalizeTeamList(value));

export function safeResolve<T>(promise: Promise<T>): Promise<T | null> {
  return promise.catch(() => null);
}

export function parsePositiveTeamNumber(value: unknown): number {
  return teamParamSchema.parse(value);
}

export function parseRequiredEventKey(value: unknown): string {
  return eventKeySchema.parse(value);
}

export function normalizeTeamList(rawTeams: unknown): number[] {
  const list = Array.isArray(rawTeams)
    ? rawTeams
    : typeof rawTeams === 'string'
      ? rawTeams.split(/[,\s]+/).filter(Boolean)
      : [];

  return Array.from(
    new Set(
      list
        .map((value) => Math.floor(Number(value)))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  );
}

export function parseCompareTeams(value: unknown): number[] {
  return compareTeamsSchema.parse(value);
}

function readString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function readNullableString(value: unknown): string | null {
  const normalized = readString(value).trim();
  return normalized.length ? normalized : null;
}

function buildWebcastUrl(type: string, channel: string, file: string | null): string | null {
  const normalizedType = String(type ?? '').toLowerCase();
  const normalizedChannel = String(channel ?? '').trim();
  const normalizedFile = String(file ?? '').trim();

  if (normalizedFile && /^https?:\/\//i.test(normalizedFile)) return normalizedFile;
  if (normalizedType === 'youtube' && normalizedChannel) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(normalizedChannel)}`;
  }
  if (normalizedType === 'twitch' && normalizedChannel) {
    return `https://www.twitch.tv/${encodeURIComponent(normalizedChannel)}`;
  }
  if (normalizedType === 'iframe' && normalizedChannel && /^https?:\/\//i.test(normalizedChannel)) {
    return normalizedChannel;
  }
  return null;
}

function buildWebcastEmbedUrl(type: string, channel: string, file: string | null): string | null {
  const normalizedType = String(type ?? '').toLowerCase();
  const normalizedChannel = String(channel ?? '').trim();
  const normalizedFile = String(file ?? '').trim();

  if (normalizedType === 'youtube' && normalizedChannel) {
    return `https://www.youtube.com/embed/${encodeURIComponent(normalizedChannel)}`;
  }
  if (normalizedType === 'iframe' && normalizedFile && /^https?:\/\//i.test(normalizedFile)) {
    return normalizedFile;
  }
  return null;
}

function buildEventMediaSnapshot(
  eventRecord: ExternalRecord | null,
  mediaRows: ExternalArray | null,
): EventMediaSnapshot {
  const webcasts = Array.isArray(eventRecord?.webcasts)
    ? (eventRecord.webcasts as ExternalArray)
    : [];

  const webcastEntries: EventMediaEntry[] = webcasts.map((entry) => {
    const type = readString(entry?.type, 'unknown');
    const channel = readString(entry?.channel);
    const file = readNullableString(entry?.file);
    return {
      type,
      channel,
      file,
      url: buildWebcastUrl(type, channel, file),
      embedUrl: buildWebcastEmbedUrl(type, channel, file),
    };
  });

  return {
    preferredWebcastUrl: webcastEntries.find((entry) => entry.url)?.url ?? null,
    webcasts: webcastEntries,
    media: Array.isArray(mediaRows) ? mediaRows : [],
  };
}

function renderComparableValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

function createDiscrepancy(
  key: string,
  label: string,
  workingValue: unknown,
  officialValue: unknown,
  detail: string | null = null,
): SourceDiscrepancy {
  const working = renderComparableValue(workingValue);
  const official = renderComparableValue(officialValue);

  if (working == null || official == null) {
    return {
      key,
      label,
      status: 'missing',
      workingValue: working,
      officialValue: official,
      detail,
    };
  }

  return {
    key,
    label,
    status: working === official ? 'match' : 'mismatch',
    workingValue: working,
    officialValue: official,
    detail,
  };
}

function buildValidationSnapshot(input: {
  eventKey: string;
  tbaEvent: ExternalRecord | null;
  tbaMatches: ExternalArray;
  tbaRankings: ExternalRecord | null;
  tbaAwards: ExternalArray;
  official: AppSnapshot['official'];
  nexus: AppSnapshot['nexus'];
  liveSignals: LiveSignal[];
}): ValidationSnapshot {
  const official = input.official;
  const firstStatus = official?.status ?? 'disabled';
  const nexusStatus = input.nexus?.status ?? 'disabled';

  const rankingCount = Array.isArray(input.tbaRankings?.rankings)
    ? input.tbaRankings.rankings.length
    : null;
  const officialRankingCount = Array.isArray(official?.rankings?.Rankings)
    ? official.rankings.Rankings.length
    : Array.isArray(official?.rankings?.rankings)
      ? official.rankings.rankings.length
      : null;

  const discrepancies: SourceDiscrepancy[] = [
    createDiscrepancy(
      'event_name',
      'Event name',
      input.tbaEvent?.name,
      official?.event?.name ?? official?.event?.nameShort,
      'TBA working event metadata vs FIRST official event metadata.',
    ),
    createDiscrepancy(
      'match_count',
      'Match count',
      input.tbaMatches.length,
      Array.isArray(official?.matches) ? official.matches.length : null,
      'Working schedule volume vs FIRST official schedule volume.',
    ),
    createDiscrepancy(
      'ranking_count',
      'Ranking rows',
      rankingCount,
      officialRankingCount,
      'Working rankings row count vs FIRST official rankings row count.',
    ),
    createDiscrepancy(
      'award_count',
      'Awards',
      input.tbaAwards.length,
      Array.isArray(official?.awards) ? official.awards.length : null,
      'Working award count vs FIRST official awards count.',
    ),
  ];

  const mismatchCount = discrepancies.filter((item) => item.status === 'mismatch').length;
  const missingCount = discrepancies.filter((item) => item.status === 'missing').length;
  const lastSignal = input.liveSignals[0] ?? null;
  const staleSeconds =
    lastSignal && Number.isFinite(Number(lastSignal.createdAtMs))
      ? Math.max(0, Math.round((Date.now() - Number(lastSignal.createdAtMs)) / 1000))
      : null;

  const summary =
    mismatchCount > 0
      ? `${mismatchCount} official discrepancy${mismatchCount === 1 ? '' : 'ies'}`
      : missingCount > 0
        ? `${missingCount} official comparison gap${missingCount === 1 ? '' : 's'}`
        : 'Working and official overlap checks are aligned';

  return {
    generatedAtMs: Date.now(),
    firstStatus,
    nexusStatus,
    discrepancies,
    staleSeconds,
    officialTimestamp: readNullableString(official?.event?.dateStart),
    summary,
  };
}

function normalizeLiveSignals(rows: Record<string, unknown>[]): LiveSignal[] {
  return rows.map((row) => ({
    id: readString(row.id),
    workspaceKey: readString(row.workspace_key),
    eventKey: readString(row.event_key),
    source: readString(row.source, 'system'),
    signalType: readString(row.signal_type, 'signal'),
    title: readString(row.title, 'Signal'),
    body: readString(row.body),
    dedupeKey: readNullableString(row.dedupe_key),
    createdAtMs: Date.parse(
      readString(row.created_at ?? row.updated_at ?? Date.now(), String(Date.now())),
    ),
    payload:
      row.payload && typeof row.payload === 'object'
        ? (row.payload as Record<string, unknown>)
        : null,
  }));
}

export async function loadEventContext(eventKey: string): Promise<LoadedEventContext> {
  const { TBA_AUTH_KEY } = getAppEnv();

  const [
    event,
    matches,
    rankings,
    oprs,
    alliances,
    status,
    insights,
    awards,
    teams,
    teamStatuses,
    media,
    sbMatches,
    sbTeamEvents,
    sbTeamMatches,
    official,
    nexus,
    liveSignalsRaw,
  ] = await Promise.all([
    safeResolve(tbaGet<ExternalRecord>(`/event/${eventKey}`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<MatchSimple[]>(`/event/${eventKey}/matches`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalRecord>(`/event/${eventKey}/rankings`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalRecord>(`/event/${eventKey}/oprs`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalRecord>(`/event/${eventKey}/alliances`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalRecord>(`/event/${eventKey}/status`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalRecord>(`/event/${eventKey}/insights`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalArray>(`/event/${eventKey}/awards`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalArray>(`/event/${eventKey}/teams/simple`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalRecord>(`/event/${eventKey}/teams/statuses`, TBA_AUTH_KEY)),
    safeResolve(tbaGet<ExternalArray>(`/event/${eventKey}/media`, TBA_AUTH_KEY)),
    safeResolve(
      sbGet<ExternalArray>(`/matches?event=${encodeURIComponent(eventKey)}&limit=1000&offset=0`),
    ),
    safeResolve(
      sbGet<ExternalArray>(
        `/team_events?event=${encodeURIComponent(eventKey)}&limit=1000&offset=0`,
      ),
    ),
    safeResolve(
      sbGet<ExternalArray>(
        `/team_matches?event=${encodeURIComponent(eventKey)}&limit=1000&offset=0`,
      ),
    ),
    safeResolve(loadOfficialEventSnapshot(eventKey)),
    safeResolve(loadNexusOpsSnapshot(eventKey)),
    safeResolve(listEventLiveSignals(eventKey)),
  ]);

  const normalizedLiveSignals = normalizeLiveSignals(liveSignalsRaw ?? []);
  const validation = buildValidationSnapshot({
    eventKey,
    tbaEvent: event ?? null,
    tbaMatches: matches ?? [],
    tbaRankings: rankings ?? null,
    tbaAwards: awards ?? [],
    official: official ?? null,
    nexus: nexus ?? null,
    liveSignals: normalizedLiveSignals,
  });
  const mediaSnapshot = buildEventMediaSnapshot(event ?? null, media ?? []);

  void saveValidationSnapshot(eventKey, validation as Record<string, unknown>);
  void saveSnapshotCacheRecord({
    source: 'event_context',
    eventKey,
    teamNumber: null,
    generatedAt: validation.generatedAtMs,
    payload: {
      tba: {
        event: event ?? null,
        matchCount: (matches ?? []).length,
      },
      official: official ?? null,
      nexus: nexus ?? null,
      media: mediaSnapshot,
      validation,
    },
  });

  return {
    tba: {
      event: event ?? null,
      matches: matches ?? [],
      rankings: rankings ?? null,
      oprs: oprs ?? null,
      alliances: alliances ?? null,
      status: status ?? null,
      insights: insights ?? null,
      awards: awards ?? [],
      teams: teams ?? [],
      teamStatuses: teamStatuses ?? null,
    },
    sb: {
      matches: sbMatches ?? [],
      teamEvents: sbTeamEvents ?? [],
      teamMatches: sbTeamMatches ?? [],
    },
    official: official ?? null,
    nexus: nexus ?? null,
    media: mediaSnapshot,
    validation,
    liveSignals: normalizedLiveSignals,
  };
}
