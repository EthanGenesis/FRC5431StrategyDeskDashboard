'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { downloadCsvFile, downloadJsonFile, printCurrentPage } from '../lib/export-utils';
import {
  appendWorkspaceActivityShared,
  listWorkspaceActivityShared,
  loadWorkspaceChecklistsShared,
  loadWorkspaceNotesShared,
  saveWorkspaceChecklistsShared,
  saveWorkspaceNotesShared,
} from '../lib/shared-workspace-browser';
import type {
  WorkspaceActivityEntry,
  WorkspaceChecklist,
  WorkspaceNote,
  WorkspaceNoteScope,
} from '../lib/types';
import { useWorkspacePresence } from '../lib/use-workspace-presence';
import {
  createDefaultEventChecklist,
  createWorkspaceActivity,
  createWorkspaceNote,
} from '../lib/workspace-collab';
import DisclosureSection from './ui/DisclosureSection';
import WorkspacePresencePills from './ui/WorkspacePresencePills';

type NotebookPanelProps = {
  workspaceKey: string | null;
  eventKey?: string;
  teamNumber?: number | null;
  matchKey?: string | null;
  operatorLabel?: string;
  historical?: boolean;
  externalUpdateKey?: number;
};

const NOTEBOOK_TEMPLATES = [
  {
    id: 'watch',
    label: 'Watch Item',
    title: 'Watch item',
    body: 'What changed:\nWhy it matters:\nNext action:\n',
  },
  {
    id: 'retro',
    label: 'Post-match Retro',
    title: 'Retro',
    body: 'What worked:\nWhat broke:\nWhat to reuse:\n',
  },
  {
    id: 'pit',
    label: 'Pit Handoff',
    title: 'Pit handoff',
    body: 'Next match:\nQueue note:\nBumper color:\nPit action:\n',
  },
] as const;

function fmtTimestamp(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return '-';
  return new Date(Number(value)).toLocaleString();
}

function matchesScope(
  note: WorkspaceNote,
  scope: WorkspaceNoteScope,
  eventKey: string,
  teamNumber: number | null,
  matchKey: string | null,
) {
  if (scope === 'event') return note.scope === 'event' && note.eventKey === eventKey;
  if (scope === 'team') {
    return note.scope === 'team' && note.eventKey === eventKey && note.teamNumber === teamNumber;
  }
  return note.scope === 'match' && note.eventKey === eventKey && note.matchKey === matchKey;
}

export default function NotebookPanel({
  workspaceKey,
  eventKey = '',
  teamNumber = null,
  matchKey = null,
  operatorLabel = '',
  historical = false,
  externalUpdateKey = 0,
}: NotebookPanelProps) {
  const [notes, setNotes] = useState<WorkspaceNote[]>([]);
  const [checklist, setChecklist] = useState<WorkspaceChecklist | null>(null);
  const [activity, setActivity] = useState<WorkspaceActivityEntry[]>([]);
  const [scope, setScope] = useState<WorkspaceNoteScope>('event');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [filterPinnedOnly, setFilterPinnedOnly] = useState(false);

  const presence = useWorkspacePresence({
    workspaceKey,
    surface: historical ? 'historical_notebook' : 'current_notebook',
    artifactId: selectedNoteId,
    operatorLabel: operatorLabel || null,
    mode: selectedNoteId ? 'editing' : 'viewing',
    enabled: Boolean(workspaceKey && eventKey),
  });

  const reload = useCallback(async () => {
    if (!workspaceKey || !eventKey) {
      setNotes([]);
      setChecklist(null);
      setActivity([]);
      return;
    }
    setErrorText('');
    try {
      const [nextNotes, nextChecklists, nextActivity] = await Promise.all([
        loadWorkspaceNotesShared(workspaceKey),
        loadWorkspaceChecklistsShared(workspaceKey, { scope: 'event', eventKey }),
        listWorkspaceActivityShared(workspaceKey, { eventKey }),
      ]);
      setNotes(nextNotes);
      setChecklist(nextChecklists[0] ?? null);
      setActivity(nextActivity);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to load notebook');
    }
  }, [eventKey, workspaceKey]);

  useEffect(() => {
    void reload();
  }, [externalUpdateKey, reload]);

  const scopedNotes = useMemo(() => {
    const rows = notes
      .filter((note) => matchesScope(note, scope, eventKey, teamNumber, matchKey))
      .sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
        return Number(right.updatedAtMs ?? 0) - Number(left.updatedAtMs ?? 0);
      });
    return filterPinnedOnly ? rows.filter((note) => note.pinned) : rows;
  }, [eventKey, filterPinnedOnly, matchKey, notes, scope, teamNumber]);

  const upsertNotes = useCallback(
    async (nextNotes: WorkspaceNote[]) => {
      if (!workspaceKey) return;
      await saveWorkspaceNotesShared(workspaceKey, nextNotes);
      setNotes(nextNotes);
    },
    [workspaceKey],
  );

  const handleSaveNote = useCallback(async () => {
    if (!workspaceKey || !eventKey || !body.trim()) return;
    setSaving(true);
    setErrorText('');
    try {
      const existing = await loadWorkspaceNotesShared(workspaceKey);
      const existingNote = existing.find((note) => note.id === selectedNoteId) ?? null;
      const note = existingNote
        ? {
            ...existingNote,
            title: title.trim() || existingNote.title,
            body: body.trim(),
            updatedAtMs: Date.now(),
            authorLabel: operatorLabel || null,
          }
        : createWorkspaceNote({
            workspaceKey,
            scope,
            eventKey,
            teamNumber: scope === 'team' ? teamNumber : null,
            matchKey: scope === 'match' ? matchKey : null,
            title: title.trim() || NOTEBOOK_TEMPLATES[0].title,
            body,
            authorLabel: operatorLabel || null,
            pinned: scope === 'match',
          });
      const nextNotes = [note, ...existing.filter((item) => item.id !== note.id)].sort(
        (left, right) => Number(right.updatedAtMs ?? 0) - Number(left.updatedAtMs ?? 0),
      );
      await upsertNotes(nextNotes);
      await appendWorkspaceActivityShared(
        createWorkspaceActivity({
          workspaceKey,
          scope,
          eventKey,
          teamNumber: scope === 'team' ? teamNumber : null,
          matchKey: scope === 'match' ? matchKey : null,
          authorLabel: operatorLabel || null,
          action: 'note_saved',
          detail: `${historical ? 'Historical' : 'Current'} notebook note saved: ${note.title}`,
        }),
      );
      setSelectedNoteId(note.id);
      setTitle('');
      setBody('');
      await reload();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to save notebook note');
    } finally {
      setSaving(false);
    }
  }, [
    body,
    eventKey,
    historical,
    matchKey,
    operatorLabel,
    reload,
    scope,
    selectedNoteId,
    teamNumber,
    title,
    upsertNotes,
    workspaceKey,
  ]);

  const handleDeleteNote = useCallback(
    async (noteId: string) => {
      if (!workspaceKey) return;
      const existing = await loadWorkspaceNotesShared(workspaceKey);
      const deleted = existing.find((note) => note.id === noteId) ?? null;
      await upsertNotes(existing.filter((note) => note.id !== noteId));
      if (deleted) {
        await appendWorkspaceActivityShared(
          createWorkspaceActivity({
            workspaceKey,
            scope: deleted.scope,
            eventKey: deleted.eventKey,
            teamNumber: deleted.teamNumber,
            matchKey: deleted.matchKey,
            authorLabel: operatorLabel || null,
            action: 'note_deleted',
            detail: `Notebook note deleted: ${deleted.title}`,
          }),
        );
      }
      setSelectedNoteId((current) => (current === noteId ? null : current));
      await reload();
    },
    [operatorLabel, reload, upsertNotes, workspaceKey],
  );

  const togglePinned = useCallback(
    async (note: WorkspaceNote) => {
      if (!workspaceKey) return;
      const existing = await loadWorkspaceNotesShared(workspaceKey);
      await upsertNotes(
        existing.map((item) =>
          item.id === note.id
            ? {
                ...item,
                pinned: !item.pinned,
                updatedAtMs: Date.now(),
                authorLabel: operatorLabel || null,
              }
            : item,
        ),
      );
      await reload();
    },
    [operatorLabel, reload, upsertNotes, workspaceKey],
  );

  const ensureChecklist = useCallback(async () => {
    if (!workspaceKey || !eventKey) return;
    const nextChecklist =
      checklist ?? createDefaultEventChecklist(workspaceKey, eventKey, operatorLabel || null);
    await saveWorkspaceChecklistsShared(workspaceKey, [
      nextChecklist,
      ...(await loadWorkspaceChecklistsShared(workspaceKey, { scope: 'event', eventKey })).filter(
        (item) => item.id !== nextChecklist.id,
      ),
    ]);
    await appendWorkspaceActivityShared(
      createWorkspaceActivity({
        workspaceKey,
        scope: 'event',
        eventKey,
        authorLabel: operatorLabel || null,
        action: 'checklist_updated',
        detail: 'Notebook checklist updated',
      }),
    );
    await reload();
  }, [checklist, eventKey, operatorLabel, reload, workspaceKey]);

  const toggleChecklistItem = useCallback(
    async (itemId: string) => {
      if (!workspaceKey || !checklist) return;
      const existing = await loadWorkspaceChecklistsShared(workspaceKey, {
        scope: 'event',
        eventKey,
      });
      const nextChecklist: WorkspaceChecklist = {
        ...checklist,
        updatedAtMs: Date.now(),
        authorLabel: operatorLabel || null,
        items: checklist.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                checked: !item.checked,
                updatedAtMs: Date.now(),
                updatedByLabel: operatorLabel || null,
              }
            : item,
        ),
      };
      await saveWorkspaceChecklistsShared(workspaceKey, [
        nextChecklist,
        ...existing.filter((item) => item.id !== nextChecklist.id),
      ]);
      await reload();
    },
    [checklist, eventKey, operatorLabel, reload, workspaceKey],
  );

  const exportJson = useCallback(() => {
    downloadJsonFile(
      `${historical ? 'historical' : 'current'}-notebook-${eventKey || 'workspace'}.json`,
      {
        scope,
        eventKey,
        teamNumber,
        matchKey,
        notes: scopedNotes,
        checklist,
        activity,
      },
    );
  }, [activity, checklist, eventKey, historical, matchKey, scope, scopedNotes, teamNumber]);

  const exportCsv = useCallback(() => {
    downloadCsvFile(
      `${historical ? 'historical' : 'current'}-notebook-${eventKey || 'workspace'}.csv`,
      scopedNotes.map((note) => ({
        title: note.title,
        scope: note.scope,
        eventKey: note.eventKey,
        teamNumber: note.teamNumber,
        matchKey: note.matchKey,
        pinned: note.pinned,
        authorLabel: note.authorLabel,
        updatedAt: fmtTimestamp(note.updatedAtMs),
        body: note.body,
      })),
    );
  }, [eventKey, historical, scopedNotes]);

  return (
    <div className="notebook-print-root">
      <DisclosureSection
        storageKey={historical ? 'ui.historical.notebook' : 'ui.current.notebook'}
        title="Analyst Notebook"
        description="Pinned notes, scoped worklog, checklist context, and quick packet exports."
        defaultOpen
      >
        <div className="stack-12">
          <div className="panel" style={{ padding: 16 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 10,
                flexWrap: 'wrap',
                marginBottom: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 900 }}>Notebook Controls</div>
                <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                  Event-scoped worklog for current and historical desk prep.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="button" type="button" onClick={exportJson}>
                  Export JSON
                </button>
                <button className="button" type="button" onClick={exportCsv}>
                  Export CSV
                </button>
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => printCurrentPage('Notebook Packet')}
                >
                  Print Packet
                </button>
              </div>
            </div>
            <div className="grid-3" style={{ marginBottom: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  Scope
                </span>
                <select
                  className="input"
                  value={scope}
                  onChange={(event) => {
                    setScope(event.target.value as WorkspaceNoteScope);
                    setSelectedNoteId(null);
                  }}
                >
                  <option value="event">Event</option>
                  <option value="team">Team</option>
                  <option value="match">Match</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  Quick Template
                </span>
                <select
                  className="input"
                  onChange={(event) => {
                    const template = NOTEBOOK_TEMPLATES.find(
                      (item) => item.id === event.target.value,
                    );
                    if (!template) return;
                    setTitle(template.title);
                    setBody(template.body);
                  }}
                  defaultValue=""
                >
                  <option value="">Select a template</option>
                  {NOTEBOOK_TEMPLATES.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  Notebook Filters
                </span>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={filterPinnedOnly}
                    onChange={(event) => setFilterPinnedOnly(event.target.checked)}
                  />
                  Pinned only
                </label>
              </label>
            </div>
            <WorkspacePresencePills
              entries={presence.otherEntries}
              emptyLabel="No other operators are in this notebook right now."
            />
            {presence.hasConflict ? (
              <div className="badge badge-yellow" style={{ marginTop: 10 }}>
                Another operator is editing the same notebook context. Saves remain last-write-wins.
              </div>
            ) : null}
          </div>

          <div className="grid-2">
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Capture Note</div>
              <div className="grid-2" style={{ marginBottom: 10 }}>
                <input
                  className="input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Short title"
                />
                <div className="muted" style={{ alignSelf: 'center', fontSize: 12 }}>
                  {operatorLabel
                    ? `Posting as ${operatorLabel}`
                    : 'Add an operator label in Settings.'}
                </div>
              </div>
              <textarea
                className="input"
                rows={7}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Capture the observation, why it matters, and what the desk should do next."
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => void handleSaveNote()}
                >
                  {saving ? 'Saving...' : selectedNoteId ? 'Update Note' : 'Save Note'}
                </button>
                {selectedNoteId ? (
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      setSelectedNoteId(null);
                      setTitle('');
                      setBody('');
                    }}
                  >
                    Clear Selection
                  </button>
                ) : null}
              </div>
            </div>

            <div className="panel" style={{ padding: 16 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginBottom: 10,
                }}
              >
                <div style={{ fontWeight: 900 }}>Checklist + Activity</div>
                <button className="button" type="button" onClick={() => void ensureChecklist()}>
                  {checklist ? 'Refresh Checklist' : 'Seed Checklist'}
                </button>
              </div>
              {checklist ? (
                <div className="stack-8" style={{ marginBottom: 12 }}>
                  {checklist.items.map((item) => (
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
                          {item.updatedByLabel
                            ? `Updated by ${item.updatedByLabel}`
                            : 'Shared item'}{' '}
                          at {fmtTimestamp(item.updatedAtMs)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="muted" style={{ marginBottom: 12 }}>
                  No event checklist exists yet.
                </div>
              )}
              <div className="stack-8" style={{ maxHeight: 220, overflow: 'auto' }}>
                {activity.slice(0, 18).map((entry) => (
                  <div key={entry.id} className="panel-2" style={{ padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontWeight: 800 }}>{entry.detail}</div>
                      <div className="muted mono" style={{ fontSize: 11 }}>
                        {fmtTimestamp(entry.createdAtMs)}
                      </div>
                    </div>
                    <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                      {entry.authorLabel ? `By ${entry.authorLabel}` : 'Shared write'} |{' '}
                      {entry.action}
                    </div>
                  </div>
                ))}
                {!activity.length ? <div className="muted">No notebook activity yet.</div> : null}
              </div>
            </div>
          </div>

          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Scoped Notes</div>
            <div className="stack-8">
              {scopedNotes.map((note) => (
                <div key={note.id} className="panel-2" style={{ padding: 12 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800 }}>
                        {note.title}{' '}
                        {note.pinned ? <span className="badge badge-blue">Pinned</span> : null}
                      </div>
                      <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                        {note.scope.toUpperCase()} {note.authorLabel ? `| ${note.authorLabel}` : ''}{' '}
                        | {fmtTimestamp(note.updatedAtMs)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        className="button"
                        type="button"
                        onClick={() => {
                          setSelectedNoteId(note.id);
                          setTitle(note.title);
                          setBody(note.body);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="button"
                        type="button"
                        onClick={() => void togglePinned(note)}
                      >
                        {note.pinned ? 'Unpin' : 'Pin'}
                      </button>
                      <button
                        className="button"
                        type="button"
                        onClick={() => void handleDeleteNote(note.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="muted" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
                    {note.body || 'No note body.'}
                  </div>
                </div>
              ))}
              {!scopedNotes.length ? (
                <div className="muted">No notes exist for this notebook scope yet.</div>
              ) : null}
            </div>
          </div>

          {errorText ? <div className="badge badge-red">{errorText}</div> : null}
        </div>
      </DisclosureSection>
    </div>
  );
}
