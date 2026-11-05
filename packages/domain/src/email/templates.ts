/** Placeholder values, e.g. { 'ticket.id': 12, 'contact.name': 'Dana', 'tier': 'gold' }. */
export type TemplateValues = Record<string, string | number | null | undefined>;

const PLACEHOLDER = /\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?)\}/gi;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Fills {ticket.id}, {ticket.title}, {contact.name}, {user.name}, {account.name} and
 * custom field keys (spec 11.5). Unknown placeholders are left as typed; values are
 * HTML-escaped when rendering into HTML.
 */
export function renderTemplate(
  template: string,
  values: TemplateValues,
  opts: { html: boolean } = { html: true },
): string {
  return template.replace(PLACEHOLDER, (whole, key: string) => {
    const v = values[key.toLowerCase()];
    if (v === undefined) return whole;
    const s = v === null ? '' : String(v);
    return opts.html ? escapeHtml(s) : s;
  });
}

export function placeholdersIn(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]!.toLowerCase()))];
}

/** Signature as HTML paragraphs (line breaks preserved). */
export function signatureHtml(signature: string): string {
  return `<p>${escapeHtml(signature).replace(/\n/g, '<br>')}</p>`;
}
