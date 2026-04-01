import { DEFAULT_COMPARE_DRAFT } from './compare-storage';
import { PERSISTENCE_TABLES } from './persistence-surfaces';
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

function getAdminClient() {
  if (!isSupabaseServiceConfigured()) return null;
  return createSupabaseAdminClient();
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

  const admin = getAdminClient();
  if (!admin) return DEFAULT_COMPARE_DRAFT;

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
    throw new Error(response.error.message);
  }

  return normalizeCompareDraft((response.data?.payload ?? null) as CompareDraft | null);
}

export async function loadCompareSetsSharedServer(
  workspaceKey: string | null | undefined,
): Promise<CompareSet[]> {
  const scopedWorkspaceKey = String(workspaceKey ?? '').trim();
  if (!scopedWorkspaceKey) return [];

  const admin = getAdminClient();
  if (!admin) return [];

  const response = await withTimeout(
    admin
      .from(PERSISTENCE_TABLES.compareSets)
      .select('payload')
      .eq('workspace_key', scopedWorkspaceKey)
      .order('updated_at', { ascending: false }),
    `load compare sets for ${scopedWorkspaceKey}`,
  );

  if (response.error) {
    throw new Error(response.error.message);
  }

  return extractPayloadArray<CompareSet>(response.data);
}

export async function loadNamedArtifactsSharedServer<T extends NamedArtifact>(
  table: NamedArtifactTable,
  workspaceKey: string | null | undefined,
): Promise<T[]> {
  const scopedWorkspaceKey = String(workspaceKey ?? '').trim();
  if (!scopedWorkspaceKey) return [];

  const admin = getAdminClient();
  if (!admin) return [];

  const response = await withTimeout(
    admin
      .from(table)
      .select('payload')
      .eq('workspace_key', scopedWorkspaceKey)
      .order('updated_at', { ascending: false }),
    `load named artifacts for ${scopedWorkspaceKey}`,
  );

  if (response.error) {
    throw new Error(response.error.message);
  }

  return extractPayloadArray<T>(response.data);
}

export function storageIdForWorkspaceArtifact(workspaceKey: string, id: string): string {
  return storageIdForWorkspace(workspaceKey, id);
}
