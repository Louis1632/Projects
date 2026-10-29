import { badRequest } from '../../errors';
import { addDays, fromUtcDate, toUtcDate } from '../../lib/dates';
import { RRule } from '../../lib/rrule';

/** Rule parts TiDo accepts. Anything else (BYHOUR, BYSETPOS on sub-daily rules…) is rejected. */
const ALLOWED_PARTS = new Set([
  'FREQ',
  'INTERVAL',
  'COUNT',
  'UNTIL',
  'BYDAY',
  'BYMONTHDAY',
  'BYMONTH',
  'BYYEARDAY',
  'BYWEEKNO',
  'BYSETPOS',
  'WKST',
]);
const ALLOWED_FREQ = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
const MAX_DATES_IN_FIVE_YEARS = 2_000;

/** Upper-cases, strips an optional "RRULE:" prefix and whitespace. */
export function normalizeRule(rule: string): string {
  return rule
    .trim()
    .toUpperCase()
    .replace(/^RRULE:/, '')
    .replace(/\s+/g, '')
    .replace(/;+$/, '');
}

function parts(rule: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of normalizeRule(rule).split(';')) {
    const [key, value] = part.split('=');
    if (!key || value === undefined || value === '') {
      throw badRequest(`"${part}" is not a valid rule part.`, 'invalid_rrule');
    }
    if (map.has(key)) throw badRequest(`${key} appears more than once.`, 'invalid_rrule');
    map.set(key, value);
  }
  return map;
}

function serialize(map: Map<string, string>): string {
  const ordered = ['FREQ', ...[...map.keys()].filter((key) => key !== 'FREQ')];
  return ordered.map((key) => `${key}=${map.get(key)}`).join(';');
}

function build(rule: string, startsOn: string): RRule {
  return new RRule({ ...RRule.parseString(normalizeRule(rule)), dtstart: toUtcDate(startsOn) });
}

/**
 * Validates a rule for date-only scheduling and returns its normalised form. Throws a
 * user-facing 400 error describing the first problem found.
 */
export function validateRule(rule: string, startsOn: string): string {
  const normalized = normalizeRule(rule);
  const map = parts(normalized);
  for (const key of map.keys()) {
    if (!ALLOWED_PARTS.has(key)) {
      throw badRequest(`${key} is not supported for date-based tasks.`, 'invalid_rrule');
    }
  }
  const freq = map.get('FREQ');
  if (!freq || !ALLOWED_FREQ.has(freq)) {
    throw badRequest('FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY.', 'invalid_rrule');
  }
  if (map.has('COUNT') && map.has('UNTIL')) {
    throw badRequest('Use either COUNT or UNTIL, not both.', 'invalid_rrule');
  }
  const interval = Number(map.get('INTERVAL') ?? '1');
  if (!Number.isInteger(interval) || interval < 1 || interval > 1_000) {
    throw badRequest('INTERVAL must be a whole number between 1 and 1000.', 'invalid_rrule');
  }
  const count = map.get('COUNT');
  if (count !== undefined && !/^[1-9]\d{0,3}$/.test(count)) {
    throw badRequest('COUNT must be between 1 and 9999.', 'invalid_rrule');
  }
  const until = map.get('UNTIL');
  if (until !== undefined && !/^\d{8}$/.test(until)) {
    throw badRequest('UNTIL must be a date such as 20271231.', 'invalid_rrule');
  }

  let parsed: RRule;
  try {
    parsed = build(normalized, startsOn);
  } catch {
    throw badRequest('That repeat rule could not be understood.', 'invalid_rrule');
  }
  const horizon = toUtcDate(addDays(startsOn, 5 * 366));
  const dates = parsed.between(
    toUtcDate(startsOn),
    horizon,
    true,
    (_, index) => index < MAX_DATES_IN_FIVE_YEARS + 1,
  );
  if (dates.length > MAX_DATES_IN_FIVE_YEARS) {
    throw badRequest('That rule repeats too often.', 'invalid_rrule');
  }
  if (!parsed.after(toUtcDate(addDays(startsOn, -1)), false)) {
    throw badRequest('That rule never produces a date on or after its start.', 'invalid_rrule');
  }
  return serialize(map);
}

/** Every rule date in the inclusive range [from, to]. */
export function occurrencesBetween(
  rule: string,
  startsOn: string,
  from: string,
  to: string,
): string[] {
  if (to < from) return [];
  return build(rule, startsOn).between(toUtcDate(from), toUtcDate(to), true).map(fromUtcDate);
}

export function firstOnOrAfter(rule: string, startsOn: string, day: string): string | null {
  const next = build(rule, startsOn).after(toUtcDate(day), true);
  return next ? fromUtcDate(next) : null;
}

/** How many rule dates fall strictly before `day`. */
export function countBefore(rule: string, startsOn: string, day: string): number {
  if (day <= startsOn) return 0;
  return occurrencesBetween(rule, startsOn, startsOn, addDays(day, -1)).length;
}

export function ruleCount(rule: string): number | null {
  const count = parts(rule).get('COUNT');
  return count ? Number(count) : null;
}

/** Returns the rule with its end condition replaced (both removed when neither is given). */
export function withEnd(rule: string, end: { until?: string; count?: number }): string {
  const map = parts(rule);
  map.delete('UNTIL');
  map.delete('COUNT');
  if (end.until) map.set('UNTIL', end.until.replaceAll('-', ''));
  if (end.count) map.set('COUNT', String(end.count));
  return serialize(map);
}

export function describeRule(rule: string, startsOn: string): string {
  try {
    return build(rule, startsOn).toText();
  } catch {
    return rule;
  }
}
