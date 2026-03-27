'use client';

import { useState, type ReactElement, type ReactNode } from 'react';

type DisclosureSectionProps = {
  storageKey: string;
  title: string;
  description?: string | null;
  defaultOpen?: boolean;
  badge?: ReactNode;
  children: ReactNode;
};

export default function DisclosureSection({
  storageKey: _storageKey,
  title,
  description = null,
  defaultOpen = false,
  badge = null,
  children,
}: DisclosureSectionProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`disclosure-section ${open ? 'open' : ''}`}>
      <button
        className="disclosure-toggle"
        type="button"
        aria-label={title}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="disclosure-toggle-copy">
          <span className="disclosure-toggle-title-row">
            <span className="disclosure-toggle-title">{title}</span>
            {badge ? <span className="disclosure-toggle-badge">{badge}</span> : null}
          </span>
          {description ? (
            <span className="disclosure-toggle-description">{description}</span>
          ) : null}
        </span>
        <span className="disclosure-toggle-icon" aria-hidden="true">
          {open ? '-' : '+'}
        </span>
      </button>
      {open ? <div className="disclosure-body stack-12">{children}</div> : null}
    </section>
  );
}
