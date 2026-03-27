import { hasSupabasePublicEnv, hasSupabaseServiceEnv } from './env';

export function isSupabaseConfigured(): boolean {
  return hasSupabasePublicEnv();
}

export function isSupabaseAdminConfigured(): boolean {
  return hasSupabaseServiceEnv();
}
