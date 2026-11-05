/**
 * Read-only demo build (VITE_DEMO=1): the real screens over a recorded snapshot of the API,
 * so the app can run as a static page with no server. Reads come from `demo-data.json`;
 * changes are refused with a clear message.
 */
import { matchesConditions, type FilterCondition, type FilterFieldDef } from '@relay-desk/domain';

export const DEMO = import.meta.env.VITE_DEMO === '1';

interface Recording {
  [url: string]: { status: number; body: unknown };
}

const READ_ONLY = { message: 'This is a read-only demo: changes are not saved.', reason: 'demo_read_only' };

function json(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Keeps list items (or array entries) that mention every word of the search. */
function filterByText(body: unknown, q: string): unknown {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const keep = (x: unknown) => {
    const s = JSON.stringify(x).toLowerCase();
    return words.every((w) => s.includes(w));
  };
  if (Array.isArray(body)) return body.filter(keep);
  if (body && typeof body === 'object' && Array.isArray((body as { items?: unknown[] }).items)) {
    const items = (body as { items: unknown[] }).items.filter(keep);
    return { ...(body as object), items, total: items.length };
  }
  return body;
}

export async function installDemo() {
  const data: Recording = await fetch(`${import.meta.env.BASE_URL}demo-data.json`).then((r) => r.json());
  const byPath = new Map<string, { params: URLSearchParams; status: number; body: unknown }[]>();
  for (const [url, v] of Object.entries(data)) {
    const u = new URL(url, 'http://demo');
    const list = byPath.get(u.pathname) ?? [];
    list.push({ params: u.searchParams, ...v });
    byPath.set(u.pathname, list);
  }
  const get = (path: string) => byPath.get(path)?.[0]?.body;

  /** Closest recording: same path, most query parameters in common. */
  const lookup = (u: URL) => {
    const exact = data[`${u.pathname}${u.search}`];
    if (exact) return exact;
    const candidates = byPath.get(u.pathname);
    if (!candidates?.length) return null;
    let best = candidates[0]!;
    let score = -1;
    for (const c of candidates) {
      let s = 0;
      u.searchParams.forEach((v, k) => {
        if (k !== 'q' && c.params.get(k) === v) s++;
      });
      if (s > score) {
        score = s;
        best = c;
      }
    }
    const q = u.searchParams.get('q');
    return { status: best.status, body: q ? filterByText(best.body, q) : best.body };
  };

  /**
   * The ticket list with the view's and the filter's conditions applied to the recorded
   * tickets, using the same matching rules as the server (domain `matchesConditions`).
   */
  const ticketList = (u: URL) => {
    const full = byPath.get('/api/tickets')?.find((c) => !c.params.has('viewId') && !c.params.has('filter'));
    const all = (full?.body as { items: Record<string, unknown>[] } | undefined)?.items ?? [];
    const fields = ((get('/api/tickets/meta') as { filterFields?: FilterFieldDef[] } | undefined)?.filterFields ??
      []) as FilterFieldDef[];
    const me = (get('/api/auth/me') as { user?: { id: string } } | undefined)?.user?.id;
    const sidebar = data['/api/tickets/views']?.body as
      | {
          teamViews?: { id: string; conditions: FilterCondition[] }[];
          myViews?: { id: string; conditions: FilterCondition[] }[];
        }
      | undefined;
    const conditions: FilterCondition[] = [];
    const viewId = u.searchParams.get('viewId');
    if (viewId) {
      const v = [...(sidebar?.teamViews ?? []), ...(sidebar?.myViews ?? [])].find((x) => x.id === viewId);
      conditions.push(...(v?.conditions ?? []));
    }
    try {
      conditions.push(...((JSON.parse(u.searchParams.get('filter') ?? '[]') as FilterCondition[]) ?? []));
    } catch {
      // an unreadable filter is ignored
    }
    const resolved = conditions.map((c) => (c.value === '@me' && me ? { ...c, value: me } : c));
    const flat = (t: Record<string, unknown>) => ({
      ...t,
      ...Object.fromEntries(
        Object.entries((t.customFields as Record<string, unknown> | undefined) ?? {}).map(([k, v]) => [
          `custom.${k}`,
          v,
        ]),
      ),
    });
    let items = all.filter((t) => matchesConditions(flat(t), fields, resolved));
    const q = u.searchParams.get('q');
    if (q) items = (filterByText({ items }, q) as { items: Record<string, unknown>[] }).items;
    const sort = u.searchParams.get('sort');
    if (sort) {
      const dir = u.searchParams.get('dir') === 'desc' ? -1 : 1;
      items = [...items].sort((a, b) =>
        String(a[sort] ?? '') < String(b[sort] ?? '') ? -dir : String(a[sort] ?? '') > String(b[sort] ?? '') ? dir : 0,
      );
    }
    const pageSize = Number(u.searchParams.get('pageSize') ?? 50) || 50;
    const page = Number(u.searchParams.get('page') ?? 1) || 1;
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
  };

  /** Global search over the recorded lists. */
  const search = (q: string) => {
    const tickets = (get('/api/tickets') as { items: { id: number; title: string }[] } | undefined)?.items ?? [];
    const contacts =
      (get('/api/crm/contacts') as { items: { id: string; name: string; emails: string[] }[] } | undefined)?.items ??
      [];
    const accounts =
      (get('/api/crm/accounts') as { items: { id: string; name: string; path?: string }[] } | undefined)?.items ?? [];
    const kb = (get('/api/kb/articles') as { id: string; title: string; snippet: string }[] | undefined) ?? [];
    const has = (x: unknown) => JSON.stringify(x).toLowerCase().includes(q.toLowerCase());
    return {
      tickets: tickets
        .filter(has)
        .slice(0, 8)
        .map((t) => ({ id: t.id, title: t.title, state: (t as { state?: string }).state })),
      contacts: contacts.filter(has).slice(0, 8),
      accounts: accounts
        .filter(has)
        .slice(0, 8)
        .map((a) => ({ id: a.id, name: a.path ?? a.name })),
      records: [],
      kb: kb
        .filter(has)
        .slice(0, 8)
        .map((a) => ({ id: a.id, title: a.title })),
    };
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!raw.startsWith('/api')) return realFetch(input, init);
    const u = new URL(raw, 'http://demo');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET') {
      if (u.pathname === '/api/search') return json(200, search(u.searchParams.get('q') ?? ''));
      if (u.pathname === '/api/tickets' && get('/api/tickets')) return json(200, ticketList(u));
      const hit = lookup(u);
      return hit
        ? json(hit.status, hit.body)
        : json(404, { message: 'Not part of this demo.', reason: 'demo_not_recorded' });
    }
    // A few writes are part of just looking around.
    if (/^\/api\/tickets\/\d+\/presence$/.test(u.pathname)) return json(200, []);
    if (/^\/api\/tickets\/\d+\/presence\/leave$/.test(u.pathname)) return json(200, { ok: true });
    if (u.pathname.startsWith('/api/me/notifications')) return json(200, { unread: 0 });
    if (u.pathname === '/api/auth/logout') return json(204, undefined);
    // My views (reorder, pin, remove) is kept in memory so the drag and swipe can be tried.
    const sidebar = data['/api/tickets/views'];
    if (method === 'PUT' && u.pathname === '/api/tickets/views/sidebar' && sidebar) {
      const { items } = JSON.parse(String(init?.body ?? '{}')) as { items: Record<string, unknown>[] };
      const body = sidebar.body as { items: unknown[] };
      body.items = items.map((i, position) => ({ ...i, position }));
      return json(200, body);
    }
    return json(403, READ_ONLY);
  };

  // No live server to push events from.
  class QuietEventSource extends EventTarget {
    onmessage = null;
    onerror = null;
    readyState = 1;
    close() {
      this.readyState = 2;
    }
  }
  (window as unknown as { EventSource: unknown }).EventSource = QuietEventSource;
}
