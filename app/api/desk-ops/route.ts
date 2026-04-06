import type { NextResponse } from 'next/server';

import { beginRouteRequest, routeErrorJson, routeJson } from '../../../lib/observability';
import { loadSnapshotCacheRecord } from '../../../lib/source-cache-server';
import { loadSharedActiveTarget } from '../../../lib/shared-target-server';
import type { AppSnapshot, DeskOpsResponse, WorkspaceNote } from '../../../lib/types';
import { getEventWorkspaceKey } from '../../../lib/workspace-key';
import { buildDeskOpsInsights } from '../../../lib/desk-ops-insights';
import {
  loadWorkspaceActivitySharedServer,
  loadWorkspaceChecklistsSharedServer,
  loadWorkspaceNotesSharedServer,
} from '../../../lib/shared-workspace-server';
import {
  buildDeskOpsDeltas,
  buildQueueLadder,
  summarizeSourceTrust,
} from '../../../lib/workspace-collab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseOptionalTeamNumber(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function sortNotes(notes: WorkspaceNote[]): WorkspaceNote[] {
  return [...notes].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return Number(right.updatedAtMs ?? 0) - Number(left.updatedAtMs ?? 0);
  });
}

function emptyDeskOpsResponse(workspaceKey: string): DeskOpsResponse {
  return {
    generatedAtMs: Date.now(),
    workspaceKey,
    eventKey: null,
    teamNumber: null,
    eventName: null,
    queueText: null,
    queueMatchesAway: null,
    queueLadder: buildQueueLadder(null, null),
    currentMatchLabel: null,
    nextMatchLabel: null,
    sourceTrust: null,
    checklist: null,
    notes: [],
    activity: [],
    deltas: [],
    impactSummary: null,
    delayDiagnostics: null,
    rivalPressure: [],
    keyMatchWatchlist: [],
  };
}

export async function GET(
  req: Request,
): Promise<NextResponse<DeskOpsResponse | { error: string }>> {
  const routeContext = beginRouteRequest('/api/desk-ops', req);
  try {
    const { searchParams } = new URL(req.url);
    const sharedTarget = await loadSharedActiveTarget();
    const eventKey = String(searchParams.get('eventKey') ?? sharedTarget.eventKey ?? '').trim();
    const teamNumber =
      parseOptionalTeamNumber(searchParams.get('team')) ?? sharedTarget.teamNumber ?? null;
    const workspaceKey = eventKey
      ? (getEventWorkspaceKey(eventKey) ?? sharedTarget.workspaceKey)
      : sharedTarget.workspaceKey;

    if (!eventKey || !teamNumber) {
      return routeJson(routeContext, emptyDeskOpsResponse(workspaceKey), undefined, {
        workspaceKey,
        eventKey: eventKey || null,
        teamNumber,
      });
    }

    const [snapshot, notes, checklists, activity] = await Promise.all([
      loadSnapshotCacheRecord<AppSnapshot>('snapshot', eventKey, teamNumber, 180).catch(() => null),
      loadWorkspaceNotesSharedServer(workspaceKey).catch(() => []),
      loadWorkspaceChecklistsSharedServer(workspaceKey, { scope: 'event', eventKey }).catch(
        () => [],
      ),
      loadWorkspaceActivitySharedServer(workspaceKey, { eventKey }, 30).catch(() => []),
    ]);

    const loadedTeamOps = snapshot?.nexus?.loadedTeamOps ?? null;
    const recentSignals = Array.isArray(snapshot?.liveSignals)
      ? snapshot.liveSignals.slice(0, 5)
      : [];
    const insights = buildDeskOpsInsights(snapshot, teamNumber);
    const checklist = checklists[0] ?? null;
    const relevantNotes = sortNotes(
      notes.filter((note) => {
        if (note.scope === 'event') return note.eventKey === eventKey;
        if (note.scope === 'team')
          return note.eventKey === eventKey && note.teamNumber === teamNumber;
        if (note.scope === 'match') return note.eventKey === eventKey;
        return false;
      }),
    ).slice(0, 12);

    const response: DeskOpsResponse = {
      generatedAtMs: Date.now(),
      workspaceKey,
      eventKey,
      teamNumber,
      eventName:
        stringValue(snapshot?.tba?.event?.short_name).trim() ||
        stringValue(snapshot?.tba?.event?.name).trim() ||
        eventKey,
      queueText: loadedTeamOps?.queueState ?? snapshot?.nexus?.queueText ?? null,
      queueMatchesAway:
        loadedTeamOps?.queueMatchesAway ?? snapshot?.nexus?.queueMatchesAway ?? null,
      queueLadder: buildQueueLadder(
        loadedTeamOps?.queueState ?? snapshot?.nexus?.queueText ?? null,
        loadedTeamOps?.queueMatchesAway ?? snapshot?.nexus?.queueMatchesAway ?? null,
        {
          queue: loadedTeamOps?.estimatedQueueTimeMs ?? null,
          onDeck: loadedTeamOps?.estimatedOnDeckTimeMs ?? null,
          onField: loadedTeamOps?.estimatedOnFieldTimeMs ?? null,
          start: loadedTeamOps?.estimatedStartTimeMs ?? null,
        },
      ),
      currentMatchLabel: loadedTeamOps?.currentMatchLabel ?? null,
      nextMatchLabel: loadedTeamOps?.nextMatchLabel ?? null,
      sourceTrust: summarizeSourceTrust(snapshot?.validation ?? null),
      checklist,
      notes: relevantNotes,
      activity,
      deltas: buildDeskOpsDeltas({
        currentMatchLabel: loadedTeamOps?.currentMatchLabel ?? null,
        nextMatchLabel: loadedTeamOps?.nextMatchLabel ?? null,
        queueText: loadedTeamOps?.queueState ?? snapshot?.nexus?.queueText ?? null,
        recentSignals: recentSignals.map((signal) => ({
          id: signal.id,
          title: signal.title,
          createdAtMs: signal.createdAtMs,
        })),
        recentActivity: activity,
      }),
      impactSummary: insights.impactSummary,
      delayDiagnostics: insights.delayDiagnostics,
      rivalPressure: insights.rivalPressure,
      keyMatchWatchlist: insights.keyMatchWatchlist,
    };

    return routeJson(routeContext, response, undefined, {
      workspaceKey,
      eventKey,
      teamNumber,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown desk-ops error';
    return routeErrorJson(routeContext, message, 500);
  }
}
