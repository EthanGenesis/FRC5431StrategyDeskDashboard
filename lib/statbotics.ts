import { cachedFetchJson } from './httpCache';

const SB_BASE = 'https://api.statbotics.io/v3';

export async function sbGet<T = unknown>(path: string): Promise<T> {
  return cachedFetchJson<T>(`${SB_BASE}${path}`, undefined, 20);
}
