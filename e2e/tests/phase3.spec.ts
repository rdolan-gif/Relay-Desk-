import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_PASSWORD ?? 'harbour-lantern-violet-42';

async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

test('a new email opens a ticket that shows the sent email, and a reply is added to it', async ({ page }) => {
  await login(page, 'agent@relaydesk.local');
  const subject = `E2E quote ${Date.now()}`;
  await page.goto('/tickets');
  await page.getByRole('button', { name: 'New email' }).click();
  await page.getByRole('textbox', { name: 'To' }).fill('buyer@example.com');
  await page.keyboard.press('Enter');
  await page.getByLabel('Subject').fill(subject);
  await page.locator('.ProseMirror p').first().click();
  await page.keyboard.type('Please find our prices attached. ');
  await page.getByRole('button', { name: /send email/i }).click();

  await expect(page.getByRole('heading', { name: subject })).toBeVisible();
  await expect(page.getByText('buyer@example.com').first()).toBeVisible();

  await page.getByRole('button', { name: 'Reply', exact: true }).first().click();
  await expect(page.getByLabel('Subject')).toHaveValue(new RegExp(`^Re: .*${subject}`));
  await page.getByRole('button', { name: /send email/i }).click();
  await expect(page.getByText('Email sent').first()).toBeVisible();
});

test('an administrator sees the mailboxes and email routing settings', async ({ page }) => {
  await login(page, 'admin@relaydesk.local');
  await page.goto('/settings/mailboxes');
  await expect(page.getByRole('heading', { name: 'Mailboxes' })).toBeVisible();
  await expect(page.getByText('support@relaydesk.local')).toBeVisible();
  await page.goto('/settings/email-routing');
  await expect(page.getByRole('heading', { name: 'Email routing' })).toBeVisible();
  await expect(page.getByText(/Purchase order|Quotation/i).first()).toBeVisible();
});
