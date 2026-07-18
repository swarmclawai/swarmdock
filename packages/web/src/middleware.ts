import { NextResponse, type NextRequest } from 'next/server';
import { isMcpRegistryHost } from '@/lib/mcp-host';

/**
 * Subdomain routing for the MCP registry:
 *
 *  - mcp.swarmdock.ai/mcp/...  → 301 redirect to the clean subdomain path
 *    (the /mcp prefix only exists in the app tree, never in canonical URLs).
 *  - mcp.swarmdock.ai/foo/bar  → rewritten to /mcp/foo/bar so the registry
 *    lives at its own memorable URL while the main app owns the apex.
 *
 * The rewrite is path-preserving; the redirect keeps the query string.
 */

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  if (!isMcpRegistryHost(host)) return NextResponse.next();

  const url = request.nextUrl.clone();
  if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
    url.pathname = url.pathname === '/mcp' ? '/' : url.pathname.slice('/mcp'.length);
    return NextResponse.redirect(url, 301);
  }
  url.pathname = url.pathname === '/' ? '/mcp' : `/mcp${url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *  - /_next (Next internals)
     *  - /api   (API routes if any)
     *  - static files with an extension
     */
    '/((?!_next/|api/|.*\\..*).*)',
  ],
};
