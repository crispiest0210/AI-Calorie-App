/** Small key/value settings that are not user data worth syncing on their own. */
import { eq } from 'drizzle-orm';
import { appSetting } from '../schema';
import type { Db } from '../db';

export function getSetting(db: Db, key: string): string | null {
  return db.select().from(appSetting).where(eq(appSetting.key, key)).get()?.value ?? null;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.insert(appSetting).values({ key, value }).onConflictDoUpdate({ target: appSetting.key, set: { value } }).run();
}

export function getJsonSetting<T>(db: Db, key: string, fallback: T): T {
  const raw = getSetting(db, key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJsonSetting(db: Db, key: string, value: unknown): void {
  setSetting(db, key, JSON.stringify(value));
}
