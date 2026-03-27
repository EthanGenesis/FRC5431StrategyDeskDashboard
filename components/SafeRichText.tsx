'use client';

import type { CSSProperties } from 'react';
import { sanitizeNarrativeHtml } from '../lib/analytics';

type SafeRichTextProps = {
  html: string | null | undefined;
  className?: string;
  style?: CSSProperties;
};

export default function SafeRichText({ html, className, style }: SafeRichTextProps) {
  return (
    <div
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: sanitizeNarrativeHtml(html) }}
    />
  );
}
