// Authorization checks: confirm TiDo still refuses what it should while it is under load. These
// only verify the app's existing defences hold; none of them tries to guess a credential. Each
// is a k6 check, so the end-of-run summary lists every one as passed (✓) or failed (✗).
import { check, group } from 'k6';
import { Client, expecting, fakeAddress } from './api.js';

export function securityChecks(data) {
  group('signed out is refused', () => {
    const anon = new Client(fakeAddress(60001));
    const dashboard = anon.get('/dashboard', { name: 'GET /dashboard', expect: expecting(401) });
    const tasks = anon.get('/tasks', { name: 'GET /tasks', expect: expecting(401) });
    check(dashboard, { 'GET /dashboard without a session → 401': (r) => r.status === 401 });
    check(tasks, { 'GET /tasks without a session → 401': (r) => r.status === 401 });
  });

  group('CSRF header is required', () => {
    // A valid signed-in session, but the state-changing request omits the custom header.
    const member = new Client(fakeAddress(60002));
    member.login(data.member.email, data.password);
    const res = member.post(
      '/projects',
      { name: 'csrf-probe' },
      { name: 'POST /projects (no CSRF header)', csrf: false, expect: expecting(403) },
    );
    check(res, { 'POST without X-CSRF-Request → 403': (r) => r.status === 403 });
  });

  group('cross-origin is refused', () => {
    const member = new Client(fakeAddress(60003));
    member.login(data.member.email, data.password);
    const res = member.post(
      '/projects',
      { name: 'origin-probe' },
      {
        name: 'POST /projects (foreign Origin)',
        headers: { Origin: 'https://evil.invalid' },
        expect: expecting(403),
      },
    );
    check(res, { 'POST with a foreign Origin → 403': (r) => r.status === 403 });
  });

  group('owner-only actions refuse a member', () => {
    const member = new Client(fakeAddress(60004));
    member.login(data.member.email, data.password);
    // A member (not an owner) may not invite people.
    const res = member.post(
      '/members/invites',
      { email: 'nope@loadtest.invalid', displayName: 'Nope', role: 'member' },
      { name: 'POST /members/invites (as member)', expect: expecting(403) },
    );
    check(res, { 'member inviting someone → 403': (r) => r.status === 403 });
  });
}
