import { getFirstApiEnv, hasFirstApiEnv } from './env';
import { cachedSourceJson } from './source-cache-server';
import type { OfficialEventSnapshot, SourceStatus } from './types';

function eventYear(eventKey: string): string {
  return String(eventKey).slice(0, 4);
}

function eventCode(eventKey: string): string {
  return String(eventKey).slice(4).toUpperCase();
}

function authHeader(): string {
  const env = getFirstApiEnv();
  return `Basic ${Buffer.from(`${env.FIRST_API_USERNAME}:${env.FIRST_API_AUTH_TOKEN}`).toString('base64')}`;
}

async function firstGet<T>(requestPath: string): Promise<T> {
  const env = getFirstApiEnv();
  return cachedSourceJson<T>(
    'first',
    requestPath,
    `${env.FIRST_API_BASE_URL}${requestPath}`,
    {
      headers: {
        Authorization: authHeader(),
      },
    },
    20,
  );
}

async function firstGetOptional<T>(requestPath: string): Promise<T | null> {
  try {
    return await firstGet<T>(requestPath);
  } catch {
    return null;
  }
}

function firstStatus(enabled: boolean, hasData: boolean, error: unknown = null): SourceStatus {
  if (!enabled) return 'disabled';
  if (hasData) return 'available';
  return error ? 'error' : 'available';
}

export async function loadOfficialEventSnapshot(
  eventKey: string,
): Promise<OfficialEventSnapshot | null> {
  const enabled = hasFirstApiEnv();
  if (!enabled) {
    return {
      status: 'disabled',
      event: null,
      matches: [],
      rankings: null,
      awards: [],
      district: null,
    };
  }

  const year = eventYear(eventKey);
  const code = eventCode(eventKey);

  try {
    const [events, matches, rankings, awards] = await Promise.all([
      firstGetOptional<Record<string, unknown>>(
        `/${year}/events?eventCode=${encodeURIComponent(code)}`,
      ),
      firstGetOptional<Record<string, unknown>>(`/${year}/matches/${encodeURIComponent(code)}`),
      firstGetOptional<Record<string, unknown>>(`/${year}/rankings/${encodeURIComponent(code)}`),
      firstGetOptional<Record<string, unknown>>(
        `/${year}/awards/event/${encodeURIComponent(code)}`,
      ),
    ]);

    const eventList = Array.isArray(events?.Events)
      ? (events.Events as Record<string, unknown>[])
      : [];
    const event = eventList[0] ?? null;
    const normalizedMatches = Array.isArray(matches?.Matches)
      ? (matches.Matches as Record<string, unknown>[])
      : [];
    const normalizedAwards = Array.isArray(awards?.Awards)
      ? (awards.Awards as Record<string, unknown>[])
      : [];
    const hasCoreData =
      Boolean(event) ||
      normalizedMatches.length > 0 ||
      Boolean(rankings) ||
      normalizedAwards.length > 0;

    return {
      status: firstStatus(enabled, hasCoreData),
      event,
      matches: normalizedMatches,
      rankings: rankings ?? null,
      awards: normalizedAwards,
      district: event
        ? {
            districtCode: event.districtCode ?? null,
            districtName: event.districtName ?? null,
            eventType: event.type ?? null,
            officialCode: code,
          }
        : null,
    };
  } catch {
    return {
      status: 'error',
      event: null,
      matches: [],
      rankings: null,
      awards: [],
      district: null,
    };
  }
}
