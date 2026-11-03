import sanitizeHtml from 'sanitize-html';

/**
 * Allow-list sanitiser for rich text written in the app (descriptions, comments).
 * Strips scripts, event handlers and unknown tags; links get rel="noopener".
 */
export function sanitizeRich(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'a',
      'ul',
      'ol',
      'li',
      'blockquote',
      'code',
      'pre',
      'h3',
      'h4',
      'span',
    ],
    allowedAttributes: { a: ['href', 'target', 'rel'], span: ['data-mention-id', 'class'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) },
  });
}

/** Plain-text view of sanitised HTML, for search and previews. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
}
