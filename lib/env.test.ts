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
});
