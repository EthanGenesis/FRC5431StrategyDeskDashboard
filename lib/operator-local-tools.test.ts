/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_REHEARSAL_MODE_CONFIG } from './rehearsal-mode';
import {
  clearDeskPacks,
  clearReplaySessions,
  deleteRehearsalDrill,
  deleteWorkspacePreset,
  duplicateRehearsalDrill,
  getLastKnownGoodDeskPack,
  loadDeskPacks,
  loadRecentSearches,
  loadRehearsalDrills,
  loadReplaySessions,
  loadWorkspacePresets,
  rankCompareSuggestions,
  saveDeskPack,
  saveRecentSearch,
  saveRehearsalDrill,
  saveReplaySession,
  saveWorkspacePreset,
} from './operator-local-tools';

describe('operator-local-tools', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores recent searches and ranks compare suggestions from recency plus event context', () => {
    saveRecentSearch({
      eventKey: '2026txcle',
      teamNumber: 5431,
      label: 'Team 5431 | Clearlake',
      eventLabel: 'Clearlake',
    });

    const suggestions = rankCompareSuggestions({
      recentSearches: loadRecentSearches(),
      selectedTeams: [9128],
      eventTeamRows: [
        { teamKey: 'frc5431', teamNumber: 5431, nickname: 'Titan', rank: 2, composite: 92 },
        { teamKey: 'frc9128', teamNumber: 9128, nickname: 'Other', rank: 1, composite: 95 },
        { teamKey: 'frc118', teamNumber: 118, nickname: 'Robonauts', rank: 7, composite: 88 },
      ],
    });

    expect(loadRecentSearches()).toHaveLength(1);
    expect(suggestions[0]?.teamNumber).toBe(5431);
    expect(suggestions.some((row) => row.teamNumber === 9128)).toBe(false);
  });

  it('stores presets, desk packs, replay sessions, and rehearsal drills locally', () => {
    const packs = saveDeskPack({
      id: 'pack_1',
      workspaceKey: 'event:2026txcle',
      eventKey: '2026txcle',
      teamNumber: 5431,
      label: 'Clearlake | Team 5431',
      capturedAtMs: 123,
      snapshot: null,
      deskOps: null,
      teamDossier: null,
      pickListAnalysis: null,
      playoffSummary: null,
      pitOps: null,
    });
    const presets = saveWorkspacePreset({
      name: 'Captain meeting',
      majorTab: 'PREDICT',
      currentSubTab: 'NOW',
      historicalSubTab: 'PRE_EVENT',
      predictSubTab: 'PLAYOFF_LAB',
      eventKey: '2026txcle',
      teamNumber: 5431,
      selectedMatchKey: '2026txcle_qm1',
      selectedTeamNumber: 5431,
      activePickListId: 'pick_1',
      activePlayoffResultId: 'playoff_1',
    });
    const drills = saveRehearsalDrill({
      name: 'Queue handoff',
      config: {
        ...DEFAULT_REHEARSAL_MODE_CONFIG,
        active: true,
        queueState: 'QUEUE_2',
      },
    });
    const replaySessions = saveReplaySession({
      label: 'Morning replay',
      pack: packs[0]!,
    });

    expect(loadDeskPacks()).toHaveLength(1);
    expect(getLastKnownGoodDeskPack({ eventKey: '2026txcle', teamNumber: 5431 })?.id).toBe(
      'pack_1',
    );
    expect(loadWorkspacePresets()).toHaveLength(1);
    expect(presets[0]?.name).toBe('Captain meeting');
    expect(loadRehearsalDrills()).toHaveLength(1);
    expect(drills[0]?.name).toBe('Queue handoff');
    expect(loadReplaySessions()).toHaveLength(1);
    expect(replaySessions[0]?.label).toBe('Morning replay');

    expect(duplicateRehearsalDrill(drills[0]!.id)).toHaveLength(2);
    expect(deleteRehearsalDrill(drills[0]!.id)).toHaveLength(1);
    expect(deleteWorkspacePreset(presets[0]!.id)).toHaveLength(0);

    clearDeskPacks();
    clearReplaySessions();
    expect(loadDeskPacks()).toHaveLength(0);
    expect(loadReplaySessions()).toHaveLength(0);
  });
});
