const failureTimestamps = new Map<string, number>();

const DEFAULT_COOLDOWN_MS = 30_000;

export function shouldBypassPersistence(scope: string, cooldownMs = DEFAULT_COOLDOWN_MS): boolean {
  const lastFailureAt = failureTimestamps.get(scope);
  if (!Number.isFinite(lastFailureAt)) return false;
  return Date.now() - Number(lastFailureAt) < cooldownMs;
}

export function markPersistenceFailure(scope: string): void {
  failureTimestamps.set(scope, Date.now());
}

export function markPersistenceSuccess(scope: string): void {
  failureTimestamps.delete(scope);
}
