import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_PASSWORD ?? 'harbour-lantern-violet-42';

async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

test('an agent creates a contact; emails and a UK phone are saved normalised and shown UK-style', async ({ page }) => {
  const name = `E2E Contact ${Date.now()}`;
  await login(page, 'agent@relaydesk.local');
  await page.goto('/crm/contacts/new');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email addresses 1').fill('  E2E.Person@Example.COM ');
  await page.getByRole('button', { name: '+ Add email' }).click();
  await page.getByLabel('Email addresses 2').fill('E2E@Work.Example');
  await page.getByRole('button', { name: '+ Add phone' }).click();
  await page.getByLabel('Phone numbers 1').fill('07400123456');
  await page.getByLabel('Individual').check();
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByLabel('Email addresses 1')).toHaveValue('e2e.person@example.com');
  await expect(page.getByLabel('Email addresses 2')).toHaveValue('e2e@work.example');
  await expect(page.getByLabel('Phone numbers 1')).toHaveValue('07400 123456');

  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('Created')).toBeVisible();
});

test('dynamic visibility: VAT number only shows for business customers', async ({ page }) => {
  await login(page, 'agent@relaydesk.local');
  await page.goto('/crm/contacts/new');
  await expect(page.getByLabel('VAT number')).toHaveCount(0);
  await page.getByLabel('Business').check();
  await expect(page.getByLabel('VAT number')).toBeVisible();
});

test('an agent cannot find contacts in a CRM database outside their rights', async ({ page }) => {
  await login(page, 'agent@relaydesk.local');
  await page.goto('/crm/contacts');
  await page.getByRole('textbox', { name: 'Search…' }).fill('Pat Partner');
  await expect(page.getByText('No results')).toBeVisible();
  await page.getByRole('textbox', { name: /Search tickets/ }).fill('globex');
  await expect(page.getByText('No results')).toHaveCount(2);
});

test('an administrator sees both databases and the partner contact', async ({ page }) => {
  await login(page, 'admin@relaydesk.local');
  await page.goto('/crm/contacts');
  await page.getByRole('textbox', { name: 'Search…' }).fill('Pat Partner');
  await expect(page.getByRole('cell', { name: 'Pat Partner' })).toBeVisible();
});
