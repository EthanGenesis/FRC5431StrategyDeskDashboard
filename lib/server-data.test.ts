import { describe, expect, it } from 'vitest';

import {
  normalizeTeamList,
  parseCompareTeams,
  parsePositiveTeamNumber,
  parseRequiredEventKey,
} from './server-data';

describe('server-data boundary helpers', () => {
  it('parses and deduplicates compare team lists from strings', () => {
    expect(parseCompareTeams('5431 5431,9128,1678')).toEqual([5431, 9128, 1678]);
  });

  it('normalizes mixed raw team lists into positive integers only', () => {
    expect(normalizeTeamList([5431, '9128', 0, -4, 'oops', 1678])).toEqual([5431, 9128, 1678]);
  });

  it('rejects invalid team numbers and empty event keys', () => {
    expect(() => parsePositiveTeamNumber('0')).toThrow();
    expect(() => parseRequiredEventKey('   ')).toThrow();
  });
});
