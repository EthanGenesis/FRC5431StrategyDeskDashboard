'use client';

import { useEffect, useMemo, useState } from 'react';

import { createSupabaseBrowserClient } from './supabase-browser';
import { isSupabaseConfigured } from './supabase';
import type { WorkspacePresenceEntry, WorkspacePresenceMode } from './types';

const SESSION_STORAGE_KEY = 'tbsb_presence_session_v1';

function getPresenceSessionId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function isWorkspacePresenceMode(value: unknown): value is WorkspacePresenceMode {
  return value === 'viewing' || value === 'editing';
}

function isWorkspacePresenceEntry(value: unknown): value is WorkspacePresenceEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sessionId === 'string' &&
    typeof candidate.workspaceKey === 'string' &&
    typeof candidate.surface === 'string' &&
    (candidate.artifactId === null || typeof candidate.artifactId === 'string') &&
    isWorkspacePresenceMode(candidate.mode) &&
    (candidate.operatorLabel === null || typeof candidate.operatorLabel === 'string') &&
    Number.isFinite(Number(candidate.joinedAtMs))
  );
}

type PresenceInput = {
  workspaceKey: string | null | undefined;
  surface: string;
  artifactId?: string | null | undefined;
  mode?: WorkspacePresenceMode;
  operatorLabel?: string | null | undefined;
  enabled?: boolean;
};

export function useWorkspacePresence(input: PresenceInput) {
  const {
    workspaceKey,
    surface,
    artifactId = null,
    mode = 'viewing',
    operatorLabel = null,
    enabled = true,
  } = input;
  const [entries, setEntries] = useState<WorkspacePresenceEntry[]>([]);
  const [sessionId] = useState<string>(() => getPresenceSessionId());
  const presenceEnabled =
    enabled && Boolean(workspaceKey) && Boolean(surface) && isSupabaseConfigured();

  useEffect(() => {
    if (!presenceEnabled || !workspaceKey) {
      return undefined;
    }

    const client = createSupabaseBrowserClient();

    const channel = client.channel(`workspace-presence:${workspaceKey}:${surface}`, {
      config: {
        presence: {
          key: sessionId,
        },
      },
    });

    const syncEntries = () => {
      const presenceState = channel.presenceState<WorkspacePresenceEntry>();
      const nextEntries = Object.values(presenceState)
        .flatMap((value) => (Array.isArray(value) ? value : []))
        .filter(isWorkspacePresenceEntry)
        .sort((left, right) => Number(right.joinedAtMs ?? 0) - Number(left.joinedAtMs ?? 0));
      setEntries(nextEntries);
    };

    channel.on('presence', { event: 'sync' }, syncEntries);
    channel.on('presence', { event: 'join' }, syncEntries);
    channel.on('presence', { event: 'leave' }, syncEntries);

    let active = true;
    void channel.subscribe(async (status) => {
      if (!active || String(status) !== 'SUBSCRIBED') return;
      await channel.track({
        sessionId,
        workspaceKey,
        surface,
        artifactId,
        mode,
        operatorLabel: operatorLabel ?? null,
        joinedAtMs: Date.now(),
      } satisfies WorkspacePresenceEntry);
      syncEntries();
    });

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [artifactId, mode, operatorLabel, presenceEnabled, sessionId, surface, workspaceKey]);

  const visibleEntries = useMemo(
    () => (presenceEnabled ? entries : []),
    [entries, presenceEnabled],
  );

  const otherEntries = useMemo(
    () => visibleEntries.filter((entry) => entry.sessionId !== sessionId),
    [sessionId, visibleEntries],
  );
  const editingEntries = useMemo(
    () =>
      otherEntries.filter(
        (entry) =>
          entry.mode === 'editing' && String(entry.artifactId ?? '') === String(artifactId ?? ''),
      ),
    [artifactId, otherEntries],
  );
  const viewingEntries = useMemo(
    () =>
      otherEntries.filter(
        (entry) =>
          entry.mode === 'viewing' && String(entry.artifactId ?? '') === String(artifactId ?? ''),
      ),
    [artifactId, otherEntries],
  );

  return {
    sessionId,
    entries: visibleEntries,
    otherEntries,
    viewingEntries,
    editingEntries,
    hasConflict: editingEntries.length > 0,
  };
}
