import { describe, expect, it } from 'vitest';
import { monthGrid, shiftMonth } from '../src/lib/dates';
import {
  describeRule,
  draftToRule,
  emptyDraft,
  previewDates,
  ruleToDraft,
} from '../src/lib/recurrence';

const anchor = '2026-01-30'; // a Friday, the last Friday of January

describe('draftToRule', () => {
  it('builds rules for each preset', () => {
    const base = emptyDraft(anchor);
    expect(draftToRule(base, anchor)).toBeNull();
    expect(draftToRule({ ...base, preset: 'daily', interval: 2 }, anchor)).toBe(
      'FREQ=DAILY;INTERVAL=2',
    );
    expect(draftToRule({ ...base, preset: 'weekly' }, anchor)).toBe('FREQ=WEEKLY;BYDAY=FR');
    expect(draftToRule({ ...base, preset: 'weekly', weekdays: ['MO', 'TH'] }, anchor)).toBe(
      'FREQ=WEEKLY;BYDAY=MO,TH',
    );
    expect(draftToRule({ ...base, preset: 'monthly-date' }, anchor)).toBe(
      'FREQ=MONTHLY;BYMONTHDAY=30',
    );
    expect(draftToRule({ ...base, preset: 'monthly-last' }, anchor)).toBe(
      'FREQ=MONTHLY;BYMONTHDAY=-1',
    );
    expect(draftToRule({ ...base, preset: 'monthly-nth' }, anchor)).toBe('FREQ=MONTHLY;BYDAY=-1FR');
    expect(draftToRule({ ...base, preset: 'monthly-nth' }, '2026-01-09')).toBe(
      'FREQ=MONTHLY;BYDAY=2FR',
    );
    expect(draftToRule({ ...base, preset: 'yearly', end: 'count', count: 3 }, anchor)).toBe(
      'FREQ=YEARLY;COUNT=3',
    );
    expect(
      draftToRule({ ...base, preset: 'daily', end: 'until', until: '2026-03-01' }, anchor),
    ).toBe('FREQ=DAILY;UNTIL=20260301');
  });

  it('round-trips rules back into the matching preset', () => {
    for (const rule of [
      'FREQ=DAILY',
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR',
      'FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=6',
    ]) {
      const draft = ruleToDraft(rule, anchor);
      expect(draft.preset).not.toBe('custom');
      expect(draftToRule(draft, anchor)).toBe(rule);
    }
    expect(ruleToDraft('FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU,WE,TH,FR', anchor).preset).toBe(
      'custom',
    );
  });
});

describe('describe and preview', () => {
  it('summarises rules in words and previews upcoming dates', () => {
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO,FR', anchor)).toBe('every week on Monday, Friday');
    expect(previewDates('FREQ=MONTHLY;BYMONTHDAY=-1', anchor, 3)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
    expect(previewDates('not a rule', anchor)).toEqual([]);
  });
});

describe('month grid', () => {
  it('starts on Monday and spans six weeks', () => {
    const grid = monthGrid('2026-02-01');
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-01-26');
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-01');
  });
});
