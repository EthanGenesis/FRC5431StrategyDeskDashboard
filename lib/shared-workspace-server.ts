import { DEFAULT_COMPARE_DRAFT } from './compare-storage';
import { PERSISTENCE_TABLES } from './persistence-surfaces';
import { getPostgresServerClient } from './postgres-server';
import { isSupabaseServiceConfigured } from './supabase';
import { createSupabaseAdminClient } from './supabase-server';
import type { CompareDraft, CompareSet } from './types';

const SUPABASE_OPERATION_TIMEOUT_MS = 2500;

type CompareDraftScope = 'current' | 'historical';

type NamedArtifact = {
  id: string;
  [key: string]: unknown;
};

export type NamedArtifactTable =
  | typeof PERSISTENCE_TABLES.compareSets
  | typeof PERSISTENCE_TABLES.predictScenarios
  | typeof PERSISTENCE_TABLES.allianceScenarios
  | typeof PERSISTENCE_TABLES.pickLists
  | typeof PERSISTENCE_TABLES.playoffResults;

const NAMED_ARTIFACT_TABLES = new Set<NamedArtifactTable>([
  PERSISTENCE_TABLES.compareSets,
  PERSISTENCE_TABLES.predictScenarios,
  PERSISTENCE_TABLES.allianceScenarios,
  PERSISTENCE_TABLES.pickLists,
  PERSISTENCE_TABLES.playoffResults,
]);

function getAdminClient() {
  if (!isSupabaseServiceConfigured()) return null;
  return createSupabaseAdminClient();
}

function getPostgresClient() {
  return getPostgresServerClient();
}

function logWorkspaceReadFailure(scope: string, workspaceKey: string, detail: string): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: scope,
      ts: new Date().toISOString(),
      workspaceKey,
      detail,
    }),
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

function storageIdForWorkspace(workspaceKey: string, id: string): string {
  return `${workspaceKey}::${id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeCompareDraft(value: CompareDraft | null | undefined): CompareDraft {
  return {
    ...DEFAULT_COMPARE_DRAFT,
    ...(value ?? {}),
    teamNumbers: Array.from(
      new Set(
        (value?.teamNumbers ?? [])
          .map((teamNumber) => Math.floor(Number(teamNumber)))
          .filter((teamNumber) => Number.isFinite(teamNumber) && teamNumber > 0),
      ),
    ),
  };
}

function extractPayloadArray<T>(data: unknown): T[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => (isRecord(row) ? row.payload : null))
    .filter((payload): payload is T => payload != null);
}

export async function loadCompareDraftSharedServer(
  scope: CompareDraftScope,
  workspaceKey: string | null | undefined,
): Promise<CompareDraft> {
  const scopedWorkspaceKey = String(workspaceKey ?? '').trim();
  if (!scopedWorkspaceKey) return DEFAULT_COMPARE_DRAFT;

  const postgres = getPostgresClient();
  if (postgres) {
    try {
      const rows = await withTimeout(
        postgres.unsafe(
          `
            select payload
            from public.tbsb_compare_drafts
            where workspace_key = $1
              and scope = $2
            limit 1
          `,
          [scopedWorkspaceKey, scope],
        ),
        `load compare draft for ${scopedWorkspaceKey}`,
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      return normalizeCompareDraft((isRecord(row) ? row.payload : null) as CompareDraft | null);
    } catch (error) {
      logWorkspaceReadFailure(
        'compare_draft_postgres_read_failed',
        scopedWorkspaceKey,
        error instanceof Error ? error.message : 'Unknown compare draft Postgres read error',
      );
    }
  }

  const admin = getAdminClient();
  if (!admin) return DEFAULT_COMPARE_DRAFT;

  try {
    const response = await withTimeout(
      admin
        .from(PERSISTENCE_TABLES.compareDrafts)
        .select('payload')
        .eq('workspace_key', scopedWorkspaceKey)
        .eq('scope', scope)
        .maybeSingle(),
      `load compare draft for ${scopedWorkspaceKey}`,
    );

    if (response.error) {
      logWorkspaceReadFailure(
        'compare_draft_read_failed',
        scopedWorkspaceKey,
        response.error.message,
      );
      return DEFAULT_COMPARE_DRAFT;
    }

    return normalizeCompareDraft((response.data?.payload ?? null) as CompareDraft | null);
  } catch (error) {
    logWorkspaceReadFailure(
      'compare_draft_read_failed',
      scopedWorkspaceKey,
      error instanceof Error ? error.message : 'Unknown compare draft read error',
    );
    return DEFAULT_COMPARE_DRAFT;
  }
}

export async function loadCompareSetsSharedServer(
  workspaceKey: string | null | undefined,
): Promise<CompareSet[]> {
  const scopedWorkspaceKey = String(workspaceKey ?? '').trim();
  if (!scopedWorkspaceKey) return [];

  const postgres = getPostgresClient();
  if (postgres) {
    try {
      const rows = await withTimeout(
        postgres.unsafe(
          `
            select payload
            from public.tbsb_compare_sets
            where workspace_key = $1
            order by updated_at desc
          `,
          [scopedWorkspaceKey],
        ),
        `load compare sets for ${scopedWorkspaceKey}`,
      );
      return extractPayloadArray<CompareSet>(rows);
    } catch (error) {
      logWorkspaceReadFailure(
        'compare_sets_postgres_read_failed',
        scopedWorkspaceKey,
        error instanceof Error ? error.message : 'Unknown compare sets Postgres read error',
      );
    }
  }

  const admin = getAdminClient();
  if (!admin) return [];

  try {
    const response = await withTimeout(
      admin
        .from(PERSISTENCE_TABLES.compareSets)
        .select('payload')
        .eq('workspace_key', scopedWorkspaceKey)
        .order('updated_at', { ascending: false }),
      `load compare sets for ${scopedWorkspaceKey}`,
    );

    if (response.error) {
      logWorkspaceReadFailure(
        'compare_sets_read_failed',
        scopedWorkspaceKey,
        response.error.message,
      );
      return [];
    }

    return extractPayloadArray<CompareSet>(response.data);
  } catch (error) {
    logWorkspaceReadFailure(
      'compare_sets_read_failed',
      scopedWorkspaceKey,
      error instanceof Error ? error.message : 'Unknown compare sets read error',
    );
    return [];
  }
}

export async function loadNamedArtifactsSharedServer<T extends NamedArtifact>(
  table: NamedArtifactTable,
  workspaceKey: string | null | undefined,
): Promise<T[]> {
  const scopedWorkspaceKey = String(workspaceKey ?? '').trim();
  if (!scopedWorkspaceKey) return [];
  if (!NAMED_ARTIFACT_TABLES.has(table)) return [];

  const postgres = getPostgresClient();
  if (postgres) {
    try {
      const rows = await withTimeout(
        postgres.unsafe(
          `
            select payload
            from public.${table}
            where workspace_key = $1
            order by updated_at desc
          `,
          [scopedWorkspaceKey],
        ),
        `load named artifacts for ${scopedWorkspaceKey}`,
      );
      return extractPayloadArray<T>(rows);
    } catch (error) {
      logWorkspaceReadFailure(
        'named_artifacts_postgres_read_failed',
        scopedWorkspaceKey,
        error instanceof Error ? error.message : 'Unknown named artifacts Postgres read error',
      );
    }
  }

  const admin = getAdminClient();
  if (!admin) return [];

  try {
    const response = await withTimeout(
      admin
        .from(table)
        .select('payload')
        .eq('workspace_key', scopedWorkspaceKey)
        .order('updated_at', { ascending: false }),
      `load named artifacts for ${scopedWorkspaceKey}`,
    );

    if (response.error) {
      logWorkspaceReadFailure(
        'named_artifacts_read_failed',
        scopedWorkspaceKey,
        response.error.message,
      );
      return [];
    }

    return extractPayloadArray<T>(response.data);
  } catch (error) {
    logWorkspaceReadFailure(
      'named_artifacts_read_failed',
      scopedWorkspaceKey,
      error instanceof Error ? error.message : 'Unknown named artifacts read error',
    );
    return [];
  }
}

export function storageIdForWorkspaceArtifact(workspaceKey: string, id: string): string {
  return storageIdForWorkspace(workspaceKey, id);
}
