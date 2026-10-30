// A small TiDo client for k6: one signed-in person, talking to the API the way the web app does.
import http from 'k6/http';

const API = `${__ENV.API_URL || 'http://localhost:3000'}/api/v1`;
const WEB = __ENV.WEB_URL || 'http://localhost:5173';
const COOKIE = __ENV.SESSION_COOKIE || '__Host-tido_session';

/** Requests that should fail (401, 403, 429, …) pass this so k6 doesn't count them as errors. */
export function expecting(...statuses) {
  return http.expectedStatuses(...statuses);
}

/**
 * A stable made-up client address per simulated person. The API trusts one proxy hop and the
 * load generator is that hop, so per-address rate limits apply per person, as with real users.
 */
export function fakeAddress(n) {
  return `10.${100 + (Math.floor(n / 65536) % 100)}.${Math.floor(n / 256) % 256}.${n % 256}`;
}

export class Client {
  constructor(address) {
    this.address = address;
    this.session = null;
  }

  headers(method, { extra = {}, csrf = true } = {}) {
    const headers = { 'X-Forwarded-For': this.address, ...extra };
    if (this.session) headers.Cookie = `${COOKIE}=${this.session}`;
    // The API's CSRF check: every state-changing request carries this header. The authorization
    // checks in security.js set csrf:false on purpose, to confirm the API still refuses.
    if (method !== 'GET' && csrf) headers['X-CSRF-Request'] = '1';
    return headers;
  }

  /** `name` groups URLs with IDs in them (e.g. "GET /tasks/:id") in k6's results. */
  request(method, path, body, { name, expect, headers, csrf } = {}) {
    const params = {
      headers: this.headers(method, { extra: headers, csrf }),
      tags: { name: name || `${method} ${path}` },
      // A fresh jar each time: the session cookie is sent only by hand, above.
      jar: new http.CookieJar(),
    };
    if (body !== undefined) params.headers['Content-Type'] = 'application/json';
    if (expect) params.responseCallback = expect;
    const payload = body === undefined ? null : JSON.stringify(body);
    const res = http.request(method, `${API}${path}`, payload, params);
    const cookie = res.cookies[COOKIE];
    if (cookie && cookie.length) this.session = cookie[0].value || null;
    return res;
  }

  get(path, options) {
    return this.request('GET', path, undefined, options);
  }

  post(path, body = {}, options) {
    return this.request('POST', path, body, options);
  }

  patch(path, body, options) {
    return this.request('PATCH', path, body, options);
  }

  del(path, options) {
    return this.request('DELETE', path, undefined, options);
  }

  login(email, password, options) {
    return this.post('/auth/login', { email, password }, { name: 'POST /auth/login', ...options });
  }

  logout() {
    const res = this.post('/auth/logout', {}, { name: 'POST /auth/logout' });
    this.session = null;
    return res;
  }

  /** Opening the app in a browser: the page, its scripts and styles, then who's signed in. */
  openApp() {
    const page = http.get(`${WEB}/`, { tags: { name: 'GET web /' } });
    const assets = [...String(page.body).matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
      (match) => ['GET', `${WEB}${match[1]}`, null, { tags: { name: 'GET web /assets/*' } }],
    );
    if (assets.length) http.batch(assets);
    http.get(`${WEB}/version.json`, { tags: { name: 'GET web /version.json' } });
    return this.get('/auth/me', { name: 'GET /auth/me' });
  }
}

/** The token at the end of an invite or reset link (https://…/invite/<token>). */
export function linkToken(url) {
  return url.split('/').pop();
}
