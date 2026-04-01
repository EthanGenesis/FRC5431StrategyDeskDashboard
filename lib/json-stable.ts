import { createHash } from 'node:crypto';

function normalizeJsonValue(value: unknown): unknown {
  if (value == null) return null;

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nestedValue]) => nestedValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, normalizeJsonValue(nestedValue)]);

    return Object.fromEntries(entries);
  }

  return null;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value));
}

export function hashJsonValue(value: unknown): string {
  return createHash('sha1').update(stableStringify(value)).digest('hex');
}
