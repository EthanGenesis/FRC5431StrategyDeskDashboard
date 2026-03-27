import { cachedSourceJson } from './source-cache-server';

const SB_BASE = 'https://api.statbotics.io/v3';

export async function sbGet<T = unknown>(path: string): Promise<T> {
  return cachedSourceJson<T>('statbotics', path, `${SB_BASE}${path}`, undefined, 20);
}
