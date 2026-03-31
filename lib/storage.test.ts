import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './storage';

describe('settings storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists theme, language, and webhook settings', () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      themeId: 'light-slate',
      language: 'fr',
      webhook: {
        ...DEFAULT_SETTINGS.webhook,
        enabled: true,
        discordUrl: 'https://discord.com/api/webhooks/1/example',
        displayName: 'Pit Alert',
        cooldownSeconds: 45,
        events: {
          ...DEFAULT_SETTINGS.webhook.events,
          queue_5: false,
          warning: true,
        },
      },
    });

    const loaded = loadSettings();

    expect(loaded.themeId).toBe('light-slate');
    expect(loaded.language).toBe('fr');
    expect(loaded.webhook.enabled).toBe(true);
    expect(loaded.webhook.displayName).toBe('Pit Alert');
    expect(loaded.webhook.cooldownSeconds).toBe(45);
    expect(loaded.webhook.events.queue_5).toBe(false);
    expect(loaded.webhook.events.warning).toBe(true);
  });

  it('does not throw when localStorage writes are blocked', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });

    expect(() =>
      saveSettings({
        ...DEFAULT_SETTINGS,
        themeId: 'light-slate',
      }),
    ).not.toThrow();

    setItemSpy.mockRestore();
  });
});
