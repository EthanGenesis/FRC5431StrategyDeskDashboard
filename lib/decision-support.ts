import type { AllianceCandidateInsight } from './alliance-insights';
import type {
  PickListAnalysisResponse,
  PickListScenarioAnalysisRow,
  PlayoffScenarioSummaryRow,
  PlayoffSummaryResponse,
} from './types';
import type { PickListBundlePayload, PlayoffBundlePayload } from './tab-bundle-builders';

type PickListEntry = {
  teamKey: string;
  comment?: string | null;
  tag?: string | null;
  teamNumber?: number | null;
  nickname?: string | null;
};

type PickListArtifact = {
  id: string;
  name?: string;
  createdAt?: number | string | null;
  first?: PickListEntry[];
  second?: PickListEntry[];
  avoid?: PickListEntry[];
};

type PlayoffArtifact = {
  id: string;
  name?: string;
  createdAt?: number | string | null;
  ourSummary?: {
    seed?: number | null;
    bestRound?: string | null;
    champ?: number | null;
    finals?: number | null;
    upperFinal?: number | null;
  } | null;
  manualSummary?: {
    bestRound?: string | null;
  } | null;
};

function average(values: (number | null | undefined)[]): number | null {
  const cleaned = values.filter((value): value is number => Number.isFinite(Number(value)));
  if (!cleaned.length) return null;
  return cleaned.reduce((sum, value) => sum + value, 0) / cleaned.length;
}

function toTimestamp(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function topInsightRows(rows: AllianceCandidateInsight[], key: keyof AllianceCandidateInsight) {
  return [...rows]
    .sort((left, right) => Number(right[key] ?? 0) - Number(left[key] ?? 0))
    .slice(0, 1);
}

export function buildPickListAnalysis(params: {
  workspaceKey: string;
  eventKey: string;
  teamNumber: number | null;
  activePickListId: string | null;
  bundle: PickListBundlePayload;
  pickLists: PickListArtifact[];
}): PickListAnalysisResponse {
  const candidateInsights = Array.isArray(params.bundle.candidateInsights)
    ? params.bundle.candidateInsights
    : [];
  const insightMap = new Map(candidateInsights.map((row) => [row.teamKey, row]));
  const activePickList =
    params.pickLists.find((item) => item.id === params.activePickListId) ??
    params.pickLists[0] ??
    null;

  const bucketSummary = activePickList
    ? [
        ['first', 'First picks'],
        ['second', 'Second picks'],
        ['avoid', 'Avoid'],
      ].map(([bucket, label]) => {
        const entries = (activePickList[bucket as 'first' | 'second' | 'avoid'] ?? []).map(
          (entry) => insightMap.get(entry.teamKey) ?? null,
        );
        return {
          label: String(label),
          count: entries.filter(Boolean).length,
          avgEpa: average(entries.map((row) => row?.overallEpa ?? null)),
          avgComposite: average(entries.map((row) => row?.composite ?? null)),
        };
      })
    : [];

  const bestByRole = [
    {
      label: 'Build us',
      row: topInsightRows(candidateInsights, 'pickValueScore')[0] ?? null,
      insight: 'Highest overall value to strengthen our alliance.',
    },
    {
      label: 'Best chemistry',
      row: topInsightRows(candidateInsights, 'chemistryScore')[0] ?? null,
      insight: 'Best patch for the current alliance weakness.',
    },
    {
      label: 'Deny rival',
      row: topInsightRows(candidateInsights, 'denialValueScore')[0] ?? null,
      insight: 'Most valuable team to keep away from another captain.',
    },
    {
      label: 'Safest playoff fit',
      row: topInsightRows(candidateInsights, 'playoffReadyScore')[0] ?? null,
      insight: 'Stable, playoff-ready target with fewer downside outcomes.',
    },
    {
      label: 'Highest ceiling',
      row: topInsightRows(candidateInsights, 'ceilingScore')[0] ?? null,
      insight: 'Maximum upside if the event breaks in our favor.',
    },
  ].map((item) => ({
    label: item.label,
    teamKey: item.row?.teamKey ?? null,
    teamNumber: item.row?.teamNumber ?? null,
    nickname: item.row?.nickname ?? null,
    insight: item.insight,
    pick: item.row?.pickValueScore ?? null,
    fit: item.row?.chemistryScore ?? null,
    denial: item.row?.denialValueScore ?? null,
    ready: item.row?.playoffReadyScore ?? null,
    ceiling: item.row?.ceilingScore ?? null,
  }));

  const ifSelectionStartedNow = candidateInsights.slice(0, 5).map((row, index) => ({
    label: index === 0 ? 'Best available now' : `Next best ${index + 1}`,
    teamKey: row.teamKey,
    teamNumber: row.teamNumber ?? null,
    detail: `${row.bestUseCase} | ${row.recommendationReason}`,
  }));

  const scenarioRows: PickListScenarioAnalysisRow[] = params.pickLists.map((item) => {
    const first = item.first ?? [];
    const second = item.second ?? [];
    const avoid = item.avoid ?? [];
    const allLogged = [...first, ...second, ...avoid];
    const allInsightRows = allLogged.map((entry) => insightMap.get(entry.teamKey) ?? null);
    return {
      id: item.id,
      name: item.name ?? item.id,
      createdAtMs: toTimestamp(item.createdAt),
      firstCount: first.length,
      secondCount: second.length,
      avoidCount: avoid.length,
      decisionLogCount: allLogged.filter((entry) => String(entry.comment ?? entry.tag ?? '').trim())
        .length,
      averageFit: average(allInsightRows.map((row) => row?.chemistryScore ?? null)),
      averageReady: average(allInsightRows.map((row) => row?.playoffReadyScore ?? null)),
      averageCeiling: average(allInsightRows.map((row) => row?.ceilingScore ?? null)),
      captainRiskCount: first.filter(
        (entry) => Number(insightMap.get(entry.teamKey)?.realRank ?? 999) <= 8,
      ).length,
    };
  });

  return {
    generatedAtMs: Date.now(),
    workspaceKey: params.workspaceKey,
    eventKey: params.eventKey,
    teamNumber: params.teamNumber,
    activePickListId: activePickList?.id ?? null,
    bucketSummary,
    bestByRole,
    ifSelectionStartedNow,
    scenarioRows,
  };
}

export function buildPlayoffSummary(params: {
  workspaceKey: string;
  eventKey: string;
  teamNumber: number | null;
  activeScenarioId: string | null;
  bundle: PlayoffBundlePayload;
  savedResults: PlayoffArtifact[];
}): PlayoffSummaryResponse {
  const liveUs = params.bundle.allAllianceRows.find((row) => row.isUs) ?? null;
  const scenarioRows: PlayoffScenarioSummaryRow[] = params.savedResults.map((item) => ({
    id: item.id,
    name: item.name ?? item.id,
    createdAtMs: toTimestamp(item.createdAt),
    ourSeed: item.ourSummary?.seed ?? null,
    manualBestRound: item.manualSummary?.bestRound ?? null,
    simulatedBestRound: item.ourSummary?.bestRound ?? null,
    champ: item.ourSummary?.champ ?? null,
    finals: item.ourSummary?.finals ?? null,
    upperFinal: item.ourSummary?.upperFinal ?? null,
  }));

  return {
    generatedAtMs: Date.now(),
    workspaceKey: params.workspaceKey,
    eventKey: params.eventKey,
    teamNumber: params.teamNumber,
    activeScenarioId: params.activeScenarioId ?? null,
    liveSummary: liveUs
      ? {
          ourSeed: liveUs.seed,
          bestRound: liveUs.bestRound,
          champ: liveUs.champ,
          finals: liveUs.finals,
          upperFinal: liveUs.upperFinal,
        }
      : null,
    topAllianceOdds: params.bundle.allAllianceRows.slice(0, 8).map((row) => ({
      seed: row.seed,
      teams: row.teams,
      isUs: row.isUs,
      champ: row.champ,
      finals: row.finals,
      upperFinal: row.upperFinal,
      bestRound: row.bestRound,
    })),
    scenarioRows,
  };
}
