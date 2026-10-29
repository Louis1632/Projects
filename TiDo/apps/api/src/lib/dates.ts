/** Date-only helpers. Every value is a YYYY-MM-DD calendar day; no time zones apply. */

export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function toUtcDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function fromUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, amount: number): string {
  const date = toUtcDate(day);
  date.setUTCDate(date.getUTCDate() + amount);
  return fromUtcDate(date);
}

export const maxDay = (a: string, b: string) => (a > b ? a : b);
export const minDay = (a: string, b: string) => (a < b ? a : b);

export function iso(value: Date): string;
export function iso(value: Date | null): string | null;
export function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
