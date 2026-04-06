'use client';

import type { WorkspacePresenceEntry } from '../../lib/types';

type WorkspacePresencePillsProps = {
  entries?: WorkspacePresenceEntry[];
  compact?: boolean;
  emptyLabel?: string | null;
};

function labelForEntry(entry: WorkspacePresenceEntry): string {
  const author = entry.operatorLabel?.trim() ?? 'Another operator';
  return `${author} ${entry.mode === 'editing' ? 'editing' : 'viewing'}`;
}

export default function WorkspacePresencePills({
  entries = [],
  compact = false,
  emptyLabel = null,
}: WorkspacePresencePillsProps) {
  if (!entries.length) {
    return emptyLabel ? <span className="muted">{emptyLabel}</span> : null;
  }

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {entries.map((entry) => (
        <span
          key={`${entry.sessionId}_${entry.mode}_${entry.artifactId ?? 'none'}`}
          className={`badge ${entry.mode === 'editing' ? 'badge-yellow' : ''}`}
          style={compact ? { fontSize: 10 } : undefined}
        >
          {labelForEntry(entry)}
        </span>
      ))}
    </div>
  );
}
