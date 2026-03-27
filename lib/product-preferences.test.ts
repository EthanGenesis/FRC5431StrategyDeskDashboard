import {
  formatLocalizedCompactNumber,
  formatLocalizedDateTime,
  formatLocalizedNumber,
  formatLocalizedPercent,
  getSemanticToneForProbability,
  getSemanticToneForStatus,
  getSemanticToneFromDelta,
  translate,
} from './product-preferences';

describe('product preferences helpers', () => {
  it('falls back to english translations when a language key is missing', () => {
    expect(translate('es', 'nav.major.current')).toBe('ACTUAL');
    expect(translate('fr', 'template.workbench')).toBe('Espace de travail');
    expect(translate('fr', 'missing.key', 'Fallback copy')).toBe('Fallback copy');
  });

  it('formats dates and numbers with the requested locale', () => {
    expect(formatLocalizedDateTime('2026-03-27T12:34:00Z', 'en', { month: 'short' })).toBe('Mar');
    expect(formatLocalizedNumber(1234.5, 'en')).toContain('1');
    expect(formatLocalizedPercent(0.125, 'en', 1)).toContain('%');
    expect(formatLocalizedCompactNumber(12500, 'en')).toBeTruthy();
  });

  it('classifies semantic tones conservatively', () => {
    expect(getSemanticToneFromDelta(7, 'positive_when_higher')).toBe('positive-strong');
    expect(getSemanticToneFromDelta(-2, 'positive_when_higher')).toBe('negative-mild');
    expect(getSemanticToneFromDelta(-3, 'positive_when_lower')).toBe('positive-mild');
    expect(getSemanticToneForProbability(0.98)).toBe('positive-strong');
    expect(getSemanticToneForProbability(0.02)).toBe('negative-strong');
    expect(getSemanticToneForStatus('LOCKED')).toBe('positive-strong');
    expect(getSemanticToneForStatus('ELIMINATED')).toBe('negative-strong');
  });
});
