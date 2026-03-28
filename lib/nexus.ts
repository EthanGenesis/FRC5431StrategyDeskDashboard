import { getNexusEnv, hasNexusEnv } from './env';
import { cachedSourceJson } from './source-cache-server';
import type {
  NexusAnnouncement,
  NexusInspectionSummary,
  NexusMatchStatus,
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

async function nexusGetOptionalDetailed<T>(
  requestPath: string,
): Promise<{ data: T | null; status: SourceStatus }> {
  try {
    return {
      data: await nexusGet<T>(requestPath),
      status: 'available',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return {
      data: null,
      status: message.includes('404') ? 'unsupported' : 'error',
    };
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

function normalizeTeamList(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.floor(value));
}

function normalizeMatchTimes(value: unknown) {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const readTime = (key: string) =>
    Number.isFinite(Number(record[key])) ? Number(record[key]) : null;

  return {
    estimatedQueueTimeMs: readTime('estimatedQueueTime'),
    estimatedOnDeckTimeMs: readTime('estimatedOnDeckTime'),
    estimatedOnFieldTimeMs: readTime('estimatedOnFieldTime'),
    estimatedStartTimeMs: readTime('estimatedStartTime'),
    actualQueueTimeMs: readTime('actualQueueTime'),
    actualOnDeckTimeMs: readTime('actualOnDeckTime'),
    actualOnFieldTimeMs: readTime('actualOnFieldTime'),
    actualStartTimeMs: readTime('actualStartTime'),
  };
}

function normalizeMatchRow(item: Record<string, unknown>): NexusMatchStatus {
  return {
    label: readString(item.label, 'Match'),
    status: readString(item.status, 'Unknown'),
    redTeams: normalizeTeamList(item.redTeams ?? item.red_teams ?? item.red),
    blueTeams: normalizeTeamList(item.blueTeams ?? item.blue_teams ?? item.blue),
    times: normalizeMatchTimes(item.times),
  };
}

function normalizeTeamValueMap(value: unknown, valueKeys: string[]): Record<string, string> {
  const out: Record<string, string> = {};

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const record = item as Record<string, unknown>;
      const teamKey = readNullableString(
        record.team_number ?? record.teamNumber ?? record.team ?? record.key ?? index,
      );
      const resolvedValue =
        valueKeys.map((key) => readNullableString(record[key])).find(Boolean) ?? null;
      if (teamKey && resolvedValue) out[teamKey.replace(/^frc/i, '')] = resolvedValue;
    });
    return out;
  }

  if (!value || typeof value !== 'object') return out;

  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      const resolved = readNullableString(item);
      if (resolved) out[key.replace(/^frc/i, '')] = resolved;
      return;
    }
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const resolvedValue =
        valueKeys.map((candidate) => readNullableString(record[candidate])).find(Boolean) ??
        readNullableString(record.value);
      if (resolvedValue) out[key.replace(/^frc/i, '')] = resolvedValue;
    }
  });

  return out;
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

function deriveQueueSummary(matches: NexusMatchStatus[]) {
  const normalizedMatches = matches.filter((item) => item.label.trim().length > 0);

  const active =
    normalizedMatches.find((item) => /on field|playing|in progress/i.test(item.status)) ??
    normalizedMatches.find((item) => /queue|queued|on deck/i.test(item.status)) ??
    normalizedMatches[0] ??
    null;

  const next =
    active == null
      ? (normalizedMatches[0] ?? null)
      : (normalizedMatches.find((item) => item.label !== active.label) ?? null);
  const activeIndex = active
    ? normalizedMatches.findIndex((item) => item.label === active.label)
    : -1;
  const nextIndex = next ? normalizedMatches.findIndex((item) => item.label === next.label) : -1;

  return {
    currentMatchKey: active?.label ?? null,
    nextMatchKey: next?.label ?? null,
    queueMatchesAway:
      activeIndex >= 0 && nextIndex >= 0 ? Math.max(0, nextIndex - activeIndex) : null,
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
      pitsStatus: 'disabled',
      inspectionStatus: 'disabled',
      pitMapStatus: 'disabled',
      announcements: [],
      partsRequests: [],
      inspectionSummary: null,
      pits: [],
      matches: [],
      pitAddressByTeam: {},
      inspectionByTeam: {},
      loadedTeamOps: null,
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
    const [eventState, pitsResult, pitMapResult, inspectionResult] = await Promise.all([
      nexusGet<Record<string, unknown>>(`/event/${encodeURIComponent(eventKey)}`),
      nexusGetOptionalDetailed<Record<string, unknown> | Record<string, unknown>[]>(
        `/event/${encodeURIComponent(eventKey)}/pits`,
      ),
      nexusGetOptionalDetailed<Record<string, unknown> | string>(
        `/event/${encodeURIComponent(eventKey)}/map`,
      ),
      nexusGetOptionalDetailed<Record<string, unknown> | Record<string, unknown>[]>(
        `/event/${encodeURIComponent(eventKey)}/inspection`,
      ),
    ]);

    const statusRecord = eventState ?? null;
    const matchRows = readNexusArray(eventState?.matches).map(normalizeMatchRow);
    const announcementRows = readNexusArray(eventState?.announcements, 'announcements');
    const partsRows = readNexusArray(eventState?.partsRequests, 'partsRequests');
    const pitRows = readNexusArray(pitsResult.data, 'pits');
    const inspectionRows = readNexusArray(inspectionResult.data, 'items');
    const queueSummary = deriveQueueSummary(matchRows);
    const pitMap = pitMapResult.data;
    const pitMapRecord = pitMap && typeof pitMap === 'object' ? pitMap : null;
    const rawPitMap = pitMapRecord ?? (typeof pitMap === 'string' ? { url: pitMap } : null);
    const pitMapUrl =
      (typeof pitMap === 'string' ? readNullableString(pitMap) : null) ??
      readNullableString(pitMapRecord?.image_url) ??
      readNullableString(pitMapRecord?.url);
    const pitAddressByTeam = normalizeTeamValueMap(pitsResult.data, [
      'pit',
      'pitAddress',
      'address',
      'pit_id',
      'pitId',
      'label',
      'text',
    ]);
    const inspectionByTeam = normalizeTeamValueMap(inspectionResult.data, [
      'status',
      'state',
      'inspectionStatus',
      'inspection_state',
      'label',
      'text',
    ]);

    return {
      supported: true,
      status: sourceStatus(enabled, statusRecord, null),
      currentMatchKey: queueSummary.currentMatchKey,
      nextMatchKey: queueSummary.nextMatchKey,
      queueMatchesAway: queueSummary.queueMatchesAway,
      queueText: queueSummary.queueText,
      pitMapUrl,
      pitsStatus: pitsResult.status,
      inspectionStatus: inspectionResult.status,
      pitMapStatus: pitMapResult.status,
      announcements: announcementRows.map(normalizeAnnouncement),
      partsRequests: partsRows.map(normalizePartsRequest),
      inspectionSummary:
        summarizeInspection(inspectionRows) ??
        summarizeInspection(
          Object.values(inspectionByTeam).map((status) => ({
            status,
          })),
        ),
      pits: pitRows,
      matches: matchRows,
      pitAddressByTeam,
      inspectionByTeam,
      loadedTeamOps: null,
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
    pitsStatus: 'error',
    inspectionStatus: 'error',
    pitMapStatus: 'error',
    announcements: [],
    partsRequests: [],
    inspectionSummary: null,
    pits: [],
    matches: [],
    pitAddressByTeam: {},
    inspectionByTeam: {},
    loadedTeamOps: null,
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
