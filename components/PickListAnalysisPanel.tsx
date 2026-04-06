'use client';

import { useCallback, useEffect, useState } from 'react';

import { downloadCsvFile, downloadJsonFile, printCurrentPage } from '../lib/export-utils';
import { fetchJsonOrThrow } from '../lib/httpCache';
import type { PickListAnalysisResponse } from '../lib/types';
import AnalyticsChartBlock from './AnalyticsChartBlock';
import DisclosureSection from './ui/DisclosureSection';

type PickListAnalysisPanelProps = {
  eventKey?: string;
  teamNumber?: number | null;
  activePickListId?: string | null;
  externalUpdateKey?: number;
  analysisOverride?: PickListAnalysisResponse | null;
};

function fmt(value: unknown, digits = 1): string {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(digits);
}

export default function PickListAnalysisPanel({
  eventKey = '',
  teamNumber = null,
  activePickListId = null,
  externalUpdateKey = 0,
  analysisOverride = null,
}: PickListAnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<PickListAnalysisResponse | null>(null);
  const [errorText, setErrorText] = useState('');

  const loadAnalysis = useCallback(async () => {
    if (analysisOverride) {
      setAnalysis(analysisOverride);
      setErrorText('');
      return;
    }
    if (!eventKey || !teamNumber) {
      setAnalysis(null);
      return;
    }
    setErrorText('');
    try {
      const query = new URLSearchParams({
        eventKey,
        team: String(teamNumber),
      });
      if (activePickListId) query.set('activePickListId', activePickListId);
      const response = await fetchJsonOrThrow<PickListAnalysisResponse>(
        `/api/pick-list-analysis?${query.toString()}`,
        { cache: 'default' },
        'Pick-list analysis failed',
      );
      setAnalysis(response);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unknown pick-list analysis error');
      setAnalysis(null);
    }
  }, [activePickListId, analysisOverride, eventKey, teamNumber]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadAnalysis();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [externalUpdateKey, loadAnalysis]);

  if (!eventKey || !teamNumber) return null;

  return (
    <div className="pick-list-print-root">
      <DisclosureSection
        storageKey="ui.predict.pick_list.analysis"
        title="Pick List Decision Center"
        description="Role-fit board, likely early-pick pressure, and saved scenario comparison."
        defaultOpen
      >
        <div className="stack-12">
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="button"
              type="button"
              onClick={() =>
                downloadJsonFile(
                  `pick-list-analysis-${eventKey}.json`,
                  analysis ?? { eventKey, teamNumber },
                )
              }
            >
              Export JSON
            </button>
            <button
              className="button"
              type="button"
              onClick={() =>
                downloadCsvFile(
                  `pick-list-analysis-${eventKey}.csv`,
                  (analysis?.decisionLogEntries ?? []).map((entry) => ({
                    teamNumber: entry.teamNumber,
                    nickname: entry.nickname,
                    bucket: entry.bucket,
                    tag: entry.tag,
                    comment: entry.comment,
                  })),
                )
              }
            >
              Export CSV
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={() => printCurrentPage('Pick List Packet')}
            >
              Print Packet
            </button>
          </div>
          <div className="grid-3">
            {(analysis?.bestByRole ?? []).map((item) => (
              <div key={item.label} className="panel" style={{ padding: 16 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  {item.label}
                </div>
                <div style={{ fontWeight: 900, marginTop: 6 }}>
                  {item.teamNumber ?? '-'} {item.teamKey ?? ''}
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  {item.insight}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {(item.tags ?? []).map((tag) => (
                    <span key={tag} className="badge">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                  Pick {fmt(item.pick, 0)} | Fit {fmt(item.fit, 0)} | Ready {fmt(item.ready, 0)} |
                  Ceiling {fmt(item.ceiling, 0)}
                </div>
              </div>
            ))}
          </div>

          <div className="grid-3">
            {(analysis?.bucketBoards ?? []).map((board) => (
              <div key={board.key} className="panel" style={{ padding: 16 }}>
                <div style={{ fontWeight: 900, marginBottom: 10 }}>{board.label}</div>
                <div className="stack-8">
                  {board.rows.map((row) => (
                    <div
                      key={`${board.key}_${row.teamKey}`}
                      className="panel-2"
                      style={{ padding: 10 }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ fontWeight: 800 }}>
                          {row.teamNumber ?? '-'} {row.nickname ?? row.teamKey}
                        </div>
                        {row.recommendation ? (
                          <div className="badge">{row.recommendation}</div>
                        ) : null}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        {row.tag ? <span className="badge">{row.tag}</span> : null}
                        {row.comment ? <span className="badge badge-blue">Logged</span> : null}
                      </div>
                      <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                        {row.detail}
                      </div>
                      <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                        Fit {fmt(row.fit, 0)} | Ready {fmt(row.ready, 0)} | Ceiling{' '}
                        {fmt(row.ceiling, 0)} | Denial {fmt(row.denial, 0)}
                      </div>
                      {row.comment ? (
                        <div className="muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                          &ldquo;{row.comment}&rdquo;
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {!board.rows.length ? (
                    <div className="muted">No entries on this board yet.</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="grid-2">
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Likely First-Pick Watchlist</div>
              <div className="stack-8">
                {(analysis?.likelyFirstPicks ?? []).map((row) => (
                  <div key={row.teamKey ?? row.detail} className="panel-2" style={{ padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontWeight: 800 }}>
                        {row.teamNumber ?? '-'} {row.nickname ?? row.teamKey ?? ''}
                      </div>
                      <div className="muted">Rank {row.rank ?? '-'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {(row.tags ?? []).map((tag) => (
                        <span key={tag} className="badge">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                      {row.detail}
                    </div>
                  </div>
                ))}
                {!analysis?.likelyFirstPicks?.length ? (
                  <div className="muted">No likely first-pick watchlist yet.</div>
                ) : null}
              </div>
            </div>
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Captain Threat Board</div>
              <div className="stack-8">
                {(analysis?.captainThreats ?? []).map((row) => (
                  <div key={row.teamKey ?? row.detail} className="panel-2" style={{ padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontWeight: 800 }}>
                        {row.teamNumber ?? '-'} {row.nickname ?? row.teamKey ?? ''}
                      </div>
                      <div className="muted">Seed band {row.rank ?? '-'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {(row.tags ?? []).map((tag) => (
                        <span key={tag} className="badge">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                      {row.detail}
                    </div>
                  </div>
                ))}
                {!analysis?.captainThreats?.length ? (
                  <div className="muted">No captain threats surfaced yet.</div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid-2">
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>If Selection Started Now</div>
              <div className="stack-8">
                {(analysis?.ifSelectionStartedNow ?? []).map((row) => (
                  <div
                    key={`${row.label}_${row.teamKey ?? 'none'}`}
                    className="panel-2"
                    style={{ padding: 10 }}
                  >
                    <div style={{ fontWeight: 800 }}>
                      {row.label}: {row.teamNumber ?? '-'} {row.teamKey ?? ''}
                    </div>
                    <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                      {row.detail}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <AnalyticsChartBlock
              title="Active Bucket Strength"
              description="How much strength and density the active pick list is carrying in each bucket."
              data={analysis?.bucketSummary ?? []}
              chartFamily="bar"
              series={[
                { key: 'count', label: 'Count', color: '#94a3b8' },
                { key: 'avgEpa', label: 'Avg EPA', color: '#ff9f68' },
                { key: 'avgComposite', label: 'Avg Composite', color: '#2dd4bf' },
              ]}
              valueFormatter={(value) => fmt(value, 1)}
            />
          </div>

          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Decision Log</div>
            <div className="stack-8">
              {(analysis?.decisionLogEntries ?? []).map((entry) => (
                <div
                  key={`${entry.bucket}_${entry.teamKey}`}
                  className="panel-2"
                  style={{ padding: 10 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 800 }}>
                      {entry.teamNumber ?? '-'} {entry.nickname ?? entry.teamKey}
                    </div>
                    <div className="badge">
                      {entry.bucket === 'first'
                        ? 'First pick'
                        : entry.bucket === 'second'
                          ? 'Second pick'
                          : 'Do not pick'}
                    </div>
                  </div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    {entry.tag ? `Tag: ${entry.tag}` : 'No tag'} {entry.comment ? '|' : ''}
                  </div>
                  {entry.comment ? (
                    <div className="muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                      {entry.comment}
                    </div>
                  ) : null}
                </div>
              ))}
              {!analysis?.decisionLogEntries?.length ? (
                <div className="muted">
                  No decision-log notes are attached to the active board yet.
                </div>
              ) : null}
            </div>
          </div>

          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Saved Pick List Comparison</div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Scenario</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>First</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Second</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Avoid</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Decision Log</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Avg Fit</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Avg Ready</th>
                    <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Captain Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {(analysis?.scenarioRows ?? []).map((row) => (
                    <tr
                      key={row.id}
                      style={{
                        background: analysis?.activePickListId === row.id ? '#132033' : undefined,
                      }}
                    >
                      <td
                        style={{ padding: 8, borderBottom: '1px solid #1a2333', fontWeight: 800 }}
                      >
                        {row.name}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.firstCount}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.secondCount}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.avoidCount}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.decisionLogCount}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {fmt(row.averageFit, 1)}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {fmt(row.averageReady, 1)}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                        {row.captainRiskCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {errorText ? <div className="badge badge-red">{errorText}</div> : null}
        </div>
      </DisclosureSection>
    </div>
  );
}
