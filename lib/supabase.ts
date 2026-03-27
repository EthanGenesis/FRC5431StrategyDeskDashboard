import { hasSupabasePublicEnv, hasSupabaseServiceEnv } from './env';

export function isSupabaseConfigured(): boolean {
  return hasSupabasePublicEnv();
}

export function isSupabaseServiceConfigured(): boolean {
  return hasSupabaseServiceEnv();
}
