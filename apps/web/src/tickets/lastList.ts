/**
 * Remembers the ticket list (view, filters, page) a person last looked at, so "Back to tickets"
 * and "Save and close ticket" return them to it. Per browser tab; falls back to /tickets.
 */
const KEY = 'relay-desk:last-ticket-list';

export function rememberTicketList(search: string) {
  try {
    sessionStorage.setItem(KEY, `/tickets${search}`);
  } catch {
    // storage unavailable: the plain list is fine
  }
}

export function lastTicketList(): string {
  try {
    const v = sessionStorage.getItem(KEY);
    return v && v.startsWith('/tickets') ? v : '/tickets';
  } catch {
    return '/tickets';
  }
}
