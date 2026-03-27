'use client';

import type { AnalyticsChartFamily, AnalyticsScope } from '../lib/types';
import { listAnalyticsMetrics } from '../lib/analytics-registry';

type MetricPickerProps = {
  scopeFilters?: AnalyticsScope[];
  tabFilters?: string[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  chartFamily?: AnalyticsChartFamily | null;
};

export default function MetricPicker({
  scopeFilters = [],
  tabFilters = [],
  value,
  onChange,
  label = 'Metric',
  chartFamily = null,
}: MetricPickerProps) {
  const options = listAnalyticsMetrics({
    scopes: scopeFilters,
    tabs: tabFilters,
    chartFamily,
  });

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        {label}
      </span>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((metric) => (
          <option key={metric.key} value={metric.key}>
            {metric.label}
          </option>
        ))}
      </select>
    </label>
  );
}
