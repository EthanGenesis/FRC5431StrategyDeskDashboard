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

function parsePositiveInteger(value: unknown, defaultValue: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

const envSchema = z.object({
  TBA_AUTH_KEY: z.string().min(1, 'Missing TBA_AUTH_KEY in .env.local'),
  TBA_WEBHOOK_SECRET: z.string().trim().optional(),
  APP_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  OTEL_ENABLED: z.boolean().default(false),
  OTEL_DIAG_LOGGING: z.boolean().default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().trim().optional(),
  OTEL_SERVICE_NAME: z.string().trim().min(1).default('tbsb-dashboard'),
});

const firstApiEnvSchema = z.object({
  FIRST_API_BASE_URL: z.string().url().default('https://frc-api.firstinspires.org/v3.0'),
  FIRST_API_USERNAME: z.string().min(1, 'Missing FIRST_API_USERNAME in .env.local'),
  FIRST_API_AUTH_TOKEN: z.string().min(1, 'Missing FIRST_API_AUTH_TOKEN in .env.local'),
});

const nexusEnvSchema = z.object({
  NEXUS_API_BASE_URL: z.string().url().default('https://frc.nexus/api/v1'),
  NEXUS_API_KEY: z.string().min(1, 'Missing NEXUS_API_KEY in .env.local'),
});

const supabasePublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('Missing or invalid NEXT_PUBLIC_SUPABASE_URL in .env.local'),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(
      1,
      'Missing Supabase publishable key in .env.local. Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY, or NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    ),
});

const supabaseServiceEnvSchema = supabasePublicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'Missing SUPABASE_SERVICE_ROLE_KEY in .env.local'),
});

const hotDataPlaneEnvSchema = z.object({
  HOT_DATA_PLANE_URL: z.string().url('Missing or invalid HOT_DATA_PLANE_URL in .env.local'),
  HOT_DATA_PLANE_BEARER_TOKEN: z.string().trim().optional(),
  HOT_DATA_PLANE_MODE: z.enum(['off', 'shadow', 'proxy']).default('off'),
  HOT_DATA_PLANE_PROXY_ROUTES: z.string().trim().optional(),
});

const hotCacheEnvSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.string().url('Missing or invalid UPSTASH_REDIS_REST_URL in .env.local'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'Missing UPSTASH_REDIS_REST_TOKEN in .env.local'),
  HOT_CACHE_FRESH_SECONDS: z.number().int().positive().default(15),
  HOT_CACHE_STALE_SECONDS: z.number().int().positive().default(60),
});

export type AppEnv = z.infer<typeof envSchema>;
export type FirstApiEnv = z.infer<typeof firstApiEnvSchema>;
export type NexusEnv = z.infer<typeof nexusEnvSchema>;
export type SupabasePublicEnv = z.infer<typeof supabasePublicEnvSchema>;
export type SupabaseServiceEnv = z.infer<typeof supabaseServiceEnvSchema>;
export type HotDataPlaneEnv = Omit<
  z.infer<typeof hotDataPlaneEnvSchema>,
  'HOT_DATA_PLANE_PROXY_ROUTES'
> & {
  HOT_DATA_PLANE_PROXY_ROUTES: string[];
};
export type HotCacheEnv = z.infer<typeof hotCacheEnvSchema>;

let parsedEnv: AppEnv | null = null;
let parsedFirstApiEnv: FirstApiEnv | null = null;
let parsedNexusEnv: NexusEnv | null = null;
let parsedSupabasePublicEnv: SupabasePublicEnv | null = null;
let parsedSupabaseServiceEnv: SupabaseServiceEnv | null = null;
let parsedHotDataPlaneEnv: HotDataPlaneEnv | null = null;
let parsedHotCacheEnv: HotCacheEnv | null = null;

function getSupabasePublishableKey(): string | undefined {
  const candidates = [
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ];

  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (normalized) return normalized;
  }

  return undefined;
}

export function getAppEnv(): AppEnv {
  if (parsedEnv) {
    return parsedEnv;
  }

  parsedEnv = envSchema.parse({
    TBA_AUTH_KEY: process.env.TBA_AUTH_KEY,
    APP_LOG_LEVEL: process.env.APP_LOG_LEVEL,
    NODE_ENV: process.env.NODE_ENV,
    TBA_WEBHOOK_SECRET: process.env.TBA_WEBHOOK_SECRET?.trim() ?? undefined,
    OTEL_ENABLED: parseBoolean(process.env.OTEL_ENABLED, false),
    OTEL_DIAG_LOGGING: parseBoolean(process.env.OTEL_DIAG_LOGGING, false),
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ?? undefined,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
  });

  return parsedEnv;
}

export function hasFirstApiEnv(): boolean {
  return Boolean(
    process.env.FIRST_API_USERNAME?.trim() && process.env.FIRST_API_AUTH_TOKEN?.trim(),
  );
}

export function getFirstApiEnv(): FirstApiEnv {
  if (parsedFirstApiEnv) {
    return parsedFirstApiEnv;
  }

  const firstApiBaseUrl = process.env.FIRST_API_BASE_URL?.trim();
  parsedFirstApiEnv = firstApiEnvSchema.parse({
    FIRST_API_BASE_URL: firstApiBaseUrl?.length
      ? firstApiBaseUrl
      : 'https://frc-api.firstinspires.org/v3.0',
    FIRST_API_USERNAME: process.env.FIRST_API_USERNAME?.trim(),
    FIRST_API_AUTH_TOKEN: process.env.FIRST_API_AUTH_TOKEN?.trim(),
  });

  return parsedFirstApiEnv;
}

export function hasNexusEnv(): boolean {
  return Boolean(process.env.NEXUS_API_KEY?.trim());
}

export function getNexusEnv(): NexusEnv {
  if (parsedNexusEnv) {
    return parsedNexusEnv;
  }

  const nexusApiBaseUrl = process.env.NEXUS_API_BASE_URL?.trim();
  parsedNexusEnv = nexusEnvSchema.parse({
    NEXUS_API_BASE_URL: nexusApiBaseUrl?.length ? nexusApiBaseUrl : 'https://frc.nexus/api/v1',
    NEXUS_API_KEY: process.env.NEXUS_API_KEY?.trim(),
  });

  return parsedNexusEnv;
}

export function hasSupabasePublicEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && getSupabasePublishableKey());
}

export function getSupabasePublicEnv(): SupabasePublicEnv {
  if (parsedSupabasePublicEnv) {
    return parsedSupabasePublicEnv;
  }

  parsedSupabasePublicEnv = supabasePublicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: getSupabasePublishableKey(),
  });

  return parsedSupabasePublicEnv;
}

export function hasSupabaseServiceEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    getSupabasePublishableKey() &&
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}

export function getSupabaseServiceEnv(): SupabaseServiceEnv {
  if (parsedSupabaseServiceEnv) {
    return parsedSupabaseServiceEnv;
  }

  parsedSupabaseServiceEnv = supabaseServiceEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: getSupabasePublishableKey(),
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  });

  return parsedSupabaseServiceEnv;
}

export function hasHotDataPlaneEnv(): boolean {
  return Boolean(process.env.HOT_DATA_PLANE_URL?.trim());
}

export function getHotDataPlaneEnv(): HotDataPlaneEnv {
  if (parsedHotDataPlaneEnv) {
    return parsedHotDataPlaneEnv;
  }

  const parsed = hotDataPlaneEnvSchema.parse({
    HOT_DATA_PLANE_URL: process.env.HOT_DATA_PLANE_URL?.trim(),
    HOT_DATA_PLANE_BEARER_TOKEN: process.env.HOT_DATA_PLANE_BEARER_TOKEN?.trim() ?? undefined,
    HOT_DATA_PLANE_MODE: process.env.HOT_DATA_PLANE_MODE?.trim().toLowerCase() ?? 'off',
    HOT_DATA_PLANE_PROXY_ROUTES: process.env.HOT_DATA_PLANE_PROXY_ROUTES?.trim() ?? undefined,
  });

  parsedHotDataPlaneEnv = {
    ...parsed,
    HOT_DATA_PLANE_PROXY_ROUTES: String(parsed.HOT_DATA_PLANE_PROXY_ROUTES ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };

  return parsedHotDataPlaneEnv;
}

export function hasHotCacheEnv(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

export function getHotCacheEnv(): HotCacheEnv {
  if (parsedHotCacheEnv) {
    return parsedHotCacheEnv;
  }

  parsedHotCacheEnv = hotCacheEnvSchema.parse({
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL?.trim(),
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
    HOT_CACHE_FRESH_SECONDS: parsePositiveInteger(process.env.HOT_CACHE_FRESH_SECONDS, 15),
    HOT_CACHE_STALE_SECONDS: parsePositiveInteger(process.env.HOT_CACHE_STALE_SECONDS, 60),
  });

  return parsedHotCacheEnv;
}
