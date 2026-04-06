'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { downloadCsvFile, downloadJsonFile, printCurrentPage } from '../lib/export-utils';
import { fetchJsonOrThrow } from '../lib/httpCache';
import { formatCountdown } from '../lib/logic';
import { buildPitOpsResponse } from '../lib/pit-ops';
import type { AppSnapshot, PitOpsResponse, PitTimelineMatchRow } from '../lib/types';

type PitModeOverlayProps = {
  open: boolean;
  onClose: () => void;
  workspaceKey: string | null;
  eventKey?: string;
  teamNumber?: number | null;
  snapshotOverride?: AppSnapshot | null;
  externalUpdateKey?: number;
};

function fmtClockTime(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return '-';
  return new Date(Number(value)).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fallbackLabel(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function bumperTone(color: string | null | undefined): { background: string; color: string } {
  const normalized = String(color ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'red') return { background: 'rgba(239, 68, 68, 0.18)', color: '#fecaca' };
  if (normalized === 'blue') return { background: 'rgba(59, 130, 246, 0.18)', color: '#bfdbfe' };
  return { background: 'rgba(148, 163, 184, 0.16)', color: 'var(--text)' };
}

function matchTone(row: PitTimelineMatchRow) {
  if (row.state === 'completed') return 'rgba(95, 210, 162, 0.08)';
  if (row.state === 'playing_now') return 'rgba(233, 195, 109, 0.16)';
  if (row.isLoadedTeamMatch) return 'rgba(103, 210, 238, 0.12)';
  return 'transparent';
}

export default function PitModeOverlay({
  open,
  onClose,
  workspaceKey,
  eventKey = '',
  teamNumber = null,
  snapshotOverride = null,
  externalUpdateKey = 0,
}: PitModeOverlayProps) {
  const [payload, setPayload] = useState<PitOpsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());

  const loadPitOps = useCallback(async () => {
    if (!open) return;
    if (snapshotOverride && workspaceKey && eventKey && teamNumber) {
      setPayload(
        buildPitOpsResponse({
          workspaceKey,
          eventKey,
          teamNumber,
          snapshot: snapshotOverride,
          nowMs: Date.now(),
        }),
      );
      setErrorText('');
      return;
    }
    if (!eventKey || !teamNumber) {
      setPayload(null);
      return;
    }
    setLoading(true);
    setErrorText('');
    try {
      const query = new URLSearchParams({
        eventKey,
        team: String(teamNumber),
      });
      const response = await fetchJsonOrThrow<PitOpsResponse>(
        `/api/pit-ops?${query.toString()}`,
        { cache: 'default' },
        'Pit mode failed',
      );
      setPayload(response);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unknown pit-mode error');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [eventKey, open, snapshotOverride, teamNumber, workspaceKey]);

  useEffect(() => {
    if (!open) return undefined;
    void loadPitOps();
    const id = window.setInterval(() => {
      setNowMs(Date.now());
      void loadPitOps();
    }, 5000);
    return () => window.clearInterval(id);
  }, [externalUpdateKey, loadPitOps, open]);

  useEffect(() => {
    if (!open) return undefined;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  const derivedPayload = useMemo(() => {
    if (!payload) return null;
    return {
      ...payload,
      countdownMs:
        payload.countdownMs != null
          ? Math.max(0, Number(payload.countdownMs) - Math.max(0, nowMs - payload.generatedAtMs))
          : null,
      timeline: payload.timeline.map((row) =>
        row.kind === 'match' && row.countdownMs != null
          ? {
              ...row,
              countdownMs: Math.max(
                0,
                Number(row.countdownMs) - Math.max(0, nowMs - payload.generatedAtMs),
              ),
            }
          : row,
      ),
    };
  }, [nowMs, payload]);

  const exportJson = useCallback(() => {
    if (!derivedPayload) return;
    downloadJsonFile(
      `pit-mode-${fallbackLabel(eventKey, 'event')}-${teamNumber ?? 'team'}.json`,
      derivedPayload,
    );
  }, [derivedPayload, eventKey, teamNumber]);

  const exportCsv = useCallback(() => {
    if (!derivedPayload) return;
    downloadCsvFile(
      `pit-timeline-${fallbackLabel(eventKey, 'event')}-${teamNumber ?? 'team'}.csv`,
      derivedPayload.timeline.map((row) =>
        row.kind === 'turnaround'
          ? {
              kind: row.kind,
              from: row.fromLabel,
              to: row.toLabel,
              durationMs: row.durationMs,
              durationLabel: row.durationLabel,
            }
          : {
              kind: row.kind,
              label: row.label,
              state: row.state,
              countdown: row.countdownMs != null ? formatCountdown(row.countdownMs) : '-',
              loadedTeamMatch: row.isLoadedTeamMatch,
              allianceColor: row.allianceColor,
              teams: row.teamKeys.join(' '),
            },
      ),
    );
  }, [derivedPayload, eventKey, teamNumber]);

  if (!open) return null;

  const bumperStyles = bumperTone(derivedPayload?.bumperColor);

  return (
    <div
      className="pit-mode-overlay pit-print-root"
      role="dialog"
      aria-modal="true"
      aria-label="Pit mode"
    >
      <div className="pit-mode-shell">
        <button className="button pit-mode-close" type="button" onClick={onClose}>
          Close
        </button>

        <div className="pit-mode-header panel">
          <div>
            <div className="pit-mode-kicker">Pit Mode</div>
            <div className="pit-mode-title">
              {fallbackLabel(derivedPayload?.eventName ?? eventKey, 'Waiting for event')} | Team{' '}
              {teamNumber ?? '-'}
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              Read-only pit handoff view with countdown, queue state, bumper color, and full-event
              timeline.
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
              onClick={() => printCurrentPage('Pit Handoff Packet')}
            >
              Print Packet
            </button>
          </div>
        </div>

        <div className="pit-mode-top-grid">
          <div className="pit-mode-countdown panel">
            <div className="pit-mode-kicker">Next Match Countdown</div>
            <div className="pit-mode-countdown-value">
              {derivedPayload?.countdownMs != null
                ? formatCountdown(derivedPayload.countdownMs)
                : '--:--'}
            </div>
            <div className="muted" style={{ marginTop: 10 }}>
              {fallbackLabel(
                derivedPayload?.nextMatchLabel ?? derivedPayload?.currentMatchLabel,
                'Waiting for match assignment',
              )}
            </div>
          </div>

          <div className="pit-mode-summary-grid">
            <div className="panel pit-mode-card">
              <div className="pit-mode-kicker">Bumper</div>
              <div className="pit-mode-bumper-chip" style={bumperStyles}>
                {fallbackLabel(derivedPayload?.bumperColor, 'Unknown').toUpperCase()}
              </div>
              <div className="muted" style={{ marginTop: 8 }}>
                Alliance {derivedPayload?.allianceColor ?? '-'}
              </div>
            </div>
            <div className="panel pit-mode-card">
              <div className="pit-mode-kicker">Queue</div>
              <div className="pit-mode-card-value">
                {fallbackLabel(derivedPayload?.queueState, 'Waiting')}
              </div>
              <div className="muted" style={{ marginTop: 8 }}>
                {derivedPayload?.queueMatchesAway != null
                  ? `${derivedPayload.queueMatchesAway} matches away`
                  : 'Matches away unavailable'}
              </div>
            </div>
            <div className="panel pit-mode-card">
              <div className="pit-mode-kicker">Pit</div>
              <div className="pit-mode-card-value">
                {fallbackLabel(derivedPayload?.pitAddress, 'Unknown')}
              </div>
              <div className="muted" style={{ marginTop: 8 }}>
                Inspection {fallbackLabel(derivedPayload?.inspectionStatus, 'Unknown')}
              </div>
            </div>
            <div className="panel pit-mode-card">
              <div className="pit-mode-kicker">Timing</div>
              <div className="pit-mode-card-value">
                {fmtClockTime(derivedPayload?.estimatedStartTimeMs)}
              </div>
              <div className="muted" style={{ marginTop: 8 }}>
                Queue {fmtClockTime(derivedPayload?.estimatedQueueTimeMs)} | On deck{' '}
                {fmtClockTime(derivedPayload?.estimatedOnDeckTimeMs)}
              </div>
            </div>
          </div>
        </div>

        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Queue Ladder</div>
          <div className="pit-mode-queue-strip">
            {(derivedPayload?.queueLadder ?? []).map((step) => (
              <div
                key={step.id}
                className="pit-mode-queue-step"
                data-active={step.active ? 'true' : 'false'}
                data-completed={step.completed ? 'true' : 'false'}
              >
                <div className="pit-mode-kicker">{step.label}</div>
                <div style={{ fontWeight: 900, marginTop: 4 }}>
                  {step.active ? 'Active' : step.completed ? 'Passed' : 'Pending'}
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  ETA {step.etaLabel ?? '-'}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel" style={{ padding: 16, minHeight: 0 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Event Timeline</div>
          <div className="pit-mode-timeline">
            {(derivedPayload?.timeline ?? []).map((row) =>
              row.kind === 'turnaround' ? (
                <div key={row.id} className="pit-mode-turnaround">
                  <div style={{ fontWeight: 800 }}>{row.durationLabel}</div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {row.fromLabel} {'->'} {row.toLabel}
                  </div>
                </div>
              ) : (
                <div
                  key={row.id}
                  className="pit-mode-match-row"
                  style={{ background: matchTone(row) }}
                  data-loaded-team={row.isLoadedTeamMatch ? 'true' : 'false'}
                >
                  <div>
                    <div style={{ fontWeight: 900 }}>{row.label}</div>
                    <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                      {row.teamKeys.join(' ')}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="badge">{row.state.replace('_', ' ')}</div>
                    <div style={{ marginTop: 8, fontWeight: 900 }}>
                      {row.countdownMs != null
                        ? formatCountdown(row.countdownMs)
                        : fmtClockTime(row.timeMs)}
                    </div>
                    <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                      {row.isLoadedTeamMatch
                        ? `Our match${row.allianceColor ? ` | ${row.allianceColor}` : ''}`
                        : 'Other match'}
                    </div>
                  </div>
                </div>
              ),
            )}
            {!derivedPayload?.timeline?.length ? (
              <div className="muted">No event timeline is available yet.</div>
            ) : null}
          </div>
        </div>

        {loading ? <div className="muted">Loading pit mode...</div> : null}
        {errorText ? <div className="badge badge-red">{errorText}</div> : null}
      </div>
    </div>
  );
}
