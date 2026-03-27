'use client';

import type { ReactElement, ReactNode } from 'react';

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  templateLabel: string;
  statusItems?: ReactNode[];
};

export default function PageHeader({
  eyebrow,
  title,
  description,
  templateLabel,
  statusItems = [],
}: PageHeaderProps): ReactElement {
  return (
    <header className="page-header">
      <div className="page-header-topline">
        <div className="page-header-context">
          <span className="page-header-eyebrow">{eyebrow}</span>
          <span className="page-header-template-inline">{templateLabel}</span>
        </div>
      </div>
      <div className="page-header-mainline">
        <div className="page-header-title">{title}</div>
        {statusItems.length ? (
          <div className="page-header-meta">
            {statusItems.map((item, index) => (
              <span key={index}>{item}</span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="page-header-description">{description}</div>
    </header>
  );
}
