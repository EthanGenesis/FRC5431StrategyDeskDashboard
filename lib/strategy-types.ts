import type {
  EventMediaSnapshot,
  LiveSignal,
  NexusOpsSnapshot,
  OfficialEventSnapshot,
  ValidationSnapshot,
} from './types';
import type {
  StrategyContingencies,
  StrategyRiskLevel,
  StrategyRoleAssignments,
} from './strategy-presets';

export type StrategyStatus = 'none' | 'draft' | 'ready' | 'used' | 'reviewed';

type ExternalRecord = Record<string, unknown>;
type ExternalArray = ExternalRecord[];

export type StrategyTool = 'pen' | 'line' | 'arrow' | 'rectangle' | 'circle' | 'text' | 'eraser';

export type StrategyBoardBackground = 'field' | 'grid';

export type StrategyPoint = {
  x: number;
  y: number;
};

export type StrategyMarker = {
  id: string;
  teamKey: string;
  teamNumber: number;
  alliance: 'red' | 'blue';
  x: number;
  y: number;
};

export type StrategyShape =
  | {
      id: string;
      kind: 'pen';
      color: string;
      strokeWidth: number;
      points: StrategyPoint[];
    }
  | {
      id: string;
      kind: 'line' | 'arrow' | 'rectangle' | 'circle';
      color: string;
      strokeWidth: number;
      start: StrategyPoint;
      end: StrategyPoint;
    }
  | {
      id: string;
      kind: 'text';
      color: string;
      fontSize: number;
      position: StrategyPoint;
      text: string;
    };

export type StrategyBoardState = {
  background: StrategyBoardBackground;
  shapes: StrategyShape[];
  markers: StrategyMarker[];
};

export type StrategyRecord = {
  id: string;
  eventKey: string;
  matchKey: string;
  matchLabel: string;
  eventName: string;
  compLevel: string;
  allianceTeams: {
    red: string[];
    blue: string[];
  };
  status: StrategyStatus;
  notes: string;
  planSummary?: string | null;
  keyWinConditions?: string[] | null;
  retroNotes?: string | null;
  templateId?: string | null;
  riskLevel?: StrategyRiskLevel | null;
  roleAssignments?: StrategyRoleAssignments | null;
  contingencies?: StrategyContingencies | null;
  autoBoard: StrategyBoardState;
  teleopBoard: StrategyBoardState;
  createdAtMs: number;
  updatedAtMs: number;
  copiedFrom?: {
    eventKey: string;
    matchKey: string;
    scope: 'full' | 'auto' | 'teleop' | 'notes';
  } | null;
};

export type StrategyRecordSummary = Pick<
  StrategyRecord,
  | 'id'
  | 'eventKey'
  | 'matchKey'
  | 'matchLabel'
  | 'eventName'
  | 'status'
  | 'planSummary'
  | 'templateId'
  | 'riskLevel'
  | 'copiedFrom'
  | 'updatedAtMs'
  | 'allianceTeams'
>;

export type EventContextSnapshot = {
  generatedAtMs: number;
  inputs: {
    eventKey: string;
  };
  tba: {
    event: ExternalRecord | null;
    matches: ExternalArray;
    rankings: ExternalRecord | null;
    oprs: ExternalRecord | null;
    alliances: ExternalRecord | null;
    status: ExternalRecord | null;
    insights: ExternalRecord | null;
    awards: ExternalArray;
    teams: ExternalArray | null;
  };
  sb: {
    matches: ExternalArray;
    teamEvents: ExternalArray;
    teamMatches: ExternalArray;
  };
  official?: OfficialEventSnapshot | null;
  nexus?: NexusOpsSnapshot | null;
  media?: EventMediaSnapshot | null;
  validation?: ValidationSnapshot | null;
  liveSignals?: LiveSignal[];
};

export type TeamProfileMatch = {
  key: string;
  eventKey: string;
  eventName: string;
  matchLabel: string;
  compLevel: string;
  time: number | null;
  played: boolean;
  elim: boolean;
  alliance: 'red' | 'blue' | null;
  partners: string[];
  opponents: string[];
  result: 'win' | 'loss' | 'tie' | 'unknown';
  myScore?: number | null;
  oppScore?: number | null;
  margin?: number | null;
  redScore: number | null;
  blueScore: number | null;
  winningAlliance: 'red' | 'blue' | '' | null;
  epaTotal?: number | null;
  epaPost?: number | null;
  breakdown?: ExternalRecord | null;
  week?: number | null;
  status?: string | null;
  dq?: boolean;
  surrogate?: boolean;
  sb: ExternalRecord | null;
  tba: ExternalRecord | null;
};

export type TeamProfileResponse = {
  generatedAtMs: number;
  team: number;
  summary: ExternalRecord | null;
  seasonSummary?: ExternalRecord | null;
  seasonRollups?: ExternalRecord | null;
  playedEvents: ExternalArray;
  upcomingEvents?: ExternalArray;
  teamEventsByKey: Record<string, ExternalRecord>;
  matches: TeamProfileMatch[];
};

export type TeamProfileCurrentEvent = {
  eventKey: string;
  event: ExternalRecord | null;
  fieldAverages: Record<string, number | null> | null;
  eventRow: ExternalRecord | null;
  eventMatches: ExternalArray;
  eventStatusHtml: string | null;
  eventStatusText: string | null;
  derived: Record<string, number | string | boolean | null> | null;
};

export type TeamProfileRouteResponse = TeamProfileResponse & {
  loadedEventKey: string | null;
  seasonEvents: ExternalArray;
  currentEvent: TeamProfileCurrentEvent | null;
  historical2026: {
    seasonEvents: ExternalArray;
    playedEvents: ExternalArray;
    upcomingEvents: ExternalArray;
    matches: TeamProfileMatch[];
  };
};

export type PreEventScoutResponse = {
  generatedAtMs: number;
  eventKey: string;
  event: ExternalRecord | null;
  teams: {
    teamNumber: number;
    teamKey: string;
    nickname: string;
    seasonSummary: ExternalRecord | null;
    seasonRollups: ExternalRecord | null;
    playedEvents: ExternalArray;
    upcomingEvents: ExternalArray;
  }[];
};
