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
    version: '0.7.0',
    date: '2026-10-30',
    summary: 'More room for your tasks, especially on a phone.',
    changes: [
      {
        kind: 'new',
        text: 'Tasks are marked like work: a cross while still to do, and a tick once done.',
      },
      {
        kind: 'new',
        text: 'Once a task and all its subtasks are ticked off, it is archived from the list. It stays on the calendar, and Undo brings it straight back.',
      },
      {
        kind: 'improved',
        text: 'On a phone, one section fills the screen. Swipe sideways for the next one.',
      },
      {
        kind: 'improved',
        text: 'Hide the menu with ‹ and bring it back with ☰. On a phone the menu slides in from the left.',
      },
      {
        kind: 'improved',
        text: 'Filters fold away behind a Filters button, which shows how many are on.',
      },
      {
        kind: 'improved',
        text: 'List names are centred on the All tasks page.',
      },
      {
        kind: 'improved',
        text: 'Sign out now lives in the menu that opens when you tap your name.',
      },
      {
        kind: 'improved',
        text: 'The search box and New task button are gone. Add tasks from a section, or from a day on the calendar.',
      },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-10-30',
    summary: 'Install TiDo as an app, with a new icon and a calmer look.',
    changes: [
      {
        kind: 'new',
        text: 'On Android, open TiDo in Chrome and choose Install app from the menu. TiDo gets its own icon and opens in its own window.',
      },
      {
        kind: 'improved',
        text: 'A new blue-grey colour, matching the new TiDo icon.',
      },
    ],
  },
  {
    version: '0.5.1',
    date: '2026-10-30',
    summary: 'A friendlier empty list.',
    changes: [
      {
        kind: 'improved',
        text: 'Empty sections now invite you to add your first task.',
      },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-10-30',
    summary: 'A fresh blue look, with a light and dark theme you can choose.',
    changes: [
      {
        kind: 'new',
        text: 'Choose Light, Dark or System at the bottom of the sidebar. System follows your device, and each device remembers its own choice.',
      },
      {
        kind: 'improved',
        text: 'Blue now marks what matters: buttons, links, the selected list, column headers and the task under your pointer.',
      },
      {
        kind: 'improved',
        text: 'Softer neutral backgrounds and slightly tighter rounded corners.',
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-10-30',
    summary: 'Add tasks quickly, one after another, straight from a column.',
    changes: [
      {
        kind: 'improved',
        text: '“+ Add task” opens a field in the column: type a task, press Enter, and type the next. Open a task afterwards to add a due date or other details.',
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-10-30',
    summary: 'Name your sections, add subtasks in place, and a tidier board.',
    changes: [
      { kind: 'new', text: 'Rename any section, including the first one, by clicking its name.' },
      { kind: 'new', text: 'Add a subtask straight from a task with “+ Subtask”.' },
      { kind: 'improved', text: 'Add a section with the + after the last column.' },
      {
        kind: 'improved',
        text: 'Archive a list from the archive button next to its name in the sidebar.',
      },
      {
        kind: 'improved',
        text: 'Section names are centred, and subtasks are separated by lines.',
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-10-29',
    summary: 'Sections of a list now sit side by side as columns you can rearrange.',
    changes: [
      {
        kind: 'improved',
        text: 'Each section is a column. Drag a section by its name, or use the arrows, to reorder them.',
      },
      {
        kind: 'new',
        text: 'Drag a task onto another task or into another column to move it there.',
      },
    ],
  },
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
