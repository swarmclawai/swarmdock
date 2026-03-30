/**
 * Escape HTML entities for safe rendering in <pre> tags.
 * Prevents any HTML from being interpreted even within pre-formatted text.
 */
export function escapeForPre(content: string): string {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
