import * as rruleModule from 'rrule';
import { parseDay } from './dates';

type RRuleModule = typeof rruleModule;
const { RRule } = (rruleModule as { default?: RRuleModule }).default ?? rruleModule;

export const WEEKDAYS = [
  { code: 'MO', label: 'Mon' },
  { code: 'TU', label: 'Tue' },
  { code: 'WE', label: 'Wed' },
  { code: 'TH', label: 'Thu' },
  { code: 'FR', label: 'Fri' },
  { code: 'SA', label: 'Sat' },
  { code: 'SU', label: 'Sun' },
] as const;

export type Preset =
  | 'none'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly-date'
  | 'monthly-last'
  | 'monthly-nth'
  | 'yearly'
  | 'custom';
export type EndKind = 'never' | 'count' | 'until';

export interface RecurrenceDraft {
  preset: Preset;
  interval: number;
  weekdays: string[];
  end: EndKind;
  count: number;
  until: string;
  custom: string;
}

const NTH = ['1', '2', '3', '4', '-1'];
const ordinal = (n: string) =>
  ({ '1': 'first', '2': 'second', '3': 'third', '4': 'fourth', '-1': 'last' })[n];

function weekdayCode(day: string): string {
  return WEEKDAYS[(parseDay(day).getUTCDay() + 6) % 7]!.code;
}

function nthOfMonth(day: string): string {
  const date = parseDay(day).getUTCDate();
  const daysInMonth = new Date(
    Date.UTC(parseDay(day).getUTCFullYear(), parseDay(day).getUTCMonth() + 1, 0),
  ).getUTCDate();
  if (date + 7 > daysInMonth) return '-1';
  return NTH[Math.floor((date - 1) / 7)]!;
}

export function emptyDraft(anchor: string): RecurrenceDraft {
  return {
    preset: 'none',
    interval: 1,
    weekdays: [weekdayCode(anchor)],
    end: 'never',
    count: 10,
    until: '',
    custom: '',
  };
}

/** Builds an RRULE string from the editor state, or null for "does not repeat". */
export function draftToRule(draft: RecurrenceDraft, anchor: string): string | null {
  if (draft.preset === 'none') return null;
  if (draft.preset === 'custom') return draft.custom.trim().toUpperCase() || null;

  const parts: string[] = [];
  const interval = draft.interval > 1 ? `;INTERVAL=${draft.interval}` : '';
  switch (draft.preset) {
    case 'daily':
      parts.push(`FREQ=DAILY${interval}`);
      break;
    case 'weekdays':
      parts.push('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
      break;
    case 'weekly':
      parts.push(
        `FREQ=WEEKLY${interval};BYDAY=${(draft.weekdays.length ? draft.weekdays : [weekdayCode(anchor)]).join(',')}`,
      );
      break;
    case 'monthly-date':
      parts.push(`FREQ=MONTHLY${interval};BYMONTHDAY=${parseDay(anchor).getUTCDate()}`);
      break;
    case 'monthly-last':
      parts.push(`FREQ=MONTHLY${interval};BYMONTHDAY=-1`);
      break;
    case 'monthly-nth':
      parts.push(`FREQ=MONTHLY${interval};BYDAY=${nthOfMonth(anchor)}${weekdayCode(anchor)}`);
      break;
    case 'yearly':
      parts.push(`FREQ=YEARLY${interval}`);
      break;
  }
  if (draft.end === 'count' && draft.count > 0) parts.push(`COUNT=${draft.count}`);
  if (draft.end === 'until' && draft.until) parts.push(`UNTIL=${draft.until.replaceAll('-', '')}`);
  return parts.join(';');
}

/** Best-effort reverse mapping so existing rules reopen in the matching preset. */
export function ruleToDraft(rule: string | null | undefined, anchor: string): RecurrenceDraft {
  const draft = emptyDraft(anchor);
  if (!rule) return draft;
  const map = new Map(rule.split(';').map((part) => part.split('=') as [string, string]));
  const known = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'COUNT', 'UNTIL']);
  draft.interval = Number(map.get('INTERVAL') ?? 1);
  if (map.has('COUNT')) Object.assign(draft, { end: 'count', count: Number(map.get('COUNT')) });
  if (map.has('UNTIL')) {
    const until = map.get('UNTIL')!;
    Object.assign(draft, {
      end: 'until',
      until: `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`,
    });
  }
  const freq = map.get('FREQ');
  const byDay = map.get('BYDAY');
  const byMonthDay = map.get('BYMONTHDAY');
  const candidate: RecurrenceDraft = { ...draft, preset: 'custom', custom: rule };
  if ([...map.keys()].some((key) => !known.has(key))) return candidate;

  if (freq === 'DAILY' && !byDay && !byMonthDay) draft.preset = 'daily';
  else if (freq === 'WEEKLY' && byDay === 'MO,TU,WE,TH,FR' && draft.interval === 1)
    draft.preset = 'weekdays';
  else if (
    freq === 'WEEKLY' &&
    byDay &&
    /^(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU))*$/.test(byDay)
  ) {
    draft.preset = 'weekly';
    draft.weekdays = byDay.split(',');
  } else if (freq === 'MONTHLY' && byMonthDay === '-1' && !byDay) draft.preset = 'monthly-last';
  else if (freq === 'MONTHLY' && byMonthDay && !byDay) draft.preset = 'monthly-date';
  else if (freq === 'MONTHLY' && byDay && /^-?\d[A-Z]{2}$/.test(byDay))
    draft.preset = 'monthly-nth';
  else if (freq === 'YEARLY' && !byDay && !byMonthDay) draft.preset = 'yearly';
  else return candidate;
  draft.custom = rule;
  return draft;
}

export function presetLabel(preset: Preset, anchor: string): string {
  const date = parseDay(anchor);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(
    date,
  );
  switch (preset) {
    case 'none':
      return 'Does not repeat';
    case 'daily':
      return 'Daily';
    case 'weekdays':
      return 'Every weekday (Mon–Fri)';
    case 'weekly':
      return 'Weekly on chosen days';
    case 'monthly-date':
      return `Monthly on day ${date.getUTCDate()}`;
    case 'monthly-last':
      return 'Monthly on the last day';
    case 'monthly-nth':
      return `Monthly on the ${ordinal(nthOfMonth(anchor))} ${weekday}`;
    case 'yearly':
      return 'Yearly on this date';
    case 'custom':
      return 'Custom rule (RFC 5545)';
  }
}

/** Human-readable summary such as "every 2 weeks on Monday, Friday". */
export function describeRule(rule: string, startsOn: string): string {
  try {
    return new RRule({ ...RRule.parseString(rule), dtstart: parseDay(startsOn) }).toText();
  } catch {
    return rule;
  }
}

/** The next few dates a rule produces, for previewing in the editor. */
export function previewDates(rule: string, startsOn: string, count = 4): string[] {
  try {
    const parsed = new RRule({ ...RRule.parseString(rule), dtstart: parseDay(startsOn) });
    return parsed.all((_, index) => index < count).map((date) => date.toISOString().slice(0, 10));
  } catch {
    return [];
  }
}
