/**
 * Runtime configuration. Nothing here is a secret: the Supabase anon key is a
 * public client identifier, and every privileged key stays on the server
 * (spec 2.12). Absent config means local mode, which is a supported state.
 */
import Constants from 'expo-constants';

interface Extra {
  apiBaseUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const config = {
  apiBaseUrl: extra.apiBaseUrl ?? '',
  supabaseUrl: extra.supabaseUrl ?? '',
  supabaseAnonKey: extra.supabaseAnonKey ?? '',
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
};

/** Accounts and sync are only offered when the app knows where to talk to. */
export const accountsEnabled = config.apiBaseUrl !== '' && config.supabaseUrl !== '' && config.supabaseAnonKey !== '';
