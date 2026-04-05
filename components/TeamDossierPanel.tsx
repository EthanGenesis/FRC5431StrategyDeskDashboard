'use client';

import { useCallback, useEffect, useState } from 'react';

import { fetchJsonOrThrow } from '../lib/httpCache';
import type { TeamDossierResponse } from '../lib/types';
import AnalyticsChartBlock from './AnalyticsChartBlock';
import DisclosureSection from './ui/DisclosureSection';

type TeamDossierPanelProps = {
  teamNumber?: number | null;
  loadedEventKey?: string;
  externalUpdateKey?: number;
};

function fmt(value: unknown, digits = 1): string {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(digits);
}

export default function TeamDossierPanel({
  teamNumber = null,
  loadedEventKey = '',
  externalUpdateKey = 0,
}: TeamDossierPanelProps) {
  const [dossier, setDossier] = useState<TeamDossierResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');

  const loadDossier = useCallback(async () => {
    if (!teamNumber) {
      setDossier(null);
      return;
    }
    setLoading(true);
    setErrorText('');
    try {
      const query = new URLSearchParams({ team: String(teamNumber) });
      if (loadedEventKey) query.set('eventKey', loadedEventKey);
      const response = await fetchJsonOrThrow<TeamDossierResponse>(
        `/api/team-dossier?${query.toString()}`,
        { cache: 'default' },
        'Team dossier failed',
      );
      setDossier(response);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unknown team dossier error');
      setDossier(null);
    } finally {
      setLoading(false);
    }
  }, [loadedEventKey, teamNumber]);

  useEffect(() => {
    void loadDossier();
  }, [externalUpdateKey, loadDossier]);

  if (!teamNumber) return null;

  return (
    <DisclosureSection
      storageKey="ui.team_profile.dossier"
      title="Team Dossier"
      description="Role summary, volatility, leverage, best evidence, and event-vs-season context."
      defaultOpen
    >
      <div className="stack-12">
        <div className="grid-3">
          <div className="panel" style={{ padding: 16 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Role Summary
            </div>
            <div style={{ fontWeight: 900, marginTop: 6 }}>
              {(dossier?.roleSummary ?? []).join(' • ') || '-'}
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              {dossier?.leverage?.winConditionFlags?.[0] ?? 'No dominant role signal yet.'}
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Volatility
            </div>
            <div style={{ fontWeight: 900, marginTop: 6 }}>
              {dossier?.volatility?.label ?? '-'} ({fmt(dossier?.volatility?.score, 1)})
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              {dossier?.volatility?.insight ?? '-'}
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              RP / Matchup Pressure
            </div>
            <div style={{ fontWeight: 900, marginTop: 6 }}>
              {dossier?.leverage?.rpPressure?.[0] ?? '-'}
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              {(dossier?.leverage?.winConditionFlags ?? []).slice(1).join(' • ') ||
                'No extra flags.'}
            </div>
          </div>
        </div>

        <div className="grid-2">
          <AnalyticsChartBlock
            title="Current vs Season"
            description="Quick gap check between this event and season-long baseline."
            data={(dossier?.currentVsSeason ?? []).map((row) => ({
              label: row.label,
              current: row.current,
              season: row.season,
              delta: row.delta,
            }))}
            chartFamily="bar"
            series={[
              { key: 'current', label: 'Current', color: '#4bb3fd' },
              { key: 'season', label: 'Season', color: '#f3be3b' },
              { key: 'delta', label: 'Delta', color: '#2dd4bf' },
            ]}
            valueFormatter={(value) => fmt(value, 1)}
          />
          <AnalyticsChartBlock
            title="Rank / RP Trajectory"
            description="Recent event rank pressure or event-by-event trend line."
            data={dossier?.rankTrajectory ?? []}
            chartFamily="line"
            series={[{ key: 'value', label: 'Value', color: '#c084fc' }]}
            valueFormatter={(value) => fmt(value, 1)}
          />
        </div>

        <div className="grid-2">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Phase Role Metrics</div>
            <div className="stack-8">
              {(dossier?.roleMetrics ?? []).map((metric) => (
                <div key={metric.label} className="panel-2" style={{ padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 800 }}>{metric.label}</div>
                    <div>
                      {fmt(metric.value, 1)} vs {fmt(metric.baseline, 1)}
                    </div>
                  </div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    Delta {fmt(metric.delta, 1)} • {metric.insight}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Best Evidence Matches</div>
            <div className="stack-8">
              {(dossier?.bestEvidenceMatches ?? []).map((match) => (
                <div key={match.key} className="panel-2" style={{ padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 800 }}>{match.label}</div>
                    <div className="badge">{match.result}</div>
                  </div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    Margin {fmt(match.margin, 0)} • Score {fmt(match.score, 0)} • EPA{' '}
                    {fmt(match.epa, 1)}
                  </div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {match.reason}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {loading ? <div className="muted">Loading dossier...</div> : null}
        {errorText ? <div className="badge badge-red">{errorText}</div> : null}
      </div>
    </DisclosureSection>
  );
}
