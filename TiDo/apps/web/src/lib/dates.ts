/** Date-only helpers. Values are YYYY-MM-DD strings interpreted as calendar days. */

export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function parseDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date));
}

export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, amount: number): string {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDay(date);
}

export function prettyDay(day: string | null | undefined, today?: string): string {
  if (!day) return 'No date';
  if (today) {
    if (day === today) return 'Today';
    if (day === addDays(today, 1)) return 'Tomorrow';
    if (day === addDays(today, -1)) return 'Yesterday';
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parseDay(day));
}

export function monthTitle(month: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseDay(month));
}

/** First day of the month containing `day`. */
export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function shiftMonth(month: string, amount: number): string {
  const date = parseDay(month);
  date.setUTCMonth(date.getUTCMonth() + amount, 1);
  return formatDay(date);
}

/** Six Monday-first weeks covering the month, as YYYY-MM-DD strings. */
export function monthGrid(month: string): string[] {
  const first = parseDay(startOfMonth(month));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = addDays(formatDay(first), -offset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}
