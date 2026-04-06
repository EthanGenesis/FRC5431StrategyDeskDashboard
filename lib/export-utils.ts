'use client';

function safeDocumentTitle(title: string): string {
  return String(title || 'strategy-desk').trim() || 'strategy-desk';
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadJsonFile(filename: string, payload: unknown): void {
  triggerDownload(
    filename,
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }),
  );
}

function escapeCsvCell(value: unknown): string {
  const text =
    value == null
      ? ''
      : typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
          ? `${value}`
          : (JSON.stringify(value) ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Array.from(
    rows.reduce<Set<string>>((accumulator, row) => {
      Object.keys(row).forEach((key) => accumulator.add(key));
      return accumulator;
    }, new Set<string>()),
  );
  const lines = [
    headers.map((header) => escapeCsvCell(header)).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(',')),
  ];
  return lines.join('\n');
}

export function downloadCsvFile(filename: string, rows: Record<string, unknown>[]): void {
  triggerDownload(filename, new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' }));
}

export function printCurrentPage(title?: string): void {
  const nextTitle = safeDocumentTitle(title ?? document.title);
  const previousTitle = document.title;
  document.title = nextTitle;
  const cleanup = () => {
    document.title = previousTitle;
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}
