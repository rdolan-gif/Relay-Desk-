import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_PASSWORD ?? 'harbour-lantern-violet-42';

async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

/** The state badge in the ticket header. */
const stateBadge = (page: Page, state: string) =>
  page.locator('.mantine-Badge-root', { hasText: new RegExp(`^${state}$`) });

async function newTicket(page: Page, title: string) {
  await page.goto('/tickets/new');
  await page.getByLabel('Title').fill(title);
  await page.getByRole('textbox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'Billing' }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  return Number((await page.url()).split('/').pop());
}

test('closing an unassigned ticket from the form sets the User to the agent', async ({ page }) => {
  await login(page, 'agent@relaydesk.local');
  await newTicket(page, `E2E close ${Date.now()}`);
  await expect(page.getByText('User: —')).toBeVisible();
  await page.getByRole('textbox', { name: 'State' }).click();
  await page.getByRole('option', { name: 'Closed' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('User: Alex Agent')).toBeVisible();
  await expect(stateBadge(page, 'Closed')).toBeVisible();
});

test("a comment by someone other than the ticket's User reopens a closed ticket", async ({ browser }) => {
  const agentPage = await browser.newPage();
  await login(agentPage, 'agent@relaydesk.local');
  const id = await newTicket(agentPage, `E2E reopen ${Date.now()}`);
  await agentPage.getByRole('textbox', { name: 'State' }).click();
  await agentPage.getByRole('option', { name: 'Closed' }).click();
  await agentPage.getByRole('button', { name: 'Save changes' }).click();
  await expect(stateBadge(agentPage, 'Closed')).toBeVisible();

  const adminPage = await browser.newPage();
  await login(adminPage, 'admin@relaydesk.local');
  await adminPage.goto(`/tickets/${id}`);
  await adminPage.getByRole('textbox', { name: 'Comment' }).click();
  await adminPage.keyboard.type('Customer called back with more details.');
  await adminPage.getByRole('button', { name: 'Add comment' }).last().click();
  await expect(adminPage.getByText('Customer called back with more details.')).toBeVisible();
  await expect(stateBadge(adminPage, 'Open')).toBeVisible();
});

test('team views appear in the sidebar and filter the list', async ({ page }) => {
  await login(page, 'agent@relaydesk.local');
  await page.goto('/tickets');
  await page.getByRole('navigation', { name: 'Ticket views' }).getByText('My open tickets', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'My open tickets' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Printer jams on every second page' })).toBeVisible();
});
