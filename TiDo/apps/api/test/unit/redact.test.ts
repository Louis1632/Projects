import { describe, expect, it } from 'vitest';
import { redactUrl } from '../../src/lib/redact';

describe('redactUrl', () => {
  it('hides tokens but keeps ids readable', () => {
    const token = 'a'.repeat(21) + '-_' + 'B9'.repeat(10);
    expect(redactUrl(`/invite/${token}?x=1`)).toBe('/invite/[redacted]?x=1');
    const id = '00000000-0000-4000-8000-000000000002';
    expect(redactUrl(`/api/v1/tasks/${id}`)).toBe(`/api/v1/tasks/${id}`);
  });
});
