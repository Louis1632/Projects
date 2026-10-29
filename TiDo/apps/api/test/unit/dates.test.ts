import { describe, expect, it } from 'vitest';
import { addDays, todayIn } from '../../src/lib/dates';

describe('dates', () => {
  it('computes today in the workspace time zone', () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Johannesburg (UTC+2).
    expect(todayIn('Africa/Johannesburg', new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(todayIn('UTC', new Date('2026-12-31T23:30:00Z'))).toBe('2026-12-31');
  });

  it('adds days across month and leap-year boundaries', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});
