/**
 * Export and account deletion (F14). Both are required before anyone other
 * than the builder uses this, and the privacy notice depends on them.
 */
import { ApiError } from '../errors';
import type { Sql } from '../db';

/** Deleting an account is irreversible, so the token must be freshly issued. */
export const REAUTH_WINDOW_SECONDS = 300;

export interface ExportDocument {
  version: 1;
  exportedAt: string;
  userId: string;
  logEntries: unknown[];
  waterEntries: unknown[];
  waterPresets: unknown[];
  goalProfiles: unknown[];
  customFoods: unknown[];
  /** The same log entries as CSV, for anything that reads spreadsheets. */
  csv: { logEntries: string };
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.join(','), ...rows.map((row) => columns.map((c) => escape(row[c])).join(','))].join('\n');
}

export async function exportAll(sql: Sql, userId: string): Promise<ExportDocument> {
  const logEntries = (await sql.query(`select * from log_entry where user_id = $1 order by logged_at`, [userId])).rows;
  const waterEntries = (await sql.query(`select * from water_entry where user_id = $1 order by logged_at`, [userId])).rows;
  const waterPresets = (await sql.query(`select * from water_preset where user_id = $1 order by position`, [userId])).rows;
  const goalProfiles = (await sql.query(`select * from goal_profile where user_id = $1 order by effective_from`, [userId])).rows;
  const customFoods = (
    await sql.query(
      `select f.*,
              coalesce((select json_agg(json_build_object('nutrientCode', n.nutrient_code,
                                                          'amountPer100g', n.amount_per_100g::text,
                                                          'derivation', n.derivation))
                        from food_nutrient n where n.food_id = f.id), '[]'::json) as nutrients,
              coalesce((select json_agg(json_build_object('id', p.id, 'label', p.label,
                                                          'gramWeight', p.gram_weight::text,
                                                          'source', p.source, 'position', p.position)
                                        order by p.position)
                        from food_portion p where p.food_id = f.id), '[]'::json) as portions
       from food f where f.owner_user_id = $1 order by f.name`,
      [userId],
    )
  ).rows;

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    userId,
    logEntries,
    waterEntries,
    waterPresets,
    goalProfiles,
    customFoods,
    csv: {
      logEntries: toCsv(logEntries, [
        'local_date', 'meal_slot', 'food_name_snapshot', 'amount_value', 'amount_unit',
        'grams', 'grams_provenance', 'nutrients_per_100g', 'nutrients_absolute', 'note',
      ]),
    },
  };
}

export async function deleteAccount(sql: Sql, userId: string, tokenIssuedAt: number, now = Date.now()): Promise<void> {
  const ageSeconds = now / 1000 - tokenIssuedAt;
  if (ageSeconds > REAUTH_WINDOW_SECONDS) {
    throw new ApiError('unauthorized', 'sign in again before deleting your account');
  }
  // Custom foods cascade to their nutrients and portions.
  await sql.query('delete from food where owner_user_id = $1', [userId]);
  for (const table of ['log_entry', 'water_entry', 'water_preset', 'goal_profile', 'user_settings', 'idempotency_key', 'sync_watermark']) {
    await sql.query(`delete from ${table} where user_id = $1`, [userId]);
  }
}
