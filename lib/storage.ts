import type {
  CompositeWeights,
  QueueAlarmPreferenceKey,
  SettingsState,
  WebhookSettings,
} from './types';

export const DEFAULT_WEIGHTS: CompositeWeights = {
  overallEpa: 30,
  autoEpa: 10,
  teleopEpa: 15,
  endgameEpa: 10,
  opr: 10,
  ccwm: 10,
  rpPace: 10,
  recentTrend: 15,
};

export const DEFAULT_WEBHOOK_SETTINGS: WebhookSettings = {
  enabled: false,
  discordUrl: '',
  displayName: 'Strategy Desk',
  cooldownSeconds: 30,
  events: {
    queue_5: true,
    queue_2: true,
    queue_1: true,
    playing_now: true,
    mode_changed: true,
    snapshot_failed: true,
    snapshot_recovered: true,
    manual_load_failed: true,
    warning: true,
    test: true,
  },
};

export const DEFAULT_QUEUE_ALARM_STATES: Record<QueueAlarmPreferenceKey, boolean> = {
  QUEUE_5: true,
  QUEUE_2: true,
  QUEUE_1: true,
  PLAYING_NOW: true,
};

export const DEFAULT_SETTINGS: SettingsState = {
  teamNumber: 5431,
  eventKey: '',
  lagMatches: 2,
  pollMs: 5000,
  repeatUntilAck: true,
  enablePlayingAnimation: true,
  recentStartQual: 1,
  scoutingUrl: '',
  logoDataUrl: null,
  weights: DEFAULT_WEIGHTS,
  themeId: 'graphite-dark',
  language: 'en',
  webhook: DEFAULT_WEBHOOK_SETTINGS,
  operatorLabel: '',
  freezeAutoRefresh: false,
  deskMode: 'competition',
  queueAlarmStates: DEFAULT_QUEUE_ALARM_STATES,
};

const SETTINGS_KEY = 'tbsb_dashboard_settings_v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function loadSettings(): SettingsState {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as unknown;
    const parsedRecord = isRecord(parsed) ? parsed : {};
    const parsedWeights = isRecord(parsedRecord.weights)
      ? (parsedRecord.weights as Partial<CompositeWeights>)
      : {};
    const parsedWebhook = isRecord(parsedRecord.webhook)
      ? (parsedRecord.webhook as Partial<WebhookSettings>)
      : {};
    const parsedWebhookEvents = isRecord(parsedWebhook.events)
      ? (parsedWebhook.events as Partial<WebhookSettings['events']>)
      : {};
    const parsedQueueAlarmStates = isRecord(parsedRecord.queueAlarmStates)
      ? (parsedRecord.queueAlarmStates as Partial<Record<QueueAlarmPreferenceKey, boolean>>)
      : {};
    return {
      ...DEFAULT_SETTINGS,
      ...parsedRecord,
      weights: {
        ...DEFAULT_WEIGHTS,
        ...parsedWeights,
      },
      webhook: {
        ...DEFAULT_WEBHOOK_SETTINGS,
        ...parsedWebhook,
        events: {
          ...DEFAULT_WEBHOOK_SETTINGS.events,
          ...parsedWebhookEvents,
        },
      },
      queueAlarmStates: {
        ...DEFAULT_QUEUE_ALARM_STATES,
        ...parsedQueueAlarmStates,
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: SettingsState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures so the app still loads in restrictive mobile browsers.
  }
}
