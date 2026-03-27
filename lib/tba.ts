import { cachedSourceJson } from './source-cache-server';

const TBA_BASE = 'https://www.thebluealliance.com/api/v3';

export async function tbaGet<T = unknown>(path: string, authKey: string): Promise<T> {
  return cachedSourceJson<T>(
    'tba',
    path,
    `${TBA_BASE}${path}`,
    {
      headers: {
        'X-TBA-Auth-Key': authKey,
      },
    },
    5,
  );
}
