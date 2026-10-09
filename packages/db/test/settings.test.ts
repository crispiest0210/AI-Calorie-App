import { describe, expect, it } from 'vitest';
import { getJsonSetting, getSetting, setJsonSetting, setSetting } from '../src/repositories/settings';
import { freshDb } from './helpers';

describe('settings', () => {
  it('returns null for a missing key and overwrites on repeated set', () => {
    const { db } = freshDb();
    expect(getSetting(db, 'theme')).toBeNull();
    setSetting(db, 'theme', 'dark');
    setSetting(db, 'theme', 'light');
    expect(getSetting(db, 'theme')).toBe('light');
  });

  it('round-trips JSON values and falls back when missing', () => {
    const { db } = freshDb();
    expect(getJsonSetting(db, 'prefs', { units: 'metric' })).toEqual({ units: 'metric' });
    setJsonSetting(db, 'prefs', { units: 'us', meals: [1, 2] });
    expect(getJsonSetting(db, 'prefs', null)).toEqual({ units: 'us', meals: [1, 2] });
  });

  it('falls back when the stored value is not valid JSON', () => {
    const { db } = freshDb();
    setSetting(db, 'prefs', '{not json');
    expect(getJsonSetting(db, 'prefs', 'fallback')).toBe('fallback');
  });
});
