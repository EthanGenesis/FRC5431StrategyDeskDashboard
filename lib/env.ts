import { z } from 'zod';

function parseBoolean(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return defaultValue;
}

const envSchema = z.object({
  TBA_AUTH_KEY: z.string().min(1, 'Missing TBA_AUTH_KEY in .env.local'),
  APP_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  OTEL_ENABLED: z.boolean().default(false),
  OTEL_DIAG_LOGGING: z.boolean().default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().trim().optional(),
  OTEL_SERVICE_NAME: z.string().trim().min(1).default('tbsb-dashboard'),
});

const supabasePublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('Missing or invalid NEXT_PUBLIC_SUPABASE_URL in .env.local'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, 'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local'),
});

const supabaseServiceEnvSchema = supabasePublicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'Missing SUPABASE_SERVICE_ROLE_KEY in .env.local'),
});

export type AppEnv = z.infer<typeof envSchema>;
export type SupabasePublicEnv = z.infer<typeof supabasePublicEnvSchema>;
export type SupabaseServiceEnv = z.infer<typeof supabaseServiceEnvSchema>;

let parsedEnv: AppEnv | null = null;
let parsedSupabasePublicEnv: SupabasePublicEnv | null = null;
let parsedSupabaseServiceEnv: SupabaseServiceEnv | null = null;

export function getAppEnv(): AppEnv {
  if (parsedEnv) {
    return parsedEnv;
  }

  parsedEnv = envSchema.parse({
    TBA_AUTH_KEY: process.env.TBA_AUTH_KEY,
    APP_LOG_LEVEL: process.env.APP_LOG_LEVEL,
    NODE_ENV: process.env.NODE_ENV,
    OTEL_ENABLED: parseBoolean(process.env.OTEL_ENABLED, false),
    OTEL_DIAG_LOGGING: parseBoolean(process.env.OTEL_DIAG_LOGGING, false),
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ?? undefined,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
  });

  return parsedEnv;
}

export function hasSupabasePublicEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  );
}

export function getSupabasePublicEnv(): SupabasePublicEnv {
  if (parsedSupabasePublicEnv) {
    return parsedSupabasePublicEnv;
  }

  parsedSupabasePublicEnv = supabasePublicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  });

  return parsedSupabasePublicEnv;
}

export function hasSupabaseServiceEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() &&
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}

export function getSupabaseServiceEnv(): SupabaseServiceEnv {
  if (parsedSupabaseServiceEnv) {
    return parsedSupabaseServiceEnv;
  }

  parsedSupabaseServiceEnv = supabaseServiceEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  });

  return parsedSupabaseServiceEnv;
}
