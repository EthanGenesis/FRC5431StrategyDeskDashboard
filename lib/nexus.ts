import { getNexusEnv, hasNexusEnv } from './env';
import { cachedSourceJson } from './source-cache-server';
import type {
  NexusAnnouncement,
  NexusInspectionSummary,
  NexusOpsSnapshot,
  NexusPartsRequest,
  SourceStatus,
} from './types';

function readString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function readNullableString(value: unknown): string | null {
  const normalized = readString(value).trim();
  return normalized.length ? normalized : null;
}

async function nexusGet<T>(requestPath: string): Promise<T> {
  const env = getNexusEnv();
  return cachedSourceJson<T>(
    'nexus',
    requestPath,
    `${env.NEXUS_API_BASE_URL}${requestPath}`,
    {
      headers: {
        'Nexus-Api-Key': env.NEXUS_API_KEY,
      },
    },
    10,
  );
}

async function nexusGetOptional<T>(requestPath: string): Promise<T | null> {
  try {
    return await nexusGet<T>(requestPath);
  } catch {
    return null;
  }
}

function normalizeAnnouncement(item: Record<string, unknown>, index: number): NexusAnnouncement {
  return {
    id: readString(item.id ?? item.uuid ?? index, String(index)),
    title: readString(item.title ?? item.heading, 'Announcement'),
    body: readString(item.body ?? item.message),
    createdAtMs: Number.isFinite(Number(item.created_at ?? item.createdAt))
      ? Number(item.created_at ?? item.createdAt)
      : null,
  };
}

function normalizePartsRequest(item: Record<string, unknown>, index: number): NexusPartsRequest {
  return {
    id: readString(item.id ?? item.uuid ?? index, String(index)),
    teamNumber: Number.isFinite(Number(item.team_number ?? item.teamNumber))
      ? Number(item.team_number ?? item.teamNumber)
      : null,
    pitId: readNullableString(item.pit_id) ?? readNullableString(item.pitId),
    text: readString(item.text ?? item.request ?? item.description),
    status: readNullableString(item.status),
  };
}

function summarizeInspection(items: Record<string, unknown>[]): NexusInspectionSummary | null {
  if (!items.length) return null;

  let passed = 0;
  let pending = 0;
  let failed = 0;

  for (const item of items) {
    const status = readString(item.status ?? item.state).toLowerCase();
    if (status.includes('pass') || status.includes('complete')) passed += 1;
    else if (status.includes('fail')) failed += 1;
    else pending += 1;
  }

  return { passed, pending, failed };
}

function sourceStatus(
  enabled: boolean,
  rawStatus: Record<string, unknown> | null,
  error: unknown,
): SourceStatus {
  if (!enabled) return 'disabled';
  if (error) return 'error';
  if (rawStatus?.supported === false) return 'unsupported';
  return 'available';
}

function readNexusArray(value: unknown, fallbackKey?: string): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (
    fallbackKey &&
    value &&
    typeof value === 'object' &&
    Array.isArray((value as Record<string, unknown>)[fallbackKey])
  ) {
    return (value as Record<string, unknown>)[fallbackKey] as Record<string, unknown>[];
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
    );
  }
  return [];
}

function deriveQueueSummary(matches: Record<string, unknown>[]) {
  const normalizedMatches = matches
    .map((item) => ({
      label: readString(item.label, 'Match'),
      status: readString(item.status, 'Unknown'),
    }))
    .filter((item) => item.label.trim().length > 0);

  const active =
    normalizedMatches.find((item) => /on field|playing|in progress/i.test(item.status)) ??
    normalizedMatches.find((item) => /queue|queued|on deck/i.test(item.status)) ??
    normalizedMatches[0] ??
    null;

  const next =
    active == null
      ? (normalizedMatches[0] ?? null)
      : (normalizedMatches.find((item) => item.label !== active.label) ?? null);

  return {
    currentMatchKey: active?.label ?? null,
    nextMatchKey: next?.label ?? null,
    queueText: active ? `${active.status}: ${active.label}` : null,
  };
}

export async function loadNexusOpsSnapshot(eventKey: string): Promise<NexusOpsSnapshot | null> {
  const enabled = hasNexusEnv();
  if (!enabled) {
    return {
      supported: false,
      status: 'disabled',
      currentMatchKey: null,
      nextMatchKey: null,
      queueMatchesAway: null,
      queueText: null,
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
    };
  }

  let error: unknown = null;

  try {
    const [eventState, pits, pitMap, inspection] = await Promise.all([
      nexusGet<Record<string, unknown>>(`/event/${encodeURIComponent(eventKey)}`),
      nexusGetOptional<Record<string, unknown> | Record<string, unknown>[]>(
        `/event/${encodeURIComponent(eventKey)}/pits`,
      ),
      nexusGetOptional<Record<string, unknown> | string>(
        `/event/${encodeURIComponent(eventKey)}/map`,
      ),
      nexusGetOptional<Record<string, unknown> | Record<string, unknown>[]>(
        `/event/${encodeURIComponent(eventKey)}/inspection`,
      ),
    ]);

    const statusRecord = eventState ?? null;
    const matchRows = readNexusArray(eventState?.matches);
    const announcementRows = readNexusArray(eventState?.announcements, 'announcements');
    const partsRows = readNexusArray(eventState?.partsRequests, 'partsRequests');
    const pitRows = readNexusArray(pits, 'pits');
    const inspectionRows = readNexusArray(inspection, 'items');
    const queueSummary = deriveQueueSummary(matchRows);
    const pitMapRecord = pitMap && typeof pitMap === 'object' ? pitMap : null;
    const rawPitMap = pitMapRecord ?? (typeof pitMap === 'string' ? { url: pitMap } : null);
    const pitMapUrl =
      (typeof pitMap === 'string' ? readNullableString(pitMap) : null) ??
      readNullableString(pitMapRecord?.image_url) ??
      readNullableString(pitMapRecord?.url);

    return {
      supported: true,
      status: sourceStatus(enabled, statusRecord, null),
      currentMatchKey: queueSummary.currentMatchKey,
      nextMatchKey: queueSummary.nextMatchKey,
      queueMatchesAway: null,
      queueText: queueSummary.queueText,
      pitMapUrl,
      announcements: announcementRows.map(normalizeAnnouncement),
      partsRequests: partsRows.map(normalizePartsRequest),
      inspectionSummary: summarizeInspection(inspectionRows),
      pits: pitRows,
      raw: {
        status: statusRecord,
        pits: pitRows,
        pitMap: rawPitMap,
        inspection: inspectionRows,
        announcements: announcementRows,
        partsRequests: partsRows,
      },
    };
  } catch (caughtError) {
    error = caughtError;
  }

  return {
    supported: false,
    status: sourceStatus(enabled, null, error),
    currentMatchKey: null,
    nextMatchKey: null,
    queueMatchesAway: null,
    queueText: null,
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
  };
}
