'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  formatLocalizedCompactNumber,
  formatLocalizedDateTime,
  formatLocalizedNumber,
  formatLocalizedPercent,
  getLocaleForLanguage,
  getSemanticToneForProbability,
  getSemanticToneForStatus,
  getSemanticToneFromDelta,
  semanticToneClass,
  translate,
} from '../../lib/product-preferences';
import type { AnalyticsSemanticDirection, LanguageCode, SemanticTone } from '../../lib/types';

type DashboardPreferencesContextValue = {
  language: LanguageCode;
  locale: string;
  t: (
    key: string,
    fallback?: string,
    vars?: Record<string, string | number | null | undefined>,
  ) => string;
  formatDateTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number | null | undefined, options?: Intl.NumberFormatOptions) => string;
  formatPercent: (value: number | null | undefined, digits?: number) => string;
  formatCompactNumber: (value: number | null | undefined) => string;
  toneClass: (tone: SemanticTone) => string;
  toneFromDelta: (
    delta: number | null | undefined,
    direction?: AnalyticsSemanticDirection,
  ) => SemanticTone;
  toneFromProbability: (value: number | null | undefined) => SemanticTone;
  toneFromStatus: (status: string | null | undefined) => SemanticTone;
};

const DEFAULT_LANGUAGE: LanguageCode = 'en';

const defaultValue: DashboardPreferencesContextValue = {
  language: DEFAULT_LANGUAGE,
  locale: getLocaleForLanguage(DEFAULT_LANGUAGE),
  t: (key, fallback, vars) => translate(DEFAULT_LANGUAGE, key, fallback, vars),
  formatDateTime: (value, options) => formatLocalizedDateTime(value, DEFAULT_LANGUAGE, options),
  formatNumber: (value, options) => formatLocalizedNumber(value, DEFAULT_LANGUAGE, options),
  formatPercent: (value, digits) => formatLocalizedPercent(value, DEFAULT_LANGUAGE, digits),
  formatCompactNumber: (value) => formatLocalizedCompactNumber(value, DEFAULT_LANGUAGE),
  toneClass: semanticToneClass,
  toneFromDelta: getSemanticToneFromDelta,
  toneFromProbability: getSemanticToneForProbability,
  toneFromStatus: getSemanticToneForStatus,
};

const DashboardPreferencesContext = createContext<DashboardPreferencesContextValue>(defaultValue);

type DashboardPreferencesProviderProps = {
  language: LanguageCode;
  children: ReactNode;
};

export default function DashboardPreferencesProvider({
  language,
  children,
}: DashboardPreferencesProviderProps) {
  const value = useMemo<DashboardPreferencesContextValue>(() => {
    const locale = getLocaleForLanguage(language);
    return {
      language,
      locale,
      t: (key, fallback, vars) => translate(language, key, fallback, vars),
      formatDateTime: (input, options) => formatLocalizedDateTime(input, language, options),
      formatNumber: (input, options) => formatLocalizedNumber(input, language, options),
      formatPercent: (input, digits) => formatLocalizedPercent(input, language, digits),
      formatCompactNumber: (input) => formatLocalizedCompactNumber(input, language),
      toneClass: semanticToneClass,
      toneFromDelta: getSemanticToneFromDelta,
      toneFromProbability: getSemanticToneForProbability,
      toneFromStatus: getSemanticToneForStatus,
    };
  }, [language]);

  return (
    <DashboardPreferencesContext.Provider value={value}>
      {children}
    </DashboardPreferencesContext.Provider>
  );
}

export function useDashboardPreferences(): DashboardPreferencesContextValue {
  return useContext(DashboardPreferencesContext);
}
