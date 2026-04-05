'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchJsonOrThrow } from '../lib/httpCache';
import {
  appendWorkspaceActivityShared,
  loadWorkspaceChecklistsShared,
  loadWorkspaceNotesShared,
  saveWorkspaceChecklistsShared,
  saveWorkspaceNotesShared,
} from '../lib/shared-workspace-browser';
import type { DeskOpsResponse, WorkspaceChecklist, WorkspaceNoteScope } from '../lib/types';
import {
  createDefaultEventChecklist,
  createWorkspaceActivity,
  createWorkspaceNote,
} from '../lib/workspace-collab';
import DisclosureSection from './ui/DisclosureSection';

type DeskOpsPanelProps = {
  workspaceKey: string | null;
  loadedEventKey?: string;
  loadedTeam?: number | null;
  currentMatchKey?: string | null;
  operatorLabel?: string;
  externalUpdateKey?: number;
};

function fmtTimestamp(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return '-';
  return new Date(Number(value)).toLocaleString();
}

function scopeLabel(scope: WorkspaceNoteScope): string {
  if (scope === 'event') return 'Event note';
  if (scope === 'team') return 'Team note';
  return 'Match note';
}

export default function DeskOpsPanel({
  workspaceKey,
  loadedEventKey = '',
  loadedTeam = null,
  currentMatchKey = null,
  operatorLabel = '',
  externalUpdateKey = 0,
}: DeskOpsPanelProps) {
  const [ops, setOps] = useState<DeskOpsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [noteScope, setNoteScope] = useState<WorkspaceNoteScope>('event');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [saving, setSaving] = useState(false);

  const reloadOps = useCallback(async () => {
    if (!workspaceKey || !loadedEventKey || !loadedTeam) {
      setOps(null);
      return;
    }
    setIsLoading(true);
    setErrorText('');
    try {
      const query = new URLSearchParams({
        eventKey: loadedEventKey,
        team: String(loadedTeam),
      });
      const response = await fetchJsonOrThrow<DeskOpsResponse>(
        `/api/desk-ops?${query.toString()}`,
        { cache: 'default' },
        'Desk ops failed',
      );
      setOps(response);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unknown desk-ops error');
      setOps(null);
    } finally {
      setIsLoading(false);
    }
  }, [loadedEventKey, loadedTeam, workspaceKey]);

  useEffect(() => {
    void reloadOps();
  }, [externalUpdateKey, reloadOps]);

  useEffect(() => {
    if (!workspaceKey || !loadedEventKey || !loadedTeam) return undefined;
    const id = window.setInterval(() => {
      void reloadOps();
    }, 15000);
    return () => window.clearInterval(id);
  }, [loadedEventKey, loadedTeam, reloadOps, workspaceKey]);

  const visibleNotes = useMemo(() => {
    const rows = ops?.notes ?? [];
    return rows.filter((note) => {
      if (note.scope === 'event') return note.eventKey === loadedEventKey;
      if (note.scope === 'team')
        return note.eventKey === loadedEventKey && note.teamNumber === loadedTeam;
      if (note.scope === 'match') return note.eventKey === loadedEventKey;
      return false;
    });
  }, [loadedEventKey, loadedTeam, ops?.notes]);

  const saveChecklist = useCallback(
    async (nextChecklist: WorkspaceChecklist) => {
      if (!workspaceKey) return;
      const existing = await loadWorkspaceChecklistsShared(workspaceKey, {
        scope: 'event',
        eventKey: loadedEventKey,
      });
      const others = existing.filter((item) => item.id !== nextChecklist.id);
      await saveWorkspaceChecklistsShared(workspaceKey, [nextChecklist, ...others]);
      await appendWorkspaceActivityShared(
        createWorkspaceActivity({
          workspaceKey,
          scope: 'event',
          eventKey: loadedEventKey,
          authorLabel: operatorLabel || null,
          action: 'checklist_updated',
          detail: `Updated checklist: ${nextChecklist.label}`,
        }),
      );
      await reloadOps();
    },
    [loadedEventKey, operatorLabel, reloadOps, workspaceKey],
  );

  const ensureChecklist = useCallback(async () => {
    if (!workspaceKey || !loadedEventKey) return;
    const checklist =
      ops?.checklist ??
      createDefaultEventChecklist(workspaceKey, loadedEventKey, operatorLabel || null);
    await saveChecklist(checklist);
  }, [loadedEventKey, operatorLabel, ops?.checklist, saveChecklist, workspaceKey]);

  const toggleChecklistItem = useCallback(
    async (itemId: string) => {
      if (!workspaceKey || !ops?.checklist) return;
      const nextChecklist: WorkspaceChecklist = {
        ...ops.checklist,
        items: ops.checklist.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                checked: !item.checked,
                updatedAtMs: Date.now(),
                updatedByLabel: operatorLabel || null,
              }
            : item,
        ),
        updatedAtMs: Date.now(),
        authorLabel: operatorLabel || null,
      };
      await saveChecklist(nextChecklist);
    },
    [operatorLabel, ops?.checklist, saveChecklist, workspaceKey],
  );

  const handleSaveNote = useCallback(async () => {
    if (!workspaceKey || !loadedEventKey || !noteBody.trim()) return;
    setSaving(true);
    setErrorText('');
    try {
      const existing = await loadWorkspaceNotesShared(workspaceKey);
      const note = createWorkspaceNote({
        workspaceKey,
        scope: noteScope,
        eventKey: loadedEventKey,
        teamNumber: noteScope === 'team' ? loadedTeam : null,
        matchKey: noteScope === 'match' ? currentMatchKey : null,
        title: noteTitle || scopeLabel(noteScope),
        body: noteBody,
        authorLabel: operatorLabel || null,
      });
      await saveWorkspaceNotesShared(workspaceKey, [note, ...existing]);
      await appendWorkspaceActivityShared(
        createWorkspaceActivity({
          workspaceKey,
          scope: noteScope === 'event' ? 'event' : noteScope,
          eventKey: loadedEventKey,
          teamNumber: noteScope === 'team' ? loadedTeam : null,
          matchKey: noteScope === 'match' ? currentMatchKey : null,
          authorLabel: operatorLabel || null,
          action: 'note_saved',
          detail: `${scopeLabel(noteScope)} saved: ${note.title}`,
        }),
      );
      setNoteTitle('');
      setNoteBody('');
      await reloadOps();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to save note');
    } finally {
      setSaving(false);
    }
  }, [
    currentMatchKey,
    loadedEventKey,
    loadedTeam,
    noteBody,
    noteScope,
    noteTitle,
    operatorLabel,
    reloadOps,
    workspaceKey,
  ]);

  const handleDeleteNote = useCallback(
    async (noteId: string) => {
      if (!workspaceKey) return;
      const existing = await loadWorkspaceNotesShared(workspaceKey);
      const note = existing.find((item) => item.id === noteId) ?? null;
      await saveWorkspaceNotesShared(
        workspaceKey,
        existing.filter((item) => item.id !== noteId),
      );
      if (note) {
        await appendWorkspaceActivityShared(
          createWorkspaceActivity({
            workspaceKey,
            scope: note.scope === 'event' ? 'event' : note.scope,
            eventKey: note.eventKey,
            teamNumber: note.teamNumber,
            matchKey: note.matchKey,
            authorLabel: operatorLabel || null,
            action: 'note_deleted',
            detail: `${scopeLabel(note.scope)} deleted: ${note.title}`,
          }),
        );
      }
      await reloadOps();
    },
    [operatorLabel, reloadOps, workspaceKey],
  );

  return (
    <DisclosureSection
      storageKey="ui.current.now.expanded_desk_ops"
      title="Expanded Desk Ops"
      description="Queue ladder, source trust, shared notes, readiness checklist, and collaboration feed."
      defaultOpen
    >
      <div className="stack-12">
        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Queue Ladder</div>
            <div className="grid-4">
              {(ops?.queueLadder ?? []).map((step) => (
                <div
                  key={step.id}
                  className="panel-2"
                  style={{
                    padding: 12,
                    borderColor: step.active ? '#4bb3fd' : step.completed ? '#2dd4bf' : undefined,
                    background: step.active ? '#14253b' : undefined,
                  }}
                >
                  <div className="muted" style={{ fontSize: 12 }}>
                    {step.label}
                  </div>
                  <div style={{ fontWeight: 900, marginTop: 6 }}>
                    {step.active ? 'Active' : step.completed ? 'Passed' : 'Pending'}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    ETA {step.etaLabel ?? '-'}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid-3" style={{ marginTop: 12 }}>
              <div className="panel-2" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  Queue
                </div>
                <div style={{ fontWeight: 900, marginTop: 6 }}>{ops?.queueText ?? '-'}</div>
              </div>
              <div className="panel-2" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  Current Match
                </div>
                <div style={{ fontWeight: 900, marginTop: 6 }}>{ops?.currentMatchLabel ?? '-'}</div>
              </div>
              <div className="panel-2" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  Next Match
                </div>
                <div style={{ fontWeight: 900, marginTop: 6 }}>{ops?.nextMatchLabel ?? '-'}</div>
              </div>
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>What Changed + Source Trust</div>
            <div className="stack-8">
              {(ops?.deltas ?? []).map((item) => (
                <div key={item.id} className="panel-2" style={{ padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 800 }}>{item.label}</div>
                    <div className="muted mono" style={{ fontSize: 11 }}>
                      {fmtTimestamp(item.createdAtMs)}
                    </div>
                  </div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    {item.detail}
                  </div>
                </div>
              ))}
              {!ops?.deltas?.length ? (
                <div className="muted">No recent desk deltas yet.</div>
              ) : null}
            </div>
            <div className="panel-2" style={{ padding: 12, marginTop: 12 }}>
              <div style={{ fontWeight: 800 }}>Source trust</div>
              <div className="muted" style={{ marginTop: 6 }}>
                {ops?.sourceTrust?.summary ?? 'No validation summary yet.'}
              </div>
              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                FIRST {ops?.sourceTrust?.firstStatus ?? '-'} | Nexus{' '}
                {ops?.sourceTrust?.nexusStatus ?? '-'} | Mismatch{' '}
                {ops?.sourceTrust?.mismatchCount ?? 0} | Missing{' '}
                {ops?.sourceTrust?.missingCount ?? 0} | Stale{' '}
                {ops?.sourceTrust?.staleSeconds ?? '-'}s
              </div>
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}
            >
              <div style={{ fontWeight: 900 }}>Event-Day Checklist</div>
              <button className="button" type="button" onClick={() => void ensureChecklist()}>
                {ops?.checklist ? 'Refresh Checklist' : 'Seed Checklist'}
              </button>
            </div>
            {ops?.checklist ? (
              <div className="stack-8">
                {ops.checklist.items.map((item) => (
                  <label
                    key={item.id}
                    className="panel-2"
                    style={{ padding: 10, display: 'flex', gap: 10, alignItems: 'flex-start' }}
                  >
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={() => void toggleChecklistItem(item.id)}
                    />
                    <span>
                      <span style={{ fontWeight: 700 }}>{item.text}</span>
                      <span
                        className="muted"
                        style={{ display: 'block', marginTop: 4, fontSize: 12 }}
                      >
                        {item.updatedByLabel ? `Updated by ${item.updatedByLabel}` : 'Shared item'}{' '}
                        at {fmtTimestamp(item.updatedAtMs)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="muted">No shared checklist exists for this event yet.</div>
            )}
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Shared Notes</div>
            <div className="grid-2" style={{ marginBottom: 10 }}>
              <select
                className="input"
                value={noteScope}
                onChange={(event) => setNoteScope(event.target.value as WorkspaceNoteScope)}
              >
                <option value="event">Event note</option>
                <option value="team">Team note</option>
                <option value="match">Match note</option>
              </select>
              <input
                className="input"
                value={noteTitle}
                onChange={(event) => setNoteTitle(event.target.value)}
                placeholder="Short title"
              />
            </div>
            <textarea
              className="input"
              value={noteBody}
              onChange={(event) => setNoteBody(event.target.value)}
              placeholder="What changed, what matters, or what the desk should remember..."
              rows={4}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button
                className="button button-primary"
                type="button"
                onClick={() => void handleSaveNote()}
              >
                {saving ? 'Saving...' : 'Save Note'}
              </button>
              <span className="muted" style={{ fontSize: 12 }}>
                {operatorLabel
                  ? `Posting as ${operatorLabel}`
                  : 'Add an operator label in Settings to sign notes.'}
              </span>
            </div>
            <div className="stack-8" style={{ marginTop: 12, maxHeight: 320, overflow: 'auto' }}>
              {visibleNotes.map((note) => (
                <div key={note.id} className="panel-2" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 800 }}>{note.title}</div>
                      <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                        {scopeLabel(note.scope)} {note.authorLabel ? `• ${note.authorLabel}` : ''}
                      </div>
                    </div>
                    <button
                      className="button"
                      type="button"
                      onClick={() => void handleDeleteNote(note.id)}
                    >
                      Delete
                    </button>
                  </div>
                  <div className="muted" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
                    {note.body || 'No note body.'}
                  </div>
                </div>
              ))}
              {!visibleNotes.length ? <div className="muted">No shared notes yet.</div> : null}
            </div>
          </div>
        </div>

        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Activity Feed</div>
          <div className="stack-8" style={{ maxHeight: 240, overflow: 'auto' }}>
            {(ops?.activity ?? []).map((entry) => (
              <div key={entry.id} className="panel-2" style={{ padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontWeight: 800 }}>{entry.detail}</div>
                  <div className="muted mono" style={{ fontSize: 11 }}>
                    {fmtTimestamp(entry.createdAtMs)}
                  </div>
                </div>
                <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                  {entry.authorLabel ? `By ${entry.authorLabel}` : 'Shared write'} • {entry.action}
                </div>
              </div>
            ))}
            {!ops?.activity?.length ? <div className="muted">No shared activity yet.</div> : null}
          </div>
        </div>

        {isLoading ? <div className="muted">Loading desk ops...</div> : null}
        {errorText ? <div className="badge badge-red">{errorText}</div> : null}
      </div>
    </DisclosureSection>
  );
}
