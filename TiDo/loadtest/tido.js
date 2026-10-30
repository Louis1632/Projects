// TiDo load test (k6). One script, several shapes of load, chosen with MODE. All settings come
// from environment variables that deploy/scripts/loadtest.sh fills in from its flags; the
// defaults below let you also run it straight against local dev. See docs/runbooks/load-testing.md.
//
//   MODE=browse    (default) signed-in people opening the app and editing tasks: a realistic mix
//   MODE=login     repeated sign-ins — each one hashes a password, so this is the clearest way to
//                  drive CPU up and watch the API autoscale
//   MODE=register  invite + accept, over and over: the account-creation path (also hashes)
//   MODE=api       read-heavy API calls (dashboard, calendar, task lists)
//   MODE=security  one pass of the authorization checks in security.js
import { check, group, sleep } from 'k6';
import exec from 'k6/execution';
import { Client, expecting, fakeAddress, linkToken } from './api.js';
import { securityChecks } from './security.js';

const MODE = __ENV.MODE || 'browse';
const USER_PASSWORD = __ENV.USER_PASSWORD || 'Loadtest-12345!';
const USERS = Number(__ENV.USERS || 20); // size of the reusable sign-in pool
const OWNER_EMAIL = __ENV.OWNER_EMAIL;
const OWNER_PASSWORD = __ENV.OWNER_PASSWORD;

const num = (name, fallback) => Number(__ENV[name] || fallback);

function scenario() {
  const duration = __ENV.DURATION || '2m';
  const common = { exec: 'run', gracefulStop: '30s' };
  if (MODE === 'security') {
    return { run: { ...common, executor: 'per-vu-iterations', vus: 1, iterations: 1 } };
  }
  if (MODE === 'browse') {
    // People arrive over time, stay, and click around.
    return {
      run: {
        ...common,
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: __ENV.RAMP || '30s', target: num('VUS', 50) },
          { duration, target: num('VUS', 50) },
          { duration: '20s', target: 0 },
        ],
      },
    };
  }
  // login / register / api: hold a steady request rate, whatever the latency, so the autoscaler
  // has a fixed amount of work to keep up with.
  return {
    run: {
      ...common,
      executor: 'constant-arrival-rate',
      rate: num('RATE', 30),
      timeUnit: '1s',
      duration,
      preAllocatedVUs: num('PREALLOCATED_VUS', 20),
      maxVUs: num('MAX_VUS', 200),
    },
  };
}

export const options = {
  scenarios: scenario(),
  thresholds: {
    // Requests the test expects to be rejected (401/403) are tagged expected_response:false by
    // their callback and don't count here, so this is the rate of genuine failures.
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: false }],
    http_req_duration: ['p(95)<2000'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'max'],
};

// ---- setup: sign in as the owner, make a workspace to work in, and a pool of members ----------

export function setup() {
  if (!OWNER_EMAIL || !OWNER_PASSWORD) {
    throw new Error('Set OWNER_EMAIL and OWNER_PASSWORD (loadtest.sh does this from a secret).');
  }
  const owner = new Client(fakeAddress(1));
  const login = owner.login(OWNER_EMAIL, OWNER_PASSWORD, { expect: expecting(200) });
  if (login.status !== 200) throw new Error(`owner sign-in failed: ${login.status} ${login.body}`);

  const stamp = `${Date.now().toString(36)}`;
  const project = owner
    .post(
      '/projects',
      { name: `Load test ${stamp}`, color: '#2f80ed' },
      { name: 'POST /projects', expect: expecting(201) },
    )
    .json();
  const section = owner
    .post(
      `/projects/${project.id}/sections`,
      { name: 'Inbox' },
      { name: 'POST /projects/:id/sections', expect: expecting(201) },
    )
    .json();

  // A pool of ordinary members the sign-in scenarios reuse. Invite (owner), then accept (sets a
  // password) as that new person — this is exactly the account-creation path.
  const users = [];
  for (let i = 0; i < USERS; i += 1) {
    const email = `loaduser-${stamp}-${i}@loadtest.invalid`;
    const invite = owner.post(
      '/members/invites',
      { email, displayName: `Load user ${i}`, role: 'member' },
      { name: 'POST /members/invites', expect: expecting(201) },
    );
    if (invite.status !== 201) continue;
    const token = linkToken(invite.json('link.url'));
    const accept = new Client(fakeAddress(1000 + i)).post(
      '/auth/tokens/accept',
      { token, password: USER_PASSWORD, displayName: `Load user ${i}` },
      { name: 'POST /auth/tokens/accept', expect: expecting(200) },
    );
    if (accept.status === 200) users.push({ email });
  }
  if (!users.length) throw new Error('could not create any load-test members');

  return {
    owner: { address: owner.address, session: owner.session },
    project: { id: project.id },
    section: { id: section.id },
    users,
    member: users[0],
    password: USER_PASSWORD,
  };
}

// ---- the per-iteration work, by MODE ----------------------------------------------------------

// Each VU keeps one signed-in client across its iterations (browse/api), so it signs in once.
let vuClient = null;
let registerCounter = 0;

function userFor(data, index) {
  return data.users[index % data.users.length];
}

function signedInClient(data) {
  if (vuClient) return vuClient;
  const user = userFor(data, exec.vu.idInTest);
  vuClient = new Client(fakeAddress(exec.vu.idInTest));
  vuClient.login(user.email, data.password, { name: 'POST /auth/login', expect: expecting(200) });
  return vuClient;
}

function doLogin(data) {
  const user = userFor(data, exec.scenario.iterationInTest);
  const client = new Client(fakeAddress(exec.vu.idInTest));
  const res = client.login(user.email, data.password, { expect: expecting(200) });
  check(res, { 'sign-in succeeds': (r) => r.status === 200 });
  if (res.status === 200) client.get('/auth/me', { name: 'GET /auth/me' });
}

function doRegister(data) {
  registerCounter += 1;
  const email = `reg-${exec.vu.idInTest}-${registerCounter}-${Date.now().toString(36)}@loadtest.invalid`;
  const owner = new Client(fakeAddress(1));
  owner.session = data.owner.session; // the owner session minted in setup, reused to invite
  const invite = owner.post(
    '/members/invites',
    { email, displayName: 'Reg user', role: 'member' },
    { name: 'POST /members/invites', expect: expecting(201) },
  );
  if (invite.status !== 201) return;
  const token = linkToken(invite.json('link.url'));
  const accept = new Client(fakeAddress(2_000_000 + registerCounter)).post(
    '/auth/tokens/accept',
    { token, password: data.password, displayName: 'Reg user' },
    { name: 'POST /auth/tokens/accept', expect: expecting(200) },
  );
  check(accept, { 'account created': (r) => r.status === 200 });
}

function doApi(data) {
  const client = signedInClient(data);
  client.get('/dashboard', { name: 'GET /dashboard' });
  client.get('/tasks', { name: 'GET /tasks' });
  const from = '2026-01-01';
  const to = '2026-12-31';
  client.get(`/calendar?from=${from}&to=${to}`, { name: 'GET /calendar' });
}

function doBrowse(data) {
  const client = signedInClient(data);
  group('open the app', () => {
    client.openApp();
    client.get('/dashboard', { name: 'GET /dashboard' });
  });
  // A short think-time, then a few edits — most sessions read more than they write.
  sleep(Math.random() * 2 + 1);
  group('edit tasks', () => {
    const created = client.post(
      '/tasks',
      { sectionId: data.section.id, title: `Task ${Date.now()}` },
      { name: 'POST /tasks', expect: expecting(201) },
    );
    if (created.status !== 201) return;
    const task = created.json();
    client.patch(
      `/tasks/${task.id}`,
      { title: `${task.title} (edited)`, revision: task.revision },
      { name: 'PATCH /tasks/:id' },
    );
    client.post(
      `/tasks/${task.id}/completion`,
      { completed: true },
      { name: 'POST /tasks/:id/completion' },
    );
    if (Math.random() < 0.3) {
      client.del(`/tasks/${task.id}`, { name: 'DELETE /tasks/:id', expect: expecting(200) });
    }
  });
  sleep(Math.random() * 2 + 1);
}

export function run(data) {
  switch (MODE) {
    case 'login':
      return doLogin(data);
    case 'register':
      return doRegister(data);
    case 'api':
      return doApi(data);
    case 'security':
      return securityChecks(data);
    default:
      return doBrowse(data);
  }
}

export function teardown(data) {
  // Archive the load-test list so repeated runs in the same namespace stay tidy. (The namespace
  // is thrown away by `loadtest.sh down` anyway, so a failure here doesn't matter.)
  const owner = new Client(data.owner.address);
  owner.session = data.owner.session;
  const dashboard = owner.get('/dashboard', { name: 'GET /dashboard' });
  if (dashboard.status !== 200) return;
  const project = (dashboard.json('projects') || []).find((p) => p.id === data.project.id);
  if (!project) return;
  owner.patch(
    `/projects/${data.project.id}`,
    { archived: true, revision: project.revision },
    { name: 'PATCH /projects/:id', expect: expecting(200, 409) },
  );
}
