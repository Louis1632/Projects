import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors';
import {
  countBefore,
  firstOnOrAfter,
  normalizeRule,
  occurrencesBetween,
  ruleCount,
  validateRule,
  withEnd,
} from '../../src/modules/recurrence/rules';

const rejects = (rule: string, start = '2026-01-01') => {
  try {
    validateRule(rule, start);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).message;
  }
  throw new Error(`expected ${rule} to be rejected`);
};

describe('validateRule', () => {
  it('normalises case, prefix and whitespace, keeping FREQ first', () => {
    expect(validateRule('rrule: byday=mo,fr ; freq=weekly', '2026-01-05')).toBe(
      'FREQ=WEEKLY;BYDAY=MO,FR',
    );
    expect(normalizeRule(' RRULE:FREQ=DAILY; ')).toBe('FREQ=DAILY');
  });

  it('rejects sub-daily frequencies and time-of-day parts', () => {
    expect(rejects('FREQ=HOURLY')).toMatch(/FREQ must be/);
    expect(rejects('FREQ=DAILY;BYHOUR=9')).toMatch(/BYHOUR is not supported/);
  });

  it('rejects COUNT with UNTIL, bad intervals and duplicates', () => {
    expect(rejects('FREQ=DAILY;COUNT=3;UNTIL=20270101')).toMatch(/either COUNT or UNTIL/);
    expect(rejects('FREQ=DAILY;INTERVAL=0')).toMatch(/INTERVAL/);
    expect(rejects('FREQ=DAILY;FREQ=WEEKLY')).toMatch(/more than once/);
  });

  it('rejects rules that never produce a date', () => {
    expect(rejects('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30')).toMatch(/never produces/);
    expect(rejects('FREQ=DAILY;UNTIL=20251231', '2026-01-01')).toMatch(/never produces/);
  });

  it('accepts a daily rule (the most frequent allowed)', () => {
    expect(validateRule('FREQ=DAILY', '2026-01-01')).toBe('FREQ=DAILY');
  });
});

describe('occurrence expansion', () => {
  it('skips months without a 31st (RFC 5545 behaviour)', () => {
    expect(
      occurrencesBetween('FREQ=MONTHLY;BYMONTHDAY=31', '2026-01-31', '2026-01-01', '2026-06-30'),
    ).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });

  it('supports the last day of every month', () => {
    expect(
      occurrencesBetween('FREQ=MONTHLY;BYMONTHDAY=-1', '2028-01-01', '2028-01-01', '2028-04-30'),
    ).toEqual(['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30']);
  });

  it('only produces Feb 29 in leap years', () => {
    expect(
      occurrencesBetween(
        'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
        '2024-02-29',
        '2024-01-01',
        '2033-12-31',
      ),
    ).toEqual(['2024-02-29', '2028-02-29', '2032-02-29']);
  });

  it('honours COUNT and UNTIL', () => {
    expect(
      occurrencesBetween('FREQ=WEEKLY;COUNT=3', '2026-03-02', '2026-01-01', '2026-12-31'),
    ).toEqual(['2026-03-02', '2026-03-09', '2026-03-16']);
    expect(
      occurrencesBetween('FREQ=DAILY;UNTIL=20260303', '2026-03-01', '2026-01-01', '2026-12-31'),
    ).toHaveLength(3);
  });

  it('expands nth-weekday monthly rules', () => {
    expect(
      occurrencesBetween('FREQ=MONTHLY;BYDAY=-1FR', '2026-01-01', '2026-01-01', '2026-03-31'),
    ).toEqual(['2026-01-30', '2026-02-27', '2026-03-27']);
  });

  it('finds the first date on or after a day, and counts earlier dates', () => {
    expect(firstOnOrAfter('FREQ=WEEKLY;BYDAY=MO', '2026-03-04', '2026-03-04')).toBe('2026-03-09');
    expect(countBefore('FREQ=DAILY', '2026-03-01', '2026-03-05')).toBe(4);
    expect(countBefore('FREQ=DAILY', '2026-03-01', '2026-03-01')).toBe(0);
  });
});

describe('withEnd', () => {
  it('replaces the end condition', () => {
    expect(withEnd('FREQ=WEEKLY;COUNT=10;BYDAY=MO', { until: '2026-05-31' })).toBe(
      'FREQ=WEEKLY;BYDAY=MO;UNTIL=20260531',
    );
    expect(withEnd('FREQ=DAILY;UNTIL=20260101', { count: 4 })).toBe('FREQ=DAILY;COUNT=4');
    expect(withEnd('FREQ=DAILY;COUNT=2', {})).toBe('FREQ=DAILY');
    expect(ruleCount('FREQ=DAILY;COUNT=7')).toBe(7);
  });
});
