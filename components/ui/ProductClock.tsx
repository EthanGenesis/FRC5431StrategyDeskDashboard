'use client';

import type { ReactElement } from 'react';

import { useDashboardPreferences } from '../providers/DashboardPreferencesProvider';

type ProductClockProps = {
  nowMs: number;
};

export default function ProductClock({ nowMs }: ProductClockProps): ReactElement {
  const { formatDateTime, t } = useDashboardPreferences();

  const timeText = formatDateTime(nowMs, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const dateText = formatDateTime(nowMs, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="dashboard-live-clock" aria-label={t('clock.label', 'Current local time')}>
      {timeText} <span className="dashboard-live-clock-separator">|</span> {dateText}
    </div>
  );
}
