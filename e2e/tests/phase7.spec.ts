import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_PASSWORD ?? 'harbour-lantern-violet-42';

async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

test('an agent finds a knowledge-base article from the reply editor and inserts it; restricted articles are not offered', async ({
  page,
}) => {
  await login(page, 'agent@relaydesk.local');
  await page.goto('/email/new');
  await page.getByRole('button', { name: 'Knowledge base' }).click();
  await page.getByLabel('Search articles…').fill('margins');
  await expect(page.getByText('No articles here yet.')).toBeVisible();
  await page.getByLabel('Search articles…').fill('LED');
  await page.getByRole('button', { name: 'Insert text: LED panels: common questions' }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toContainText('3000K');
});

test('an administrator writes an article, edits it and sees both versions', async ({ page }) => {
  await login(page, 'admin@relaydesk.local');
  const title = `E2E article ${Date.now()}`;
  await page.goto('/kb');
  await expect(page.getByText('Management only')).toBeVisible();
  await page.getByText('Products').first().click();
  await page.getByRole('button', { name: 'New article' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByRole('textbox', { name: 'Article' }).click();
  await page.keyboard.type('First version.');
  await page.getByRole('button', { name: 'Save article' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Article' }).click();
  await page.keyboard.type(' Second version.');
  await page.getByRole('button', { name: 'Save article' }).click();
  await expect(page.getByText(/Version 2 ·/)).toBeVisible();
  await page.getByRole('button', { name: 'Version history' }).click();
  await expect(page.getByText('Version 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore this version' })).toBeVisible();
});

test('the reporting page shows headline figures, charts and the inbound heatmap', async ({ page }) => {
  await login(page, 'admin@relaydesk.local');
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reporting' })).toBeVisible();
  await expect(page.getByText('Tickets created').first()).toBeVisible();
  await expect(page.getByText('Created and closed per day')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Emails received by weekday and hour' })).toBeVisible();
  await page.getByRole('button', { name: 'Tickets created: show tickets' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
