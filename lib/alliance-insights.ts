type Numeric = number | null | undefined;

export type AllianceCandidateRow = {
  teamKey: string;
  teamNumber?: number | null;
  realRank?: Numeric;
  simRank?: Numeric;
  matchesPlayed?: Numeric;
  record?: string | null;
  overallEpa?: Numeric;
  autoEpa?: Numeric;
  teleopEpa?: Numeric;
  endgameEpa?: Numeric;
  opr?: Numeric;
  composite?: Numeric;
  totalSos?: Numeric;
};

export type AllianceCaptainSlot = {
  seed: number;
  captain: string;
  picks: string[];
};

export type AllianceCandidateInsight = AllianceCandidateRow & {
  chemistryScore: number;
  coverageScore: number;
  ceilingScore: number;
  stabilityScore: number;
  playoffReadyScore: number;
  pickValueScore: number;
  denialValueScore: number;
  weakestArea: 'auto' | 'teleop' | 'endgame' | null;
  rivalCaptain: string | null;
  bestUseCase: 'Weakness patch' | 'High ceiling' | 'Safe playoff fit' | 'Rival denial';
  recommendationReason: string;
  recommendation: 'Build us' | 'Best fit' | 'Deny rival';
};

function numeric(value: Numeric): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: Numeric[]): number | null {
  const cleaned = values.map(numeric).filter((value): value is number => value != null);
  if (!cleaned.length) return null;
  return cleaned.reduce((sum, value) => sum + value, 0) / cleaned.length;
}

function withDetails(
  row: AllianceCandidateRow,
  eventRowMap: Map<string, AllianceCandidateRow>,
): AllianceCandidateRow {
  return {
    ...eventRowMap.get(row.teamKey),
    ...row,
  };
}

function metricRange(
  rows: AllianceCandidateRow[],
  key: keyof AllianceCandidateRow,
): [number, number] {
  const values = rows
    .map((row) => numeric(row[key] as Numeric))
    .filter((value): value is number => value != null);
  if (!values.length) return [0, 1];
  return [Math.min(...values), Math.max(...values)];
}

function normalize(value: Numeric, range: [number, number]): number {
  const parsed = numeric(value);
  if (parsed == null) return 0.5;
  const [min, max] = range;
  if (max - min < 1e-9) return 0.5;
  return (parsed - min) / (max - min);
}

function rescale(values: number[]): number[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 1e-9) return values.map(() => 50);
  return values.map((value) => ((value - min) / (max - min)) * 100);
}

function inverseNormalize(value: Numeric, range: [number, number]): number {
  return 1 - normalize(value, range);
}

function parseWinRate(record: string | null | undefined): number | null {
  if (!record) return null;
  const parts = String(record)
    .split('-')
    .map((value) => Number(value));
  if (parts.length < 2 || parts.some((value) => !Number.isFinite(value))) return null;
  const wins = parts[0] ?? 0;
  const losses = parts[1] ?? 0;
  const ties = parts[2] ?? 0;
  const total = wins + losses + ties;
  if (total <= 0) return null;
  return (wins + ties * 0.5) / total;
}

function weaknessArea(allianceRows: AllianceCandidateRow[]): 'auto' | 'teleop' | 'endgame' | null {
  if (!allianceRows.length) return null;
  const averages = {
    auto: average(allianceRows.map((row) => row.autoEpa ?? null)),
    teleop: average(allianceRows.map((row) => row.teleopEpa ?? null)),
    endgame: average(allianceRows.map((row) => row.endgameEpa ?? null)),
  };
  const entries = Object.entries(averages).filter(([, value]) => value != null) as [
    ['auto' | 'teleop' | 'endgame', number],
    ...['auto' | 'teleop' | 'endgame', number][],
  ];
  if (!entries.length) return null;
  return entries.sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
}

function chemistryRaw(
  candidate: AllianceCandidateRow,
  allianceRows: AllianceCandidateRow[],
  ranges: Record<'overall' | 'composite' | 'auto' | 'teleop' | 'endgame', [number, number]>,
): number {
  const weakest = weaknessArea(allianceRows);
  const autoScore = normalize(candidate.autoEpa ?? candidate.overallEpa, ranges.auto);
  const teleopScore = normalize(candidate.teleopEpa ?? candidate.overallEpa, ranges.teleop);
  const endgameScore = normalize(candidate.endgameEpa ?? candidate.overallEpa, ranges.endgame);
  const overallScore = normalize(candidate.overallEpa, ranges.overall);
  const compScore = normalize(candidate.composite, ranges.composite);

  if (!allianceRows.length) {
    return overallScore * 0.45 + compScore * 0.35 + teleopScore * 0.2;
  }

  const weakestBoost =
    weakest === 'auto'
      ? autoScore
      : weakest === 'teleop'
        ? teleopScore
        : weakest === 'endgame'
          ? endgameScore
          : (average([autoScore, teleopScore, endgameScore]) ?? 0.5);

  return (
    weakestBoost * 0.5 +
    overallScore * 0.2 +
    compScore * 0.2 +
    ((autoScore + teleopScore + endgameScore) / 3) * 0.1
  );
}

function phaseScores(
  candidate: AllianceCandidateRow,
  ranges: Record<'overall' | 'composite' | 'auto' | 'teleop' | 'endgame' | 'opr', [number, number]>,
) {
  return {
    auto: normalize(candidate.autoEpa ?? candidate.overallEpa, ranges.auto),
    teleop: normalize(candidate.teleopEpa ?? candidate.overallEpa, ranges.teleop),
    endgame: normalize(candidate.endgameEpa ?? candidate.overallEpa, ranges.endgame),
    overall: normalize(candidate.overallEpa, ranges.overall),
    composite: normalize(candidate.composite, ranges.composite),
    opr: normalize(candidate.opr, ranges.opr),
  };
}

export function buildAllianceCandidateInsights(params: {
  availableRows: AllianceCandidateRow[];
  captainSlots: AllianceCaptainSlot[];
  currentCaptainKey?: string | null;
  eventRowMap: Map<string, AllianceCandidateRow>;
}): AllianceCandidateInsight[] {
  const { availableRows, captainSlots, currentCaptainKey = null, eventRowMap } = params;
  const detailedRows = availableRows.map((row) => withDetails(row, eventRowMap));
  const ranges: Record<
    'overall' | 'composite' | 'auto' | 'teleop' | 'endgame' | 'opr' | 'rank' | 'matchesPlayed',
    [number, number]
  > = {
    overall: metricRange(detailedRows, 'overallEpa'),
    composite: metricRange(detailedRows, 'composite'),
    auto: metricRange(detailedRows, 'autoEpa'),
    teleop: metricRange(detailedRows, 'teleopEpa'),
    endgame: metricRange(detailedRows, 'endgameEpa'),
    opr: metricRange(detailedRows, 'opr'),
    rank: metricRange(
      detailedRows.map((row) => ({
        ...row,
        realRank: row.realRank ?? row.simRank ?? null,
      })),
      'realRank',
    ),
    matchesPlayed: metricRange(detailedRows, 'matchesPlayed'),
  };
  const currentSlot =
    captainSlots.find((slot) => slot.captain === currentCaptainKey) ??
    captainSlots.find((slot) => slot.captain === currentCaptainKey?.trim()) ??
    null;
  const currentAllianceRows = currentSlot
    ? [currentSlot.captain, ...(currentSlot.picks ?? [])]
        .map((teamKey) => eventRowMap.get(teamKey))
        .filter((row): row is AllianceCandidateRow => Boolean(row))
    : [];
  const currentWeakness = weaknessArea(currentAllianceRows);

  const chemistryRawScores = detailedRows.map((candidate) =>
    chemistryRaw(candidate, currentAllianceRows, ranges),
  );
  const coverageRawScores = detailedRows.map((candidate) => {
    const scores = phaseScores(candidate, ranges);
    const weakestBoost =
      currentWeakness === 'auto'
        ? scores.auto
        : currentWeakness === 'teleop'
          ? scores.teleop
          : currentWeakness === 'endgame'
            ? scores.endgame
            : (average([scores.auto, scores.teleop, scores.endgame]) ?? 0.5);
    const balancePenalty =
      Math.max(scores.auto, scores.teleop, scores.endgame) -
      Math.min(scores.auto, scores.teleop, scores.endgame);
    return weakestBoost * 0.6 + (1 - balancePenalty) * 0.2 + scores.overall * 0.2;
  });
  const ceilingRawScores = detailedRows.map((candidate) => {
    const scores = phaseScores(candidate, ranges);
    const phasePeak = Math.max(scores.auto, scores.teleop, scores.endgame);
    return (
      scores.overall * 0.35 +
      scores.composite * 0.2 +
      scores.opr * 0.15 +
      phasePeak * 0.2 +
      scores.teleop * 0.1
    );
  });
  const stabilityRawScores = detailedRows.map((candidate) => {
    const scores = phaseScores(candidate, ranges);
    const rankScore = inverseNormalize(candidate.realRank ?? candidate.simRank, ranges.rank);
    const matchesScore = normalize(candidate.matchesPlayed, ranges.matchesPlayed);
    const winRateScore = parseWinRate(candidate.record) ?? 0.5;
    return (
      scores.composite * 0.3 +
      rankScore * 0.25 +
      winRateScore * 0.2 +
      matchesScore * 0.1 +
      scores.endgame * 0.15
    );
  });
  const playoffReadyRawScores = detailedRows.map((candidate, index) => {
    const scores = phaseScores(candidate, ranges);
    return (
      (coverageRawScores[index] ?? 0.5) * 0.3 +
      (ceilingRawScores[index] ?? 0.5) * 0.25 +
      (stabilityRawScores[index] ?? 0.5) * 0.25 +
      scores.endgame * 0.1 +
      scores.teleop * 0.1
    );
  });
  const pickRawScores = detailedRows.map((candidate, index) => {
    const scores = phaseScores(candidate, ranges);
    return (
      scores.composite * 0.2 +
      (chemistryRawScores[index] ?? 0.5) * 0.2 +
      (coverageRawScores[index] ?? 0.5) * 0.2 +
      (ceilingRawScores[index] ?? 0.5) * 0.15 +
      (playoffReadyRawScores[index] ?? 0.5) * 0.25
    );
  });

  const denialDetails = detailedRows.map((candidate, index) => {
    let bestValue = 0;
    let bestCaptain: string | null = null;
    for (const slot of captainSlots) {
      if (!slot?.captain || slot.captain === currentCaptainKey) continue;
      const rivalAllianceRows = [slot.captain, ...(slot.picks ?? [])]
        .map((teamKey) => eventRowMap.get(teamKey))
        .filter((row): row is AllianceCandidateRow => Boolean(row));
      const fit = chemistryRaw(candidate, rivalAllianceRows, ranges);
      const seedThreat = Math.max(0, (9 - Number(slot.seed ?? 8)) / 8);
      const candidateStrength =
        (ceilingRawScores[index] ?? 0.5) * 0.35 +
        (playoffReadyRawScores[index] ?? 0.5) * 0.35 +
        fit * 0.15 +
        seedThreat * 0.15;
      const value = candidateStrength;
      if (value > bestValue) {
        bestValue = value;
        bestCaptain = slot.captain;
      }
    }
    return {
      value: bestValue,
      rivalCaptain: bestCaptain,
    };
  });

  const chemistryScores = rescale(chemistryRawScores);
  const coverageScores = rescale(coverageRawScores);
  const ceilingScores = rescale(ceilingRawScores);
  const stabilityScores = rescale(stabilityRawScores);
  const playoffReadyScores = rescale(playoffReadyRawScores);
  const pickScores = rescale(pickRawScores);
  const denialScores = rescale(denialDetails.map((detail) => detail.value));

  return detailedRows.map((candidate, index) => {
    const chemistryScore = chemistryScores[index] ?? 50;
    const coverageScore = coverageScores[index] ?? 50;
    const ceilingScore = ceilingScores[index] ?? 50;
    const stabilityScore = stabilityScores[index] ?? 50;
    const playoffReadyScore = playoffReadyScores[index] ?? 50;
    const pickValueScore = pickScores[index] ?? 50;
    const denialValueScore = denialScores[index] ?? 50;
    const recommendation =
      denialValueScore > pickValueScore && denialValueScore > chemistryScore + 5
        ? 'Deny rival'
        : chemistryScore > pickValueScore
          ? 'Best fit'
          : 'Build us';
    const useCaseOptions = [
      { label: 'Weakness patch' as const, score: coverageScore },
      { label: 'High ceiling' as const, score: ceilingScore },
      { label: 'Safe playoff fit' as const, score: stabilityScore + playoffReadyScore * 0.2 },
      { label: 'Rival denial' as const, score: denialValueScore },
    ].sort((a, b) => b.score - a.score);
    const bestUseCase = useCaseOptions[0]?.label ?? 'Weakness patch';
    const recommendationReason =
      bestUseCase === 'Weakness patch'
        ? `Best at covering our ${currentWeakness ?? 'current'} weakness.`
        : bestUseCase === 'High ceiling'
          ? 'Highest upside if we want more raw elimination power.'
          : bestUseCase === 'Safe playoff fit'
            ? 'Best blend of consistency, endgame, and playoff-ready profile.'
            : `Most dangerous if left for ${denialDetails[index]?.rivalCaptain ?? 'a rival'}.`;
    return {
      ...candidate,
      chemistryScore,
      coverageScore,
      ceilingScore,
      stabilityScore,
      playoffReadyScore,
      pickValueScore,
      denialValueScore,
      weakestArea: currentWeakness,
      rivalCaptain: denialDetails[index]?.rivalCaptain ?? null,
      bestUseCase,
      recommendationReason,
      recommendation,
    };
  });
}
