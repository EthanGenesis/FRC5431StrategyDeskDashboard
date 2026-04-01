import * as envModule from './env';

export function isSupabaseConfigured(): boolean {
  try {
    return typeof envModule.hasSupabasePublicEnv === 'function'
      ? envModule.hasSupabasePublicEnv()
      : false;
  } catch {
    return false;
  }
}

export function isSupabaseServiceConfigured(): boolean {
  try {
    return typeof envModule.hasSupabaseServiceEnv === 'function'
      ? envModule.hasSupabaseServiceEnv()
      : false;
  } catch {
    return false;
  }
}
