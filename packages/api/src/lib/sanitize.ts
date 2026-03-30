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
