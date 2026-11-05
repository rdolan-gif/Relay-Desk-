import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_PASSWORD ?? 'harbour-lantern-violet-42';

async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

test('a Support ticket shows its SLA icon with the first-reply target', async ({ page }) => {
  await login(page, 'agent@relaydesk.local');
  const title = `E2E SLA ${Date.now()}`;
  await page.goto('/tickets/new');
  await page.getByLabel('Title').fill(title);
  await page.getByRole('textbox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'Support' }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByRole('img', { name: /First reply due/ })).toBeVisible();
});

test('an agent can mark themselves Ready for email', async ({ page }) => {
  await login(page, 'agent@relaydesk.local');
  await page.getByRole('button', { name: 'Ready for email' }).click();
  const box = page.getByRole('checkbox', { name: /support@relaydesk.local/ });
  // Ready stays on between sessions (owner O-16), so start from "not ready".
  if (await box.isChecked()) {
    await box.click();
    await expect(box).not.toBeChecked();
  }
  await box.click();
  await expect(box).toBeChecked();
  await expect(page.getByRole('button', { name: 'Ready for email' })).toHaveText(/^Ready/);
  await box.click();
  await expect(box).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Ready for email' })).toHaveText('Not ready');
});

test('an administrator sees SLAs and working hours, with bank holidays', async ({ page }) => {
  await login(page, 'admin@relaydesk.local');
  await page.goto('/settings/slas');
  await expect(page.getByRole('heading', { name: 'SLAs' })).toBeVisible();
  await page.getByText('Standard support (demo)').click();
  await expect(page.getByLabel('Response: High')).toHaveValue('1');
  await page.goto('/settings/working-hours');
  await page.getByText('Office hours (demo)').click();
  await expect(page.getByLabel('Reason').first()).toBeVisible();
  await expect(page.locator('input[value="Christmas Day"]').first()).toBeVisible();
});
