export function getEventWorkspaceKey(eventKey: string | null | undefined): string | null {
  const normalized = String(eventKey ?? '')
    .trim()
    .toLowerCase();
  return normalized ? `event:${normalized}` : null;
}
