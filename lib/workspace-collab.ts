import type {
  DeskOpsDeltaItem,
  DeskOpsSourceTrust,
  QueueLadderStep,
  ValidationSnapshot,
  WorkspaceActivityType,
  WorkspaceActivityEntry,
  WorkspaceChecklist,
  WorkspaceChecklistItem,
  WorkspaceNote,
  WorkspaceNoteScope,
} from './types';

export function createWorkspaceArtifactId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultChecklistItems(
  operatorLabel: string | null = null,
): WorkspaceChecklistItem[] {
  const updatedAtMs = Date.now();
  return [
    'Verify shared target and warm boot',
    'Verify queue audio and webcast visibility',
    'Verify FIRST / Nexus / TBA source health',
    'Load active pick list and playoff lab',
    'Confirm next-match strategy board is ready',
  ].map((text, index) => ({
    id: `item_${index + 1}`,
    text,
    checked: false,
    updatedAtMs,
    updatedByLabel: operatorLabel,
  }));
}

export function createDefaultEventChecklist(
  workspaceKey: string,
  eventKey: string | null,
  operatorLabel: string | null = null,
): WorkspaceChecklist {
  const now = Date.now();
  return {
    id: createWorkspaceArtifactId('checklist'),
    workspaceKey,
    scope: 'event',
    eventKey,
    teamNumber: null,
    matchKey: null,
    label: 'Event-Day Readiness',
    items: createDefaultChecklistItems(operatorLabel),
    authorLabel: operatorLabel,
    createdAtMs: now,
    updatedAtMs: now,
  };
}

export function createWorkspaceNote(params: {
  workspaceKey: string;
  scope: WorkspaceNoteScope;
  eventKey?: string | null;
  teamNumber?: number | null;
  matchKey?: string | null;
  title?: string;
  body?: string;
  tags?: string[];
  pinned?: boolean;
  authorLabel?: string | null;
}): WorkspaceNote {
  const now = Date.now();
  return {
    id: createWorkspaceArtifactId('note'),
    workspaceKey: params.workspaceKey,
    scope: params.scope,
    eventKey: params.eventKey ?? null,
    teamNumber: params.teamNumber ?? null,
    matchKey: params.matchKey ?? null,
    title: params.title?.trim() ?? 'Untitled note',
    body: params.body?.trim() ?? '',
    tags: Array.isArray(params.tags) ? params.tags.filter(Boolean) : [],
    pinned: Boolean(params.pinned),
    authorLabel: params.authorLabel ?? null,
    createdAtMs: now,
    updatedAtMs: now,
  };
}

export function createWorkspaceActivity(params: {
  workspaceKey: string;
  action: WorkspaceActivityType;
  detail: string;
  scope?: 'workspace' | 'event' | 'team' | 'match';
  eventKey?: string | null;
  teamNumber?: number | null;
  matchKey?: string | null;
  authorLabel?: string | null;
  payload?: Record<string, unknown> | null;
}): WorkspaceActivityEntry {
  return {
    id: createWorkspaceArtifactId('activity'),
    workspaceKey: params.workspaceKey,
    scope: params.scope ?? 'workspace',
    eventKey: params.eventKey ?? null,
    teamNumber: params.teamNumber ?? null,
    matchKey: params.matchKey ?? null,
    action: params.action,
    detail: params.detail,
    authorLabel: params.authorLabel ?? null,
    createdAtMs: Date.now(),
    payload: params.payload ?? null,
  };
}

export function buildQueueLadder(
  queueState: string | null | undefined,
  queueMatchesAway: number | null | undefined,
  estimatedTimes: {
    queue?: number | null;
    onDeck?: number | null;
    onField?: number | null;
    start?: number | null;
  } = {},
): QueueLadderStep[] {
  const matchesAway = Number.isFinite(Number(queueMatchesAway)) ? Number(queueMatchesAway) : null;
  const activeState = String(queueState ?? '')
    .trim()
    .toUpperCase();
  const now = Date.now();
  const etaLabel = (value: number | null | undefined) => {
    if (!Number.isFinite(Number(value))) return null;
    const deltaMinutes = Math.max(0, Math.round((Number(value) - now) / 60000));
    return deltaMinutes <= 0 ? 'Now' : `${deltaMinutes}m`;
  };

  const steps: QueueLadderStep[] = [
    {
      id: 'QUEUE_5',
      label: 'Queue 5',
      active: activeState === 'QUEUE_5',
      completed:
        matchesAway != null
          ? matchesAway < 5
          : ['QUEUE_2', 'QUEUE_1', 'PLAYING_NOW'].includes(activeState),
      etaLabel: etaLabel(estimatedTimes.queue),
    },
    {
      id: 'QUEUE_2',
      label: 'Queue 2',
      active: activeState === 'QUEUE_2',
      completed:
        matchesAway != null ? matchesAway < 2 : ['QUEUE_1', 'PLAYING_NOW'].includes(activeState),
      etaLabel: etaLabel(estimatedTimes.onDeck ?? estimatedTimes.queue),
    },
    {
      id: 'QUEUE_1',
      label: 'Queue 1',
      active: activeState === 'QUEUE_1',
      completed: matchesAway != null ? matchesAway < 1 : activeState === 'PLAYING_NOW',
      etaLabel: etaLabel(estimatedTimes.onField ?? estimatedTimes.onDeck),
    },
    {
      id: 'PLAYING_NOW',
      label: 'Playing Now',
      active: activeState === 'PLAYING_NOW',
      completed: false,
      etaLabel: etaLabel(estimatedTimes.start ?? estimatedTimes.onField),
    },
  ];
  return steps;
}

export function summarizeSourceTrust(
  validation: ValidationSnapshot | null | undefined,
): DeskOpsSourceTrust | null {
  if (!validation) return null;
  const discrepancies = Array.isArray(validation.discrepancies) ? validation.discrepancies : [];
  return {
    firstStatus: validation.firstStatus,
    nexusStatus: validation.officialAvailability === 'full' ? 'available' : 'partial',
    officialAvailability: validation.officialAvailability,
    mismatchCount: discrepancies.filter((item) => item.status === 'mismatch').length,
    missingCount: discrepancies.filter((item) => item.status === 'missing').length,
    staleSeconds: validation.staleSeconds ?? null,
    summary: validation.summary,
  };
}

export function buildDeskOpsDeltas(input: {
  currentMatchLabel?: string | null;
  nextMatchLabel?: string | null;
  queueText?: string | null;
  recentSignals?: { id: string; title: string; createdAtMs: number }[];
  recentActivity?: WorkspaceActivityEntry[];
}): DeskOpsDeltaItem[] {
  const deltas: DeskOpsDeltaItem[] = [];
  if (input.queueText) {
    deltas.push({
      id: 'queue',
      label: 'Queue status',
      detail: input.queueText,
      tone: 'positive',
      createdAtMs: Date.now(),
    });
  }
  if (input.currentMatchLabel || input.nextMatchLabel) {
    deltas.push({
      id: 'match_window',
      label: 'Match window',
      detail: [input.currentMatchLabel, input.nextMatchLabel].filter(Boolean).join(' -> '),
      tone: 'neutral',
      createdAtMs: Date.now(),
    });
  }
  const latestSignal = input.recentSignals?.[0] ?? null;
  if (latestSignal) {
    deltas.push({
      id: `signal_${latestSignal.id}`,
      label: 'Latest live signal',
      detail: latestSignal.title,
      tone: 'warning',
      createdAtMs: latestSignal.createdAtMs,
    });
  }
  const latestActivity = input.recentActivity?.[0] ?? null;
  if (latestActivity) {
    deltas.push({
      id: `activity_${latestActivity.id}`,
      label: 'Latest collaboration',
      detail: latestActivity.detail,
      tone: 'neutral',
      createdAtMs: latestActivity.createdAtMs,
    });
  }
  return deltas.slice(0, 4);
}
