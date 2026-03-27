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
    const [status, pits, pitMap, inspection, announcements, partsRequests] = await Promise.all([
      nexusGet<Record<string, unknown>>(`/event/${encodeURIComponent(eventKey)}/status`),
      nexusGet<Record<string, unknown> | Record<string, unknown>[]>(
        `/event/${encodeURIComponent(eventKey)}/pits`,
      ),
      nexusGet<Record<string, unknown>>(`/event/${encodeURIComponent(eventKey)}/pit-map`),
      nexusGet<Record<string, unknown> | Record<string, unknown>[]>(
        `/event/${encodeURIComponent(eventKey)}/inspection`,
      ),
      nexusGet<Record<string, unknown> | Record<string, unknown>[]>(
        `/event/${encodeURIComponent(eventKey)}/announcements`,
      ),
      nexusGet<Record<string, unknown> | Record<string, unknown>[]>(
        `/event/${encodeURIComponent(eventKey)}/parts-requests`,
      ),
    ]);

    const pitRows = Array.isArray(pits)
      ? pits
      : Array.isArray(pits?.pits)
        ? (pits.pits as Record<string, unknown>[])
        : [];
    const inspectionRows = Array.isArray(inspection)
      ? inspection
      : Array.isArray(inspection?.items)
        ? (inspection.items as Record<string, unknown>[])
        : [];
    const announcementRows = Array.isArray(announcements)
      ? announcements
      : Array.isArray(announcements?.announcements)
        ? (announcements.announcements as Record<string, unknown>[])
        : [];
    const partsRows = Array.isArray(partsRequests)
      ? partsRequests
      : Array.isArray(partsRequests?.requests)
        ? (partsRequests.requests as Record<string, unknown>[])
        : [];

    return {
      supported: status?.supported === false ? false : true,
      status: sourceStatus(enabled, status, null),
      currentMatchKey: readNullableString(status?.current_match_key),
      nextMatchKey: readNullableString(status?.next_match_key),
      queueMatchesAway: Number.isFinite(Number(status?.queue_matches_away))
        ? Number(status.queue_matches_away)
        : null,
      queueText: readNullableString(status?.queue_text),
      pitMapUrl: readNullableString(pitMap?.image_url) ?? readNullableString(pitMap?.url),
      announcements: announcementRows.map(normalizeAnnouncement),
      partsRequests: partsRows.map(normalizePartsRequest),
      inspectionSummary: summarizeInspection(inspectionRows),
      pits: pitRows,
      raw: {
        status: status ?? null,
        pits: pitRows,
        pitMap: pitMap ?? null,
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
