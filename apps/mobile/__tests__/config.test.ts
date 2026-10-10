type Extra = Record<string, string | undefined>;

function loadConfig(extra: Extra | undefined, version?: string) {
  jest.resetModules();
  jest.doMock('expo-constants', () => ({
    __esModule: true,
    default: { expoConfig: extra === undefined && version === undefined ? undefined : { extra, version } },
  }));
  return jest.requireActual<typeof import('../src/config')>('../src/config');
}

describe('config', () => {
  it('runs in local mode when nothing is configured', () => {
    const { config, accountsEnabled } = loadConfig(undefined);
    expect(config).toEqual({ apiBaseUrl: '', supabaseUrl: '', supabaseAnonKey: '', appVersion: '0.0.0' });
    expect(accountsEnabled).toBe(false);
  });

  it('stays in local mode when only part of the account config is present', () => {
    const { accountsEnabled } = loadConfig({ apiBaseUrl: 'https://api.example.com', supabaseUrl: 'https://x.supabase.co' });
    expect(accountsEnabled).toBe(false);
  });

  it('enables accounts once the API and Supabase settings are all present', () => {
    const { config, accountsEnabled } = loadConfig(
      { apiBaseUrl: 'https://api.example.com', supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' },
      '1.2.3',
    );
    expect(accountsEnabled).toBe(true);
    expect(config.appVersion).toBe('1.2.3');
  });
});
