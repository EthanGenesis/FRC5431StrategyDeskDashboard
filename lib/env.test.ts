import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function loadEnvModule() {
  vi.resetModules();
  return import('./env');
}

describe('env helpers', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('detects supabase public env only when both public values are present', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

    let env = await loadEnvModule();
    expect(env.hasSupabasePublicEnv()).toBe(false);

    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY = 'sb_publishable_default_key';
    env = await loadEnvModule();
    expect(env.hasSupabasePublicEnv()).toBe(true);
    expect(env.getSupabasePublicEnv()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_default_key',
    });
  });

  it('detects supabase service env only when service role is present', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_primary_key';
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    let env = await loadEnvModule();
    expect(env.hasSupabaseServiceEnv()).toBe(false);

    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    env = await loadEnvModule();
    expect(env.hasSupabaseServiceEnv()).toBe(true);
    expect(env.getSupabaseServiceEnv()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_primary_key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    });
  });

  it('still accepts the legacy anon key name as a fallback', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'legacy-anon-key';
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

    const env = await loadEnvModule();
    expect(env.getSupabasePublicEnv()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'legacy-anon-key',
    });
  });

  it('parses hot data plane config and route allowlists', async () => {
    process.env.HOT_DATA_PLANE_URL = 'https://hot-plane.example.com';
    process.env.HOT_DATA_PLANE_MODE = 'shadow';
    process.env.HOT_DATA_PLANE_PROXY_ROUTES = 'bootstrap, predict-bundle , team-events';

    const env = await loadEnvModule();
    expect(env.hasHotDataPlaneEnv()).toBe(true);
    expect(env.getHotDataPlaneEnv()).toEqual({
      HOT_DATA_PLANE_URL: 'https://hot-plane.example.com',
      HOT_DATA_PLANE_BEARER_TOKEN: undefined,
      HOT_DATA_PLANE_MODE: 'shadow',
      HOT_DATA_PLANE_PROXY_ROUTES: ['bootstrap', 'predict-bundle', 'team-events'],
    });
  });

  it('parses optional hot cache config', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-token';
    process.env.HOT_CACHE_FRESH_SECONDS = '9';
    process.env.HOT_CACHE_STALE_SECONDS = '45';

    const env = await loadEnvModule();
    expect(env.hasHotCacheEnv()).toBe(true);
    expect(env.getHotCacheEnv()).toEqual({
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'upstash-token',
      HOT_CACHE_FRESH_SECONDS: 9,
      HOT_CACHE_STALE_SECONDS: 45,
    });
  });
});
