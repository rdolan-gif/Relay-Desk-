/**
 * Records the API responses behind every screen, as Richard, for the read-only demo build.
 * Needs the app running on :4173 over a demo database (pnpm db:seed && pnpm db:setup:support -- --demo).
 * Usage: node e2e/scripts/record-demo.cjs /tmp/demo-data.json, then pnpm --filter @relay-desk/web build:demo and copy the JSON into apps/web/dist-demo/
 */
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const data = {};
  await p.route('**/api/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (req.method() !== 'GET' || u.pathname === '/api/me/events') return route.continue();
    const res = await route.fetch();
    const body = await res.body();
    if ((res.headers()['content-type'] || '').includes('json')) {
      try {
        data[u.pathname + u.search] = { status: res.status(), body: JSON.parse(body.toString()) };
      } catch {}
    }
    await route.fulfill({ response: res, body });
  });
  const base = 'http://localhost:4173';
  await p.goto(base + '/');
  await p.getByLabel('Email').fill('richard@relaydesk.local');
  await p.getByLabel('Password').fill('harbour-lantern-violet-42');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.getByRole('heading', { name: /Welcome/ }).waitFor();
  const visit = async (path, extra) => {
    await p.goto(base + path);
    await p.waitForLoadState('networkidle').catch(() => {});
    await p.waitForTimeout(400);
    if (extra) await extra().catch((e) => console.log('extra fail', path, e.message.slice(0, 80)));
  };
  const api = async (path) => (await p.request.get(base + '/api' + path)).json();
  await visit('/');
  await visit('/tickets');
  // every team view and my view in the sidebar
  const sidebar = await api('/tickets/views/sidebar').catch(() => null);
  const views = [...(sidebar?.teamViews ?? []), ...(sidebar?.myViews ?? [])];
  for (const v of views) {
    await visit('/tickets');
    await p
      .getByText(v.name, { exact: true })
      .first()
      .click()
      .catch(() => {});
    await p.waitForLoadState('networkidle').catch(() => {});
  }
  const tickets = (await api('/tickets?pageSize=200')).items;
  for (const t of tickets)
    await visit(`/tickets/${t.id}`, async () => {
      await p.getByRole('tab', { name: 'History' }).click();
      await p.waitForLoadState('networkidle');
    });
  for (const path of [
    '/crm/contacts',
    '/crm/accounts',
    '/crm/records',
    '/kb',
    '/reports',
    '/templates',
    '/jobs',
    '/account',
    '/email/new',
    '/tickets/new',
  ])
    await visit(path);
  for (const c of (await api('/crm/contacts?pageSize=200')).items) await visit(`/crm/contacts/${c.id}`);
  for (const a of (await api('/crm/accounts?pageSize=200')).items) await visit(`/crm/accounts/${a.id}`);
  for (const r of (await api('/crm/records?pageSize=200')).items) await visit(`/crm/records/${r.id}`);
  const folders = await api('/kb/folders');
  for (const f of folders) await visit(`/kb?folder=${f.id}`);
  for (const a of await api('/kb/articles'))
    await visit(`/kb/articles/${a.id}`, async () => {
      await p.getByRole('button', { name: 'Version history' }).click();
      await p.waitForLoadState('networkidle');
    });
  // report drill-downs and the email tab
  await visit('/reports', async () => {
    for (const name of [
      'Tickets created',
      'Tickets closed',
      'First reply on time',
      'Deadline met',
      'Reopened after closing',
    ]) {
      await p.getByRole('button', { name: `${name}: show tickets` }).click();
      await p.waitForLoadState('networkidle');
      await p.keyboard.press('Escape');
      await p.waitForTimeout(200);
    }
    await p.getByRole('tab', { name: 'Email activity' }).click();
    await p.waitForLoadState('networkidle');
  });
  for (const s of [
    'users',
    'access-profiles',
    'rights-profiles',
    'categories',
    'statuses',
    'ticket-views',
    'mailboxes',
    'email-routing',
    'slas',
    'working-hours',
    'macros',
    'custom-fields',
    'crm-databases',
    'crm-record-types',
    'audit-log',
    'deleted',
  ])
    await visit(`/settings/${s}`);
  // a few detail calls the settings drawers make
  for (const rp of await api('/settings/rights-profiles'))
    await api(`/settings/rights-profiles/${rp.id}`)
      .then((b) => (data[`/api/settings/rights-profiles/${rp.id}`] = { status: 200, body: b }))
      .catch(() => {});
  for (const c of await api('/settings/categories'))
    await api(`/settings/categories/${c.id}`)
      .then((b) => (data[`/api/settings/categories/${c.id}`] = { status: 200, body: b }))
      .catch(() => {});
  fs.writeFileSync(process.argv[2], JSON.stringify(data));
  console.log(
    'recorded',
    Object.keys(data).length,
    'responses,',
    Math.round(fs.statSync(process.argv[2]).size / 1024),
    'KB',
  );
  await b.close();
})();
