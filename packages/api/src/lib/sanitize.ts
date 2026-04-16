import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitize HTML content before storage.
 * Strips all script execution vectors while preserving safe HTML structure.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: [
      'onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onmouseover',
      'onmousemove', 'onmouseout', 'onkeydown', 'onkeypress', 'onkeyup',
      'onload', 'onerror', 'onabort', 'onfocus', 'onblur', 'onsubmit',
      'onreset', 'onchange', 'oninput', 'onselect',
    ],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Strip ALL HTML/script content from a free-text field. Use for fields that
 * should never contain markup (titles, plain descriptions, notes, proposals).
 * Returns plain text only — no tags, no entities re-introduced.
 */
export function sanitizeFreeText(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

/**
 * Apply sanitizeFreeText to specific string fields of an object.
 * Returns a new object with the named fields sanitized; other fields untouched.
 * Non-string fields with the named key are left unchanged.
 */
export function sanitizeFreeTextFields<T extends Record<string, unknown>>(
  obj: T,
  fields: ReadonlyArray<keyof T>,
): T {
  const out = { ...obj };
  for (const field of fields) {
    const value = out[field];
    if (typeof value === 'string') {
      out[field] = sanitizeFreeText(value) as T[keyof T];
    }
  }
  return out;
}
