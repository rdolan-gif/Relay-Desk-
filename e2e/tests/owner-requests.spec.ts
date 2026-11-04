import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_PASSWORD ?? 'harbour-lantern-violet-42';

async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

test('the main menu is Ricoman blue in light mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await login(page, 'agent@relaydesk.local');
  const bg = await page.getByRole('navigation', { name: 'Main' }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(0, 74, 152)');
});

test('an Open ticket nobody has opened yet is bold, and stops being bold once opened', async ({ browser }) => {
  const admin = await browser.newPage();
  await login(admin, 'admin@relaydesk.local');
  const title = `E2E unread ${Date.now()}`;
  await admin.goto('/tickets/new');
  await admin.getByLabel('Title').fill(title);
  await admin.getByRole('textbox', { name: 'Category' }).click();
  await admin.getByRole('option', { name: 'Support' }).click();
  await admin.getByRole('button', { name: 'Create' }).click();
  await expect(admin.getByRole('heading', { name: title })).toBeVisible();

  const agent = await browser.newPage();
  await login(agent, 'agent@relaydesk.local');
  await agent.goto('/tickets');
  await agent.getByPlaceholder('Search…').fill(title);
  const row = agent.getByRole('row', { name: new RegExp(title) });
  await expect(row).toContainText('Unread');
  expect(await row.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('700');
  await row.click();
  await expect(agent.getByRole('heading', { name: title })).toBeVisible();
  await agent.goto('/tickets');
  await agent.getByPlaceholder('Search…').fill(title);
  await expect(agent.getByRole('row', { name: new RegExp(title) })).not.toContainText('Unread');
});

test('My views: drag to reorder asks to save; swipe left reveals a bin that asks before removing', async ({ page }) => {
  await login(page, 'agent@relaydesk.local');
  await page.goto('/tickets');
  const nav = page.getByRole('navigation', { name: 'Ticket views' });
  // Pin both team views so there is something to reorder.
  const handles = nav.getByRole('button', { name: /^Drag to reorder: / });
  await expect(nav.getByText('Team views')).toBeVisible();
  for (const name of ['My open tickets', 'Unassigned']) {
    const pin = nav.getByRole('button', { name: `Pin to My views: ${name}` });
    if (await pin.count()) {
      const before = await handles.count();
      await pin.click();
      await expect(handles).toHaveCount(before + 1);
    }
  }
  await expect(handles).toHaveCount(2);
  for (const name of ['My open tickets', 'Unassigned']) // layout has settled
    await expect(nav.getByRole('button', { name: `Pin to My views: ${name}` })).toHaveCount(0);
  const firstName = (await handles.nth(0).getAttribute('aria-label'))!.replace('Drag to reorder: ', '');
  await handles.nth(1).scrollIntoViewIfNeeded();
  await handles.nth(0).hover();
  const a = (await handles.nth(0).boundingBox())!;
  const b = (await handles.nth(1).boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 6, { steps: 3 });
  await page.mouse.move(a.x + a.width / 2, b.y + b.height / 2 + 12, { steps: 12 });
  await expect(handles.first()).toHaveAttribute('aria-pressed', 'true'); // the drag is live
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: 'Save changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).last().click();
  await expect(page.getByRole('dialog', { name: 'Save changes?' })).toBeHidden();
  await page.reload();
  await expect(handles.nth(1)).toHaveAttribute('aria-label', `Drag to reorder: ${firstName}`);

  // Swipe the first view left with the mouse.
  const label = nav.getByText(firstName === 'My open tickets' ? 'Unassigned' : 'My open tickets', { exact: true }).first();
  const box = (await label.boundingBox())!;
  await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 60, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await nav.getByRole('button', { name: /^Delete: / }).first().click();
  await expect(page.getByRole('dialog', { name: 'Remove from My views?' })).toContainText('Are you sure');
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(handles).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Leave My views as we found it.
  const last = (await nav.getByText(firstName, { exact: true }).first().boundingBox())!;
  await page.mouse.move(last.x + last.width - 5, last.y + last.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x - 60, last.y + last.height / 2, { steps: 10 });
  await page.mouse.up();
  await nav.getByRole('button', { name: /^Delete: / }).first().click();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(handles).toHaveCount(0);
});
