'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchJsonOrThrow } from '../lib/httpCache';
import type { AppSnapshot, DataSuperSnapshot } from '../lib/types';
import { useDashboardPreferences } from './providers/DashboardPreferencesProvider';

type RawPayloadExplorerProps = {
  loadedEventKey: string;
  loadedTeam: number | null;
  snapshot: AppSnapshot | null;
  compareTeams?: number[];
};

type RawView = 'route' | 'snapshot';

export default function RawPayloadExplorer({
  loadedEventKey,
  loadedTeam,
  snapshot,
  compareTeams = [],
}: RawPayloadExplorerProps) {
  const { t } = useDashboardPreferences();
  const [rawData, setRawData] = useState<DataSuperSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [rawView, setRawView] = useState<RawView>('route');
  const requestCompareTeams = useMemo(() => [...compareTeams], [compareTeams]);

  useEffect(() => {
    let cancelled = false;

    async function loadRawData() {
      setIsLoading(true);
      setErrorText('');
      try {
        const json = await fetchJsonOrThrow<DataSuperSnapshot>(
          '/api/data-super',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventKey: loadedEventKey || '',
              loadedTeam: loadedTeam ?? '',
              compareTeams: requestCompareTeams,
            }),
            cache: 'no-store',
          },
          'Raw payload load failed',
        );
        if (!cancelled) {
          setRawData(json);
        }
      } catch (error) {
        if (!cancelled) {
          setRawData(null);
          setErrorText(error instanceof Error ? error.message : 'Unknown raw payload error');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadRawData();
    return () => {
      cancelled = true;
    };
  }, [loadedEventKey, loadedTeam, requestCompareTeams]);

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <div style={{ fontWeight: 900 }}>
          {t('settings.raw_payload_explorer', 'Raw Payload Explorer')}
        </div>
        <button
          className="button"
          onClick={() => setRawView('route')}
          style={{ background: rawView === 'route' ? '#182336' : undefined }}
        >
          {t('raw_payload.route', 'DATA Route')}
        </button>
        <button
          className="button"
          onClick={() => setRawView('snapshot')}
          style={{ background: rawView === 'snapshot' ? '#182336' : undefined }}
        >
          {t('raw_payload.snapshot', 'Snapshot')}
        </button>
        {isLoading ? (
          <span className="badge badge-green">{t('status.loading', 'Loading...')}</span>
        ) : null}
        {errorText ? <span className="badge badge-red">{errorText}</span> : null}
      </div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>
        {rawView === 'route'
          ? JSON.stringify(rawData?.rawPayloads ?? {}, null, 2)
          : JSON.stringify(snapshot ?? {}, null, 2)}
      </pre>
    </div>
  );
}
