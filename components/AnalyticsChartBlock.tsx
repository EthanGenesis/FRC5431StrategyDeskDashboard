'use client';

import type { ReactElement, ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnalyticsChartFamily } from '../lib/types';
import { useDashboardPreferences } from './providers/DashboardPreferencesProvider';

type AnalyticsChartSeries = {
  key: string;
  label: string;
  color: string;
  strokeWidth?: number;
  type?: 'line' | 'step';
};

type AnalyticsChartBlockProps = {
  title: string;
  description?: string | null;
  data: Record<string, string | number | null | undefined>[];
  series: AnalyticsChartSeries[];
  chartFamily?: AnalyticsChartFamily;
  xKey?: string;
  height?: number;
  valueFormatter?: (value: unknown) => ReactNode | [ReactNode, string];
  referenceValue?: number | null;
};

export default function AnalyticsChartBlock({
  title,
  description,
  data,
  series,
  chartFamily = 'line',
  xKey = 'label',
  height = 260,
  valueFormatter,
  referenceValue = null,
}: AnalyticsChartBlockProps) {
  const { t } = useDashboardPreferences();

  if (!data?.length || !series?.length) {
    return (
      <div className="panel analytics-block">
        <div className="analytics-block-header">
          <div>
            <div className="analytics-block-title">{title}</div>
            {description ? <div className="analytics-block-description">{description}</div> : null}
          </div>
        </div>
        <div className="analytics-empty-state">
          <div className="analytics-block-title">
            {t('chart.empty.title', 'No chart data available')}
          </div>
          <div>
            {t(
              'chart.empty.description',
              'Load a dataset or switch to a scope that has chartable values.',
            )}
          </div>
        </div>
      </div>
    );
  }

  const tooltipFormatter =
    valueFormatter ??
    ((value: unknown) => (typeof value === 'number' || typeof value === 'string' ? value : '-'));

  const chartTheme = {
    grid: 'var(--chart-grid)',
    axis: 'var(--chart-axis)',
    axisSoft: 'var(--chart-axis-soft)',
    reference: 'var(--chart-reference)',
    tooltipBackground: 'var(--tooltip-bg)',
    tooltipBorder: 'var(--tooltip-border)',
  };

  function renderSeries(): ReactElement[] {
    if (chartFamily === 'area') {
      return series.map((item) => (
        <Area
          key={item.key}
          type="monotone"
          dataKey={item.key}
          name={item.label}
          stroke={item.color}
          fill={item.color}
          fillOpacity={0.18}
          strokeWidth={item.strokeWidth ?? 2}
        />
      ));
    }

    if (chartFamily === 'bar') {
      return series.map((item) => (
        <Bar
          key={item.key}
          dataKey={item.key}
          name={item.label}
          fill={item.color}
          radius={[3, 3, 0, 0]}
        />
      ));
    }

    if (chartFamily === 'scatter') {
      return series.map((item) => (
        <Scatter key={item.key} dataKey={item.key} name={item.label} fill={item.color} />
      ));
    }

    return series.map((item) => (
      <Line
        key={item.key}
        type={item.type === 'step' || chartFamily === 'step' ? 'stepAfter' : 'monotone'}
        dataKey={item.key}
        name={item.label}
        stroke={item.color}
        strokeWidth={item.strokeWidth ?? 2.5}
        dot={false}
        activeDot={{ r: 3 }}
      />
    ));
  }

  function renderChart(): ReactElement {
    if (chartFamily === 'bar') {
      return (
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="2 6" stroke={chartTheme.grid} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: chartTheme.axisSoft }} />
          <YAxis tick={{ fontSize: 11, fill: chartTheme.axisSoft }} />
          <Tooltip
            formatter={tooltipFormatter}
            contentStyle={{
              border: `1px solid ${chartTheme.tooltipBorder}`,
              borderRadius: 12,
              background: chartTheme.tooltipBackground,
              boxShadow: '0 12px 24px rgba(0, 0, 0, 0.18)',
            }}
            labelStyle={{ color: 'var(--text)', fontWeight: 700 }}
          />
          {series.length > 1 ? (
            <Legend wrapperStyle={{ color: chartTheme.axisSoft, fontSize: 11 }} iconType="circle" />
          ) : null}
          {referenceValue != null ? (
            <ReferenceLine y={referenceValue} stroke={chartTheme.reference} strokeDasharray="4 4" />
          ) : null}
          {renderSeries()}
        </BarChart>
      );
    }

    if (chartFamily === 'area') {
      return (
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="2 6" stroke={chartTheme.grid} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: chartTheme.axisSoft }} />
          <YAxis tick={{ fontSize: 11, fill: chartTheme.axisSoft }} />
          <Tooltip
            formatter={tooltipFormatter}
            contentStyle={{
              border: `1px solid ${chartTheme.tooltipBorder}`,
              borderRadius: 12,
              background: chartTheme.tooltipBackground,
              boxShadow: '0 12px 24px rgba(0, 0, 0, 0.18)',
            }}
            labelStyle={{ color: 'var(--text)', fontWeight: 700 }}
          />
          {series.length > 1 ? (
            <Legend wrapperStyle={{ color: chartTheme.axisSoft, fontSize: 11 }} iconType="circle" />
          ) : null}
          {referenceValue != null ? (
            <ReferenceLine y={referenceValue} stroke={chartTheme.reference} strokeDasharray="4 4" />
          ) : null}
          {renderSeries()}
        </AreaChart>
      );
    }

    if (chartFamily === 'scatter') {
      return (
        <ScatterChart data={data}>
          <CartesianGrid strokeDasharray="2 6" stroke={chartTheme.grid} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: chartTheme.axisSoft }} />
          <YAxis tick={{ fontSize: 11, fill: chartTheme.axisSoft }} />
          <Tooltip
            formatter={tooltipFormatter}
            contentStyle={{
              border: `1px solid ${chartTheme.tooltipBorder}`,
              borderRadius: 12,
              background: chartTheme.tooltipBackground,
              boxShadow: '0 12px 24px rgba(0, 0, 0, 0.18)',
            }}
            labelStyle={{ color: 'var(--text)', fontWeight: 700 }}
          />
          {series.length > 1 ? (
            <Legend wrapperStyle={{ color: chartTheme.axisSoft, fontSize: 11 }} iconType="circle" />
          ) : null}
          {renderSeries()}
        </ScatterChart>
      );
    }

    if (chartFamily === 'composed') {
      return (
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="2 6" stroke={chartTheme.grid} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: chartTheme.axisSoft }} />
          <YAxis tick={{ fontSize: 11, fill: chartTheme.axisSoft }} />
          <Tooltip
            formatter={tooltipFormatter}
            contentStyle={{
              border: `1px solid ${chartTheme.tooltipBorder}`,
              borderRadius: 12,
              background: chartTheme.tooltipBackground,
              boxShadow: '0 12px 24px rgba(0, 0, 0, 0.18)',
            }}
            labelStyle={{ color: 'var(--text)', fontWeight: 700 }}
          />
          {series.length > 1 ? (
            <Legend wrapperStyle={{ color: chartTheme.axisSoft, fontSize: 11 }} iconType="circle" />
          ) : null}
          {referenceValue != null ? (
            <ReferenceLine y={referenceValue} stroke={chartTheme.reference} strokeDasharray="4 4" />
          ) : null}
          {renderSeries()}
        </ComposedChart>
      );
    }

    return (
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="2 6" stroke={chartTheme.grid} />
        <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: chartTheme.axisSoft }} />
        <YAxis tick={{ fontSize: 11, fill: chartTheme.axisSoft }} />
        <Tooltip
          formatter={tooltipFormatter}
          contentStyle={{
            border: `1px solid ${chartTheme.tooltipBorder}`,
            borderRadius: 12,
            background: chartTheme.tooltipBackground,
            boxShadow: '0 12px 24px rgba(0, 0, 0, 0.18)',
          }}
          labelStyle={{ color: 'var(--text)', fontWeight: 700 }}
        />
        {series.length > 1 ? (
          <Legend wrapperStyle={{ color: chartTheme.axisSoft, fontSize: 11 }} iconType="circle" />
        ) : null}
        {referenceValue != null ? (
          <ReferenceLine y={referenceValue} stroke={chartTheme.reference} strokeDasharray="4 4" />
        ) : null}
        {renderSeries()}
      </LineChart>
    );
  }

  return (
    <div className="panel analytics-block" style={{ minWidth: 0 }}>
      <div className="analytics-block-header">
        <div>
          <div className="analytics-block-title">{title}</div>
          {description ? <div className="analytics-block-description">{description}</div> : null}
        </div>
      </div>
      <div className="analytics-chart-shell" style={{ height, minWidth: 0, minHeight: height }}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
