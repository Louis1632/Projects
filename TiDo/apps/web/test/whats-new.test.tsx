import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { releases } from '../src/features/about/releases';
import { buildInfo } from '../src/features/about/version';
import { makeDashboard, mockApi, user } from './fixtures';
import { renderApp } from './render';

const signedIn = (extra: Parameters<typeof mockApi>[0] = {}) =>
  mockApi({
    'GET /auth/me': () => ({ body: user }),
    'GET /dashboard': () => ({ body: makeDashboard([]) }),
    ...extra,
  });

describe('release notes', () => {
  it('start with the version in the workspace package.json', () => {
    const { version } = JSON.parse(
      readFileSync(resolve(process.cwd(), '../../package.json'), 'utf8'),
    ) as { version: string };
    expect(buildInfo.version).toBe(version);
    expect(releases[0]?.version).toBe(version);
  });

  it('are newest first, with unique versions', () => {
    const versions = releases.map((release) => release.version);
    expect(new Set(versions).size).toBe(versions.length);
    const dates = releases.map((release) => release.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe("what's new", () => {
  beforeEach(() => localStorage.clear());

  it('shows the running version and its release notes', async () => {
    signedIn();
    renderApp('/whats-new');
    expect(await screen.findByRole('heading', { name: "What's new" })).toBeInTheDocument();
    expect(screen.getByText(`TiDo ${buildInfo.version}`)).toBeInTheDocument();
    const current = screen.getAllByRole('article')[0]!;
    expect(
      within(current).getByRole('heading', { name: `Version ${releases[0]!.version}` }),
    ).toBeInTheDocument();
    expect(within(current).getByText("You're on this version")).toBeInTheDocument();
    expect(within(current).getAllByRole('listitem')).toHaveLength(releases[0]!.changes.length);
  });

  it('marks a version you have not seen yet until you open the page', async () => {
    localStorage.setItem('tido.seenVersion', '0.0.1');
    signedIn();
    renderApp('/tasks');
    const link = await screen.findByRole('link', { name: `TiDo v${buildInfo.version} New` });
    await userEvent.click(link);
    expect(await screen.findByRole('heading', { name: "What's new" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `TiDo v${buildInfo.version}` })).toBeInTheDocument();
    expect(localStorage.getItem('tido.seenVersion')).toBe(buildInfo.version);
  });

  it('does not badge the version someone started on', async () => {
    signedIn();
    renderApp('/tasks');
    expect(
      await screen.findByRole('link', { name: `TiDo v${buildInfo.version}` }),
    ).toBeInTheDocument();
    expect(localStorage.getItem('tido.seenVersion')).toBe(buildInfo.version);
  });

  it('offers a reload when a newer build is deployed', async () => {
    signedIn({ 'GET /version.json': () => ({ body: { ...buildInfo, revision: 'newer' } }) });
    renderApp('/tasks');
    expect(await screen.findByText('A new version of TiDo is available.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('stays quiet while the deployed build matches', async () => {
    const calls = signedIn({ 'GET /version.json': () => ({ body: buildInfo }) });
    renderApp('/tasks');
    await screen.findByRole('link', { name: `TiDo v${buildInfo.version}` });
    await vi.waitFor(() => expect(calls.some((call) => call.path === '/version.json')).toBe(true));
    expect(screen.queryByText('A new version of TiDo is available.')).not.toBeInTheDocument();
  });
});
