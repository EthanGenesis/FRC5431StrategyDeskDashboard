import {
  DEFAULT_COMPARE_DRAFT,
  addTeamToCompareDraft,
  loadCompareDraft,
  saveCompareDraft,
} from './compare-storage';

describe('compare draft storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keeps current and historical drafts separate', () => {
    saveCompareDraft(
      {
        ...DEFAULT_COMPARE_DRAFT,
        teamNumbers: [5431, 9128],
      },
      'current',
    );
    saveCompareDraft(
      {
        ...DEFAULT_COMPARE_DRAFT,
        teamNumbers: [10340],
      },
      'historical',
    );

    expect(loadCompareDraft('current').teamNumbers).toEqual([5431, 9128]);
    expect(loadCompareDraft('historical').teamNumbers).toEqual([10340]);
  });

  it('adds unique teams and prefers the loaded team as baseline', () => {
    saveCompareDraft(
      {
        ...DEFAULT_COMPARE_DRAFT,
        teamNumbers: [9128],
        baselineTeamNumber: 9128,
      },
      'current',
    );

    const draft = addTeamToCompareDraft(5431, 5431, 'current');

    expect(draft.teamNumbers).toEqual([9128, 5431]);
    expect(draft.baselineTeamNumber).toBe(5431);
  });

  it('migrates the legacy current draft key when needed', () => {
    window.localStorage.setItem(
      'tbsb_compare_draft_v1',
      JSON.stringify({
        ...DEFAULT_COMPARE_DRAFT,
        teamNumbers: [1678],
      }),
    );

    const migrated = loadCompareDraft('current');
    const storedDraft = JSON.parse(
      window.localStorage.getItem('tbsb_compare_draft_current_v1') ?? '{}',
    ) as { teamNumbers?: number[] };

    expect(migrated.teamNumbers).toEqual([1678]);
    expect(storedDraft.teamNumbers).toEqual([1678]);
  });

  it('does not throw when compare draft writes are blocked', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });

    expect(() =>
      saveCompareDraft(
        {
          ...DEFAULT_COMPARE_DRAFT,
          teamNumbers: [5431],
        },
        'current',
      ),
    ).not.toThrow();

    setItemSpy.mockRestore();
  });
});
