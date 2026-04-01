import { PERSISTENCE_TABLES, SHARED_WORKSPACE_KEY } from './persistence-surfaces';
import { isSupabaseServiceConfigured } from './supabase';
import { createSupabaseAdminClient } from './supabase-server';

const SUPABASE_OPERATION_TIMEOUT_MS = 1500;

type ParityAuditStatus = 'match' | 'diff' | 'error' | 'skipped';

type RouteAuditContext = {
  routeKey: string;
  workspaceKey?: string | null | undefined;
  eventKey?: string | null | undefined;
  teamNumber?: number | null | undefined;
  scenarioId?: string | null | undefined;
};

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readPositiveInteger(value: unknown): number | null {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeMeta(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function isMissingAuditTableError(message: string | null | undefined): boolean {
  const normalized = readString(message).toLowerCase();
  return (
    normalized.includes('schema cache') ||
    normalized.includes('does not exist') ||
    normalized.includes('tbsb_parity_audit_log') ||
    normalized.includes('tbsb_perf_samples')
  );
}

async function withTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${SUPABASE_OPERATION_TIMEOUT_MS}ms`));
    }, SUPABASE_OPERATION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function getAdminClient() {
  if (!isSupabaseServiceConfigured()) return null;
  return createSupabaseAdminClient();
}

export async function recordPerfSample(
  context: RouteAuditContext & {
    statusCode: number;
    durationMs: number;
    cacheState?: string | null | undefined;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  const admin = getAdminClient();
  if (!admin) return;

  try {
    const response = await withTimeout(
      admin.from(PERSISTENCE_TABLES.perfSamples).insert({
        route_key: context.routeKey,
        workspace_key: readString(context.workspaceKey) || SHARED_WORKSPACE_KEY,
        event_key: readString(context.eventKey) || null,
        team_number: readPositiveInteger(context.teamNumber),
        scenario_id: readString(context.scenarioId) || null,
        status_code: Math.max(0, Math.floor(Number(context.statusCode) || 0)),
        duration_ms: Math.max(0, Math.floor(Number(context.durationMs) || 0)),
        cache_state: readString(context.cacheState) || null,
        meta: normalizeMeta(context.meta),
        created_at: new Date().toISOString(),
      }),
      `record perf sample for ${context.routeKey}`,
    );

    if (response.error && !isMissingAuditTableError(response.error.message)) {
      console.warn('perf_sample_write_failed', response.error.message);
    }
  } catch (error) {
    console.warn(
      'perf_sample_write_failed',
      error instanceof Error ? error.message : 'Unknown perf sample write error',
    );
  }
}

export async function recordParityAudit(
  context: RouteAuditContext & {
    status: ParityAuditStatus;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const admin = getAdminClient();
  if (!admin) return;

  try {
    const response = await withTimeout(
      admin.from(PERSISTENCE_TABLES.parityAuditLog).insert({
        route_key: context.routeKey,
        workspace_key: readString(context.workspaceKey) || SHARED_WORKSPACE_KEY,
        event_key: readString(context.eventKey) || null,
        team_number: readPositiveInteger(context.teamNumber),
        scenario_id: readString(context.scenarioId) || null,
        status: context.status,
        detail: normalizeMeta(context.detail),
        created_at: new Date().toISOString(),
      }),
      `record parity audit for ${context.routeKey}`,
    );

    if (response.error && !isMissingAuditTableError(response.error.message)) {
      console.warn('parity_audit_write_failed', response.error.message);
    }
  } catch (error) {
    console.warn(
      'parity_audit_write_failed',
      error instanceof Error ? error.message : 'Unknown parity audit write error',
    );
  }
}
