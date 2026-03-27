'use client';

import type { ReactNode } from 'react';

type AnalyticsTableBlockProps = {
  title: string;
  description?: string | null;
  children: ReactNode;
};

export default function AnalyticsTableBlock({
  title,
  description,
  children,
}: AnalyticsTableBlockProps) {
  return (
    <div className="panel analytics-block">
      <div className="analytics-block-header">
        <div>
          <div className="analytics-block-title">{title}</div>
          {description ? <div className="analytics-block-description">{description}</div> : null}
        </div>
      </div>
      <div className="analytics-table-shell">{children}</div>
    </div>
  );
}
