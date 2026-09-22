/**
 * The day an entry belongs to is the calendar date on the device at log time,
 * and it never moves afterwards (review item R4 — there is no day_starts_at
 * setting and travel does not re-bucket past entries).
 */

export type LocalDate = string; // YYYY-MM-DD

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(value: string): value is LocalDate {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The local calendar date of an instant, as the device's clock sees it. */
export function localDateOf(instant: Date = new Date()): LocalDate {
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`;
}

export function tzOffsetMinutesOf(instant: Date = new Date()): number {
  // Date#getTimezoneOffset is minutes *behind* UTC; store the conventional sign.
  return -instant.getTimezoneOffset();
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  const parse = (s: LocalDate) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** The `count` days ending at `endDate`, oldest first — the History trend window. */
export function lastNDays(endDate: LocalDate, count: number): LocalDate[] {
  const out: LocalDate[] = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(addDays(endDate, -i));
  return out;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDayLabel(date: LocalDate, today: LocalDate): string {
  const delta = daysBetween(date, today);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Yesterday';
  if (delta === -1) return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()]}, ${MONTHS[m - 1]} ${d}`;
}

export function formatTimeOfDay(instantMs: number): string {
  const d = new Date(instantMs);
  const hours = d.getHours();
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${pad(d.getMinutes())} ${suffix}`;
}
