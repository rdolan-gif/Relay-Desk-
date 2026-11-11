import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_PASSWORD ?? 'harbour-lantern-violet-42';

async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

test('import contacts from a CSV, then erase one of them (right to erasure)', async ({ page }) => {
  await login(page, 'admin@relaydesk.local');
  const stamp = Date.now();
  const name = `Erin Erasable ${stamp}`;
  await page.goto('/crm/contacts');
  await page.getByRole('button', { name: 'Import' }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'people.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`Full name,E-mail,Customer type\n${name},erin.${stamp}@example.com,individual\n`),
  });
  await expect(page.getByRole('textbox', { name: 'Relay Desk field: Full name' })).toHaveValue('Name');
  await page.getByRole('button', { name: 'Import', exact: true }).last().click();
  await expect(page.getByRole('dialog').getByText(/created: 1/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Close' }).click();

  await page.goto('/crm/contacts');
  await page.getByPlaceholder('Search…').fill(`Erasable ${stamp}`);
  await page.getByText(name).click();
  await page.getByRole('button', { name: 'Erase (right to erasure)…' }).click();
  await page.getByLabel('Type ERASE to confirm').fill('ERASE');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('dialog').getByText(/^Finished/)).toBeVisible({ timeout: 15_000 });
});

test('export the contact list as CSV with the visible columns', async ({ page }) => {
  await login(page, 'admin@relaydesk.local');
  await page.goto('/crm/contacts');
  await page.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Export as CSV' }).click(),
  ]);
  const text = readFileSync((await download.path())!, 'utf8');
  expect(text.split('\r\n')[0]).toContain('Name');
});

test('a deleted ticket can be restored by an administrator', async ({ page }) => {
  await login(page, 'admin@relaydesk.local');
  const title = `E2E delete ${Date.now()}`;
  await page.goto('/tickets/new');
  await page.getByLabel('Title').fill(title);
  await page.getByRole('textbox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'Support' }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const id = page.url().split('/').pop()!;

  await page.goto('/tickets');
  await page.getByPlaceholder('Search…').fill(title);
  // Wait for the search to settle: ticking a row while the list is still refreshing is undone.
  await expect(page.getByRole('row')).toHaveCount(2); // header + this ticket
  await page.getByLabel(`Select ${id}`).check();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('1 deleted.')).toBeVisible();

  await page.goto('/settings/deleted');
  const row = page.getByRole('row', { name: new RegExp(title) });
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Restored.')).toBeVisible();
  await page.goto(`/tickets/${id}`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});
