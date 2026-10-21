describe('config', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('expo-constants');
  });

  function load(expoConfig: unknown) {
    jest.resetModules();
    jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig } }));
    return jest.requireActual<typeof import('@/config')>('@/config');
  }

  it('falls back to local mode when there is no expo config', () => {
    const { config, accountsEnabled } = load(null);
    expect(config).toEqual({ apiBaseUrl: '', supabaseUrl: '', supabaseAnonKey: '', appVersion: '0.0.0' });
    expect(accountsEnabled).toBe(false);
  });

  it('enables accounts only when the API url, Supabase url and anon key are all set', () => {
    const full = { apiBaseUrl: 'https://api.example', supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' };
    expect(load({ version: '1.2.3', extra: full }).accountsEnabled).toBe(true);
    expect(load({ extra: { ...full, apiBaseUrl: undefined } }).accountsEnabled).toBe(false);
    expect(load({ extra: { ...full, supabaseUrl: '' } }).accountsEnabled).toBe(false);
    expect(load({ extra: { ...full, supabaseAnonKey: '' } }).accountsEnabled).toBe(false);
  });

  it('reports the app version from the expo config', () => {
    expect(load({ version: '1.2.3' }).config.appVersion).toBe('1.2.3');
  });
});
