'use client';

import { useCallback, useEffect, useState } from 'react';

import { downloadCsvFile, downloadJsonFile, printCurrentPage } from '../lib/export-utils';
import { fetchJsonOrThrow } from '../lib/httpCache';
import type { PlayoffSummaryResponse } from '../lib/types';
import AnalyticsChartBlock from './AnalyticsChartBlock';
import DisclosureSection from './ui/DisclosureSection';

type PlayoffSummaryPanelProps = {
  eventKey?: string;
  teamNumber?: number | null;
  activeScenarioId?: string | null;
  externalUpdateKey?: number;
};

function pct(value: unknown): string {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return `${Math.round(Number(value) * 100)}%`;
}

export default function PlayoffSummaryPanel({
  eventKey = '',
  teamNumber = null,
  activeScenarioId = null,
  externalUpdateKey = 0,
}: PlayoffSummaryPanelProps) {
  const [summary, setSummary] = useState<PlayoffSummaryResponse | null>(null);
  const [errorText, setErrorText] = useState('');

  const loadSummary = useCallback(async () => {
    if (!eventKey || !teamNumber) {
      setSummary(null);
      return;
    }
    setErrorText('');
    try {
      const query = new URLSearchParams({
        eventKey,
        team: String(teamNumber),
      });
      if (activeScenarioId) query.set('activeScenarioId', activeScenarioId);
      const response = await fetchJsonOrThrow<PlayoffSummaryResponse>(
        `/api/playoff-summary?${query.toString()}`,
        { cache: 'default' },
        'Playoff summary failed',
      );
      setSummary(response);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unknown playoff summary error');
      setSummary(null);
    }
  }, [activeScenarioId, eventKey, teamNumber]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadSummary();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [externalUpdateKey, loadSummary]);

  if (!eventKey || !teamNumber) return null;

  return (
    <div className="playoff-summary-print-root">
      <DisclosureSection
        storageKey="ui.predict.playoff.summary"
        title="Playoff Summary Matrix"
        description="Live path summary, top-alliance odds, and saved scenario comparison."
        defaultOpen
      >
        <div className="stack-12">
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="button"
              type="button"
              onClick={() =>
                downloadJsonFile(
                  `playoff-summary-${eventKey}.json`,
                  summary ?? { eventKey, teamNumber },
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
                  `playoff-summary-${eventKey}.csv`,
                  (summary?.topAllianceOdds ?? []).map((row) => ({
                    seed: row.seed,
                    teams: row.teams.join(' '),
                    isUs: row.isUs,
                    champ: row.champ,
                    finals: row.finals,
                    upperFinal: row.upperFinal,
                    bestRound: row.bestRound,
                  })),
                )
              }
            >
              Export CSV
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={() => printCurrentPage('Playoff Summary Packet')}
            >
              Print Packet
            </button>
          </div>
          <div className="grid-4">
            <div className="panel" style={{ padding: 16 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                Our Seed
              </div>
              <div style={{ fontWeight: 900, marginTop: 6 }}>
                {summary?.liveSummary?.ourSeed ?? '-'}
              </div>
            </div>
            <div className="panel" style={{ padding: 16 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                Best Round
              </div>
              <div style={{ fontWeight: 900, marginTop: 6 }}>
                {summary?.liveSummary?.bestRound ?? '-'}
              </div>
            </div>
            <div className="panel" style={{ padding: 16 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                Champ %
              </div>
              <div style={{ fontWeight: 900, marginTop: 6 }}>
                {pct(summary?.liveSummary?.champ)}
              </div>
            </div>
            <div className="panel" style={{ padding: 16 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                Finals %
              </div>
              <div style={{ fontWeight: 900, marginTop: 6 }}>
                {pct(summary?.liveSummary?.finals)}
              </div>
            </div>
          </div>
          <div className="grid-2">
            <AnalyticsChartBlock
              title="Top Alliance Odds"
              description="Current championship, finals, and upper-final odds."
              data={(summary?.topAllianceOdds ?? []).map((row) => ({
                label: `Seed ${row.seed}`,
                champ: row.champ,
                finals: row.finals,
                upperFinal: row.upperFinal,
              }))}
              chartFamily="bar"
              series={[
                { key: 'champ', label: 'Champ', color: '#f3be3b' },
                { key: 'finals', label: 'Finals', color: '#4bb3fd' },
                { key: 'upperFinal', label: 'Upper Final', color: '#c084fc' },
              ]}
              valueFormatter={(value) => pct(value)}
            />
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Saved Scenario Comparison</div>
              <div style={{ overflow: 'auto', maxHeight: 360 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ textAlign: 'left' }}>
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Scenario</th>
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Seed</th>
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Manual</th>
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Sim</th>
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Champ %</th>
                      <th style={{ padding: 8, borderBottom: '1px solid #223048' }}>Finals %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary?.scenarioRows ?? []).map((row) => (
                      <tr
                        key={row.id}
                        style={{
                          background: summary?.activeScenarioId === row.id ? '#132033' : undefined,
                        }}
                      >
                        <td
                          style={{ padding: 8, borderBottom: '1px solid #1a2333', fontWeight: 800 }}
                        >
                          {row.name}
                        </td>
                        <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                          {row.ourSeed ?? '-'}
                        </td>
                        <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                          {row.manualBestRound ?? '-'}
                        </td>
                        <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                          {row.simulatedBestRound ?? '-'}
                        </td>
                        <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                          {pct(row.champ)}
                        </td>
                        <td style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                          {pct(row.finals)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          {errorText ? <div className="badge badge-red">{errorText}</div> : null}
        </div>
      </DisclosureSection>
    </div>
  );
}
