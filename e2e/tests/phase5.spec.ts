import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_PASSWORD ?? 'harbour-lantern-violet-42';

async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

async function newSupportTicket(page: Page, title: string, user?: string) {
  await page.goto('/tickets/new');
  await page.getByLabel('Title').fill(title);
  await page.getByRole('textbox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'Support' }).click();
  if (user) {
    await page.getByRole('textbox', { name: 'User' }).click();
    await page.getByRole('option', { name: user }).click();
  }
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  return Number(page.url().split('/').pop());
}

test('a "Waiting +2 days, Back" macro sets the fields, saves and returns to the list in one click', async ({
  page,
}) => {
  await login(page, 'agent@relaydesk.local');
  const title = `E2E macro ${Date.now()}`;
  const id = await newSupportTicket(page, title);
  await page.getByRole('button', { name: 'Waiting +2 days' }).click();
  await expect(page).toHaveURL(/\/tickets$/);
  const saved = await (await page.request.get(`/api/tickets/${id}`)).json();
  expect(saved.state).toBe('waiting');
  const days = (Date.parse(saved.reopenAt) - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(1.9);
  expect(days).toBeLessThan(2.1);
  await page.goto(`/tickets/${id}`);
  await expect(page.locator('.mantine-Badge-root', { hasText: /^Waiting$/ })).toBeVisible();
});

test('assigning a ticket shows up in the bell straight away, and opens the ticket', async ({ browser }) => {
  const agent = await browser.newPage();
  await login(agent, 'agent@relaydesk.local');
  await agent.getByRole('button', { name: /^Notifications/ }).click();
  const markAll = agent.getByRole('button', { name: 'Mark all read' });
  if (await markAll.isEnabled()) await markAll.click();
  await agent.keyboard.press('Escape');
  await expect(agent.getByRole('button', { name: 'Notifications' })).toBeVisible();

  const admin = await browser.newPage();
  await login(admin, 'admin@relaydesk.local');
  const title = `E2E notify ${Date.now()}`;
  const id = await newSupportTicket(admin, title, 'Alex Agent');

  // Other tests running alongside can notify the same agent, so look for this ticket's notice
  // rather than an exact count.
  const bell = agent.getByRole('button', { name: /^Notifications \(\d+ unread\)$/ });
  await expect(bell).toBeVisible({ timeout: 10_000 });
  await bell.click();
  await agent.locator('.mantine-Popover-dropdown').getByText(`#${id} was assigned to you`).click();
  await expect(agent.getByRole('heading', { name: title })).toBeVisible();
  // Opening it marks that notification read.
  await expect
    .poll(async () => {
      const list = (await (await agent.request.get('/api/me/notifications')).json()) as {
        items: { ticketId: number | null; readAt: string | null }[];
      };
      return list.items.find((n) => n.ticketId === id)?.readAt ?? null;
    })
    .not.toBeNull();
});

test('an administrator manages macros in Settings', async ({ page }) => {
  await login(page, 'admin@relaydesk.local');
  await page.goto('/settings/macros');
  await expect(page.getByRole('heading', { name: 'Macros' })).toBeVisible();
  await page.getByText('Waiting +2 days').first().click();
  await expect(page.getByText('3. Save and go back to the list')).toBeVisible();
});
