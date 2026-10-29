/**
 * Release notes shown on the What's new page, newest first. Write them for the people using
 * TiDo, not for developers. The first entry must match the version in the workspace
 * package.json (a unit test checks this), so bump both together.
 */

export type ChangeKind = 'new' | 'improved' | 'fixed';

export interface Release {
  version: string;
  /** Release day, YYYY-MM-DD. */
  date: string;
  summary: string;
  changes: { kind: ChangeKind; text: string }[];
}

export const releases: Release[] = [
  {
    version: '0.1.1',
    date: '2026-10-29',
    summary: 'Security improvements. You will need to sign in again once after this update.',
    changes: [
      {
        kind: 'improved',
        text: 'Sign-in links and sessions are better protected. Everyone is signed out once.',
      },
      {
        kind: 'improved',
        text: 'Too many wrong guesses of your current password now pause password changes for a while.',
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-10-29',
    summary: 'The first release of TiDo, a shared task list for your household or team.',
    changes: [
      { kind: 'new', text: 'Shared lists with sections, tasks and one level of subtasks.' },
      { kind: 'new', text: 'Labels, assignees, due dates and a history of completed tasks.' },
      { kind: 'new', text: 'Search and filters across every list.' },
      { kind: 'new', text: 'A month calendar with an upcoming agenda.' },
      {
        kind: 'new',
        text: 'Repeating tasks on any schedule. Change one occurrence, this and later ones, or all of them.',
      },
      {
        kind: 'new',
        text: 'Invite people with single-use links. Owners manage roles and password resets.',
      },
      {
        kind: 'new',
        text: 'This page, the version in the sidebar, and a prompt to reload when a new version is out.',
      },
    ],
  },
];
