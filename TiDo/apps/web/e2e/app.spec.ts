import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { setupFile } from './global-setup';

const OWNER_PASSWORD = 'owner passphrase for tests';
const MEMBER_PASSWORD = 'member passphrase for tests';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'All tasks' })).toBeVisible();
}

async function createTask(
  page: Page,
  title: string,
  configure?: (dialog: ReturnType<Page['getByRole']>) => Promise<void>,
) {
  await page.getByRole('button', { name: '+ New task' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill(title);
  if (configure) await configure(dialog);
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(dialog).toBeHidden();
}

test('unauthenticated visitors are sent to sign in', async ({ page }) => {
  await page.goto('/calendar');
  await expect(page).toHaveURL(/\/login$/);
  const response = await page.request.get('/api/v1/dashboard');
  expect(response.status()).toBe(401);
});

test('owner completes setup and organises tasks', async ({ page }) => {
  const { ownerSetupUrl } = JSON.parse(readFileSync(setupFile, 'utf8')) as {
    ownerSetupUrl: string;
  };
  await page.goto(new URL(ownerSetupUrl).pathname);
  await expect(page.getByRole('heading', { name: 'Join your workspace' })).toBeVisible();
  await page.getByLabel('New password').fill(OWNER_PASSWORD);
  await page.getByLabel('Confirm password').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByRole('heading', { name: 'All tasks' })).toBeVisible();

  await page.getByPlaceholder('+ New list').fill('House');
  await page.getByPlaceholder('+ New list').press('Enter');
  await expect(page.getByRole('heading', { name: 'House', level: 1 })).toBeVisible();

  await createTask(page, 'Clean the garage', async (dialog) => {
    await dialog.getByLabel('Priority').selectOption('high');
    await dialog.getByPlaceholder('Add a subtask').fill('Sort boxes');
    await dialog.getByRole('button', { name: 'Add', exact: true }).last().click();
  });
  const row = page.getByTestId('task-row').filter({ hasText: 'Clean the garage' });
  await expect(row.getByText('Sort boxes')).toBeVisible();

  await row.getByRole('button', { name: 'Complete Sort boxes' }).click();
  await expect(row.getByText('☑ 1/1')).toBeVisible();
  await row.getByRole('button', { name: 'Complete Clean the garage' }).click();
  await expect(row).toHaveClass(/completed/);

  // The one-time setup link cannot be reused.
  await page.context().clearCookies();
  await page.goto(new URL(ownerSetupUrl).pathname);
  await expect(page.getByRole('heading', { name: 'Link unavailable' })).toBeVisible();
});

test('owner invites a member who co-edits shared tasks', async ({ page, browser }) => {
  await signIn(page, 'owner@example.test', OWNER_PASSWORD);
  await page.getByRole('link', { name: /People/ }).click();
  await page.getByLabel('Name').fill('Sam');
  await page.getByLabel('Email').fill('sam@example.test');
  await page.getByRole('button', { name: 'Create invite' }).click();
  const inviteUrl = (await page.locator('.invite-result code').textContent())!;

  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await member.goto(new URL(inviteUrl).pathname);
  await member.getByLabel('New password').fill(MEMBER_PASSWORD);
  await member.getByLabel('Confirm password').fill(MEMBER_PASSWORD);
  await member.getByRole('button', { name: 'Create my account' }).click();
  await expect(member.getByRole('heading', { name: 'All tasks' })).toBeVisible();

  // Members do not see owner controls, even by URL.
  await expect(member.getByRole('link', { name: /People/ })).toHaveCount(0);
  await member.goto('/people');
  await expect(member).toHaveURL(/\/tasks$/);
  const blocked = await member.request.post('/api/v1/members/invites', {
    data: { email: 'x@example.test', displayName: 'X' },
    headers: { 'x-csrf-request': '1' },
  });
  expect(blocked.status()).toBe(403);

  // The member edits the owner's task; the owner sees it.
  await member.getByText('Clean the garage').click();
  const dialog = member.getByRole('dialog');
  await dialog.getByLabel('Title').fill('Clean the garage properly');
  await dialog.getByLabel('Assign to').selectOption({ label: 'Sam' });
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('link', { name: /Tasks/ }).first().click();
  await page.reload();
  const row = page.getByTestId('task-row').filter({ hasText: 'Clean the garage properly' });
  await expect(row.getByText('◉ Sam')).toBeVisible();

  // Owner deactivates the member, which ends their session.
  await page.getByRole('link', { name: /People/ }).click();
  page.once('dialog', (confirm) => void confirm.accept());
  await page
    .locator('.member-row', { hasText: 'Sam' })
    .getByRole('button', { name: 'Deactivate' })
    .click();
  await expect(page.locator('.member-row', { hasText: 'Sam' }).getByText('Inactive')).toBeVisible();
  await member.reload();
  await expect(member).toHaveURL(/\/login$/);
  await memberContext.close();
});

test('recurring tasks appear on the calendar and can be handled per occurrence', async ({
  page,
}) => {
  await signIn(page, 'owner@example.test', OWNER_PASSWORD);
  await createTask(page, 'Feed the cat', async (dialog) => {
    await dialog.getByLabel('Repeat pattern').selectOption('daily');
    await expect(dialog.getByText(/Repeats every day/)).toBeVisible();
  });
  // The list shows only the next occurrence.
  await expect(page.getByTestId('task-row').filter({ hasText: 'Feed the cat' })).toHaveCount(1);

  await page.getByRole('link', { name: /Calendar/ }).click();
  const occurrences = page.locator('.calendar-task', { hasText: 'Feed the cat' });
  await expect(occurrences.first()).toBeVisible();
  const before = await occurrences.count();
  expect(before).toBeGreaterThan(1);

  // Edit only one occurrence.
  await occurrences.nth(1).click();
  let dialog = page.getByRole('dialog').first();
  await dialog.getByLabel('Title').fill('Feed the cat (vet day)');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Only this occurrence' }).click();
  await expect(page.locator('.calendar-task', { hasText: 'vet day' })).toHaveCount(1);

  // Skip another single occurrence.
  await page
    .locator('.calendar-task', { hasText: /^↻ Feed the cat$/ })
    .nth(2)
    .click();
  dialog = page.getByRole('dialog').first();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Only this occurrence' }).click();
  await expect(occurrences).toHaveCount(before - 1);
});

test('signing out ends the session', async ({ page }) => {
  await signIn(page, 'owner@example.test', OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/tasks');
  await expect(page).toHaveURL(/\/login$/);
});
