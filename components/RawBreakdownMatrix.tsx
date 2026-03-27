'use client';

import { formatAnalyticsMetricValue } from '../lib/analytics-registry';
import type { RawMatrixField } from '../lib/types';

type RawBreakdownMatrixRow = {
  teamNumber?: number | null;
  teamKey?: string | null;
  nickname?: string | null;
  values?: Record<string, unknown> | null;
};

type RawBreakdownMatrixProps = {
  title: string;
  description?: string | null;
  fields: RawMatrixField[];
  rows: RawBreakdownMatrixRow[];
  baselineTeamNumber?: number | null;
};

export default function RawBreakdownMatrix({
  title,
  description,
  fields,
  rows,
  baselineTeamNumber = null,
}: RawBreakdownMatrixProps) {
  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ fontWeight: 900, marginBottom: 8 }}>{title}</div>
      {description ? (
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          {description}
        </div>
      ) : null}
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th
                style={{
                  padding: 8,
                  borderBottom: '1px solid #223048',
                  position: 'sticky',
                  left: 0,
                  background: '#111826',
                  zIndex: 1,
                }}
              >
                Team
              </th>
              {fields.map((field) => (
                <th
                  key={field.key}
                  style={{
                    padding: 8,
                    borderBottom: '1px solid #223048',
                    minWidth: 110,
                  }}
                >
                  {field.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isBaseline =
                baselineTeamNumber != null && Number(row.teamNumber) === baselineTeamNumber;

              return (
                <tr
                  key={`${row.teamKey ?? row.teamNumber ?? 'unknown'}`}
                  style={{
                    background: isBaseline ? '#132033' : undefined,
                  }}
                >
                  <td
                    style={{
                      padding: 8,
                      borderBottom: '1px solid #1a2333',
                      position: 'sticky',
                      left: 0,
                      background: isBaseline ? '#132033' : '#111826',
                    }}
                  >
                    <div className="mono">{row.teamNumber ?? row.teamKey}</div>
                    {row.nickname ? (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {row.nickname}
                      </div>
                    ) : null}
                  </td>
                  {fields.map((field) => (
                    <td key={field.key} style={{ padding: 8, borderBottom: '1px solid #1a2333' }}>
                      {formatAnalyticsMetricValue('season_match_epa', row.values?.[field.key])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
