import { describe, expect, it } from 'vitest';
import { LoginThrottle } from '../../src/modules/auth/login-throttle';

describe('LoginThrottle', () => {
  it('blocks after the maximum failures within the window and recovers afterwards', () => {
    const throttle = new LoginThrottle(3, 1_000);
    for (let attempt = 0; attempt < 3; attempt += 1) throttle.recordFailure('a@example.test', 0);
    expect(throttle.isBlocked('a@example.test', 500)).toBe(true);
    expect(throttle.isBlocked('b@example.test', 500)).toBe(false);
    expect(throttle.isBlocked('a@example.test', 1_001)).toBe(false);
  });

  it('resets on success', () => {
    const throttle = new LoginThrottle(1, 1_000);
    throttle.recordFailure('a@example.test', 0);
    throttle.reset('a@example.test');
    expect(throttle.isBlocked('a@example.test', 1)).toBe(false);
  });
});
