import { expect, test } from '@playwright/test';

const PASSWORD = process.env.SEED_PASSWORD ?? 'harbour-lantern-violet-42';

async function login(page: import('@playwright/test').Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('an administrator signs in and sees Settings > Users', async ({ page }) => {
  await login(page, 'admin@relaydesk.local');
  await expect(page.getByRole('heading', { name: /Welcome, Ada Admin/ })).toBeVisible();
  await page.getByRole('link', { name: 'Users' }).click();
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'agent@relaydesk.local' })).toBeVisible();
});

test('an agent signs in and has no Settings area', async ({ page }) => {
  await login(page, 'agent@relaydesk.local');
  await expect(page.getByRole('heading', { name: /Welcome, Alex Agent/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
  await page.goto('/settings/users');
  await expect(page.getByRole('cell', { name: 'admin@relaydesk.local' })).toHaveCount(0);
});

test('a wrong password shows an error', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('backoffice@relaydesk.local');
  await page.getByLabel('Password').fill('definitely-wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.');
});
