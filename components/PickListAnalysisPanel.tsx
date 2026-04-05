'use client';

import { useCallback, useEffect, useState } from 'react';

import { fetchJsonOrThrow } from '../lib/httpCache';
import type { PickListAnalysisResponse } from '../lib/types';
import AnalyticsChartBlock from './AnalyticsChartBlock';
import DisclosureSection from './ui/DisclosureSection';

type PickListAnalysisPanelProps = {
  eventKey?: string;
  teamNumber?: number | null;
  activePickListId?: string | null;
  externalUpdateKey?: number;
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
}: PickListAnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<PickListAnalysisResponse | null>(null);
  const [errorText, setErrorText] = useState('');

  const loadAnalysis = useCallback(async () => {
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
  }, [activePickListId, eventKey, teamNumber]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadAnalysis();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [externalUpdateKey, loadAnalysis]);

  if (!eventKey || !teamNumber) return null;

  return (
    <DisclosureSection
      storageKey="ui.predict.pick_list.analysis"
      title="Pick List Decision Center"
      description="Role-fit board, if-selection-started-now recommendations, and saved scenario comparison."
      defaultOpen
    >
      <div className="stack-12">
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
              <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                Pick {fmt(item.pick, 0)} • Fit {fmt(item.fit, 0)} • Ready {fmt(item.ready, 0)} •
                Ceiling {fmt(item.ceiling, 0)}
              </div>
            </div>
          ))}
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
                    <td style={{ padding: 8, borderBottom: '1px solid #1a2333', fontWeight: 800 }}>
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
  );
}
