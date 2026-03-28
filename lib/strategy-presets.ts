export type StrategyRiskLevel = 'safe' | 'balanced' | 'aggressive';

export type StrategyRoleKey =
  | 'autoLead'
  | 'cycleLead'
  | 'defenseLead'
  | 'feederLead'
  | 'endgameLead'
  | 'flexSupport';

export type StrategyRoleAssignments = Record<StrategyRoleKey, string>;

export type StrategyContingencyKey =
  | 'autoMiss'
  | 'defensePressure'
  | 'partnerFailure'
  | 'foulPressure'
  | 'endgameFallback';

export type StrategyContingencies = Record<StrategyContingencyKey, string>;

export type StrategyTemplate = {
  id: string;
  label: string;
  description: string;
  riskLevel: StrategyRiskLevel;
  notesPrompt: string;
  roleHints: Partial<Record<StrategyRoleKey, string>>;
  contingencies: StrategyContingencies;
};

export const STRATEGY_RISK_OPTIONS: {
  id: StrategyRiskLevel;
  label: string;
  description: string;
}[] = [
  {
    id: 'safe',
    label: 'Safe',
    description: 'Protect floor outcomes, preserve RP paths, and reduce volatility.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Blend scoring pressure with fallback options and denial windows.',
  },
  {
    id: 'aggressive',
    label: 'Aggressive',
    description: 'Push ceiling outcomes and upset pressure, even with more risk.',
  },
];

export const STRATEGY_ROLE_LABELS: Record<StrategyRoleKey, string> = {
  autoLead: 'Auto Lead',
  cycleLead: 'Cycle Lead',
  defenseLead: 'Defense Lead',
  feederLead: 'Feeder / Linker',
  endgameLead: 'Endgame Lead',
  flexSupport: 'Flex / Bailout',
};

export const STRATEGY_CONTINGENCY_LABELS: Record<StrategyContingencyKey, string> = {
  autoMiss: 'If auto goes sideways',
  defensePressure: 'If defense ramps up',
  partnerFailure: 'If a partner loses function',
  foulPressure: 'If foul risk climbs',
  endgameFallback: 'If endgame plan slips',
};

const EMPTY_ROLE_ASSIGNMENTS: StrategyRoleAssignments = {
  autoLead: '',
  cycleLead: '',
  defenseLead: '',
  feederLead: '',
  endgameLead: '',
  flexSupport: '',
};

const EMPTY_CONTINGENCIES: StrategyContingencies = {
  autoMiss: '',
  defensePressure: '',
  partnerFailure: '',
  foulPressure: '',
  endgameFallback: '',
};

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: 'safe_rp',
    label: 'Safe RP Plan',
    description: 'High-floor plan built to preserve ranking points and avoid dead possessions.',
    riskLevel: 'safe',
    notesPrompt:
      'Primary objective: secure a clean, repeatable match. Protect autonomous completion, avoid penalties, and favor reliable endgame timing over speculative swings.',
    roleHints: {
      autoLead: 'Best autonomous robot',
      cycleLead: 'Highest-volume scorer',
      feederLead: 'Link completion / support robot',
      endgameLead: 'Most reliable finisher',
    },
    contingencies: {
      autoMiss: 'Abort risky follow-up and settle into the cleanest cycle lane immediately.',
      defensePressure:
        'Rotate support robot into traffic clearing and protect the highest-value scorer.',
      partnerFailure: 'Collapse to two-robot score plan and preserve endgame timing.',
      foulPressure: 'Call off contact-first defense and reset to clean pathing.',
      endgameFallback: 'Leave scoring lane early enough to guarantee the best reliable endgame.',
    },
  },
  {
    id: 'upset_push',
    label: 'Upset Push',
    description: 'Ceiling-first plan for stealing a match from a stronger opponent.',
    riskLevel: 'aggressive',
    notesPrompt:
      'Primary objective: increase ceiling and variance. Push advantage windows early, force uncomfortable matchups, and accept controlled risk if it changes the win path.',
    roleHints: {
      autoLead: 'Highest swing autonomous robot',
      cycleLead: 'Fastest scorer',
      defenseLead: 'Best denial / disruption robot',
      flexSupport: 'Robot ready to swap roles mid-match',
    },
    contingencies: {
      autoMiss:
        'Call the highest-upside recovery lane immediately instead of resetting to low ceiling.',
      defensePressure: 'Use the flex robot to create space and flip who carries scoring load.',
      partnerFailure:
        'Push remaining best robot into primary scoring and let the third robot deny.',
      foulPressure: 'Keep aggression but move contact windows away from protected zones.',
      endgameFallback: 'Trade late-cycle greed for guaranteed climb/bonus if the margin is close.',
    },
  },
  {
    id: 'anti_defense',
    label: 'Anti-Defense',
    description:
      'Plan around traffic, protected lanes, and staying productive against heavy contact.',
    riskLevel: 'balanced',
    notesPrompt:
      'Primary objective: stay efficient under pressure. Pre-plan alternate lanes, handoffs, and traffic relief so one defender does not collapse the whole match.',
    roleHints: {
      cycleLead: 'Robot least affected by traffic',
      feederLead: 'Robot best at relieving congestion',
      defenseLead: 'Robot that can legally peel or screen',
      flexSupport: 'Robot ready to counter-rotate lanes',
    },
    contingencies: {
      autoMiss: 'Do not compound the miss. Reset quickly and reclaim the cleanest lane.',
      defensePressure: 'Switch to alternate lane map and reduce long exposed traversals.',
      partnerFailure:
        'Use remaining feeder/flex robot to keep the scorer free instead of both forcing cycles.',
      foulPressure: 'Stop peel contact and win with pathing plus protected touches.',
      endgameFallback:
        'Bank the safest endgame while the primary scorer stays live as long as possible.',
    },
  },
  {
    id: 'denial_focus',
    label: 'Denial Focus',
    description: 'Shape the match around slowing the enemy win condition or bonus path.',
    riskLevel: 'balanced',
    notesPrompt:
      'Primary objective: deny the opponent their cleanest scoring route or bonus condition while keeping our own floor intact.',
    roleHints: {
      defenseLead: 'Best denial robot',
      cycleLead: 'Robot least disrupted by role change',
      flexSupport: 'Robot that can shift between scoring and denial support',
      endgameLead: 'Most dependable closer',
    },
    contingencies: {
      autoMiss: 'Do not chase lost points; pivot into opponent denial sooner.',
      defensePressure: 'Screen for the denial robot so they can stay active without fouling.',
      partnerFailure:
        'Cut denial windows to the highest-value moments only and protect your remaining scorer.',
      foulPressure: 'Switch from body denial to route denial and timing denial.',
      endgameFallback: 'Leave denial early enough to lock in the endgame floor.',
    },
  },
];

export function createEmptyRoleAssignments(): StrategyRoleAssignments {
  return { ...EMPTY_ROLE_ASSIGNMENTS };
}

export function createEmptyContingencies(): StrategyContingencies {
  return { ...EMPTY_CONTINGENCIES };
}

export function coerceStrategyRiskLevel(value: unknown): StrategyRiskLevel {
  return value === 'safe' || value === 'aggressive' ? value : 'balanced';
}

export function normalizeRoleAssignments(value: unknown): StrategyRoleAssignments {
  if (!value || typeof value !== 'object') return createEmptyRoleAssignments();
  return {
    autoLead: String((value as Partial<StrategyRoleAssignments>).autoLead ?? ''),
    cycleLead: String((value as Partial<StrategyRoleAssignments>).cycleLead ?? ''),
    defenseLead: String((value as Partial<StrategyRoleAssignments>).defenseLead ?? ''),
    feederLead: String((value as Partial<StrategyRoleAssignments>).feederLead ?? ''),
    endgameLead: String((value as Partial<StrategyRoleAssignments>).endgameLead ?? ''),
    flexSupport: String((value as Partial<StrategyRoleAssignments>).flexSupport ?? ''),
  };
}

export function normalizeContingencies(value: unknown): StrategyContingencies {
  if (!value || typeof value !== 'object') return createEmptyContingencies();
  return {
    autoMiss: String((value as Partial<StrategyContingencies>).autoMiss ?? ''),
    defensePressure: String((value as Partial<StrategyContingencies>).defensePressure ?? ''),
    partnerFailure: String((value as Partial<StrategyContingencies>).partnerFailure ?? ''),
    foulPressure: String((value as Partial<StrategyContingencies>).foulPressure ?? ''),
    endgameFallback: String((value as Partial<StrategyContingencies>).endgameFallback ?? ''),
  };
}

export function getStrategyTemplate(
  templateId: string | null | undefined,
): StrategyTemplate | null {
  if (!templateId) return null;
  return STRATEGY_TEMPLATES.find((template) => template.id === templateId) ?? null;
}
