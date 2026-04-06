/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharedWorkspaceBrowserMocks = vi.hoisted(() => ({
  hasSupabasePublicEnv: vi.fn(),
  createBrowserClient: vi.fn(),
}));

vi.mock('./env', () => ({
  hasSupabasePublicEnv: sharedWorkspaceBrowserMocks.hasSupabasePublicEnv,
  getSupabasePublicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  }),
}));

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: sharedWorkspaceBrowserMocks.createBrowserClient,
}));

import {
  saveWorkspaceChecklistsShared,
  saveWorkspaceNotesShared,
} from './shared-workspace-browser';

describe('shared workspace browser persistence', () => {
  const upsert = vi.fn();
  const eq = vi.fn();
  const select = vi.fn();
  const from = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    sharedWorkspaceBrowserMocks.hasSupabasePublicEnv.mockReturnValue(true);

    eq.mockResolvedValue({ data: [], error: null });
    select.mockReturnValue({ eq });
    upsert.mockResolvedValue({ error: null });
    from.mockImplementation(() => ({
      select,
      upsert,
      delete: vi.fn(),
    }));

    sharedWorkspaceBrowserMocks.createBrowserClient.mockReturnValue({
      from,
    });
  });

  it('includes workspace note scope fields when saving notes', async () => {
    await saveWorkspaceNotesShared('event:2026txcle', [
      {
        id: 'note_1',
        workspaceKey: 'event:2026txcle',
        scope: 'event',
        eventKey: '2026txcle',
        teamNumber: null,
        matchKey: null,
        title: 'Test note',
        body: 'Body',
        tags: [],
        pinned: false,
        authorLabel: null,
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    ]);

    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          scope: 'event',
          event_key: '2026txcle',
          team_number: null,
          match_key: null,
        }),
      ],
      { onConflict: 'id' },
    );
  });

  it('includes checklist scope fields when saving checklists', async () => {
    await saveWorkspaceChecklistsShared('event:2026txcle', [
      {
        id: 'checklist_1',
        workspaceKey: 'event:2026txcle',
        scope: 'event',
        eventKey: '2026txcle',
        teamNumber: null,
        matchKey: null,
        label: 'Event-Day Readiness',
        items: [],
        authorLabel: null,
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    ]);

    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          scope: 'event',
          event_key: '2026txcle',
          team_number: null,
          match_key: null,
        }),
      ],
      { onConflict: 'id' },
    );
  });
});
