import { NextResponse, type NextRequest } from 'next/server';

/**
 * Subdomain rewrite: requests to mcp.swarmdock.ai are rewritten to the /mcp
 * subtree so the registry lives at its own memorable URL while the main
 * app continues to own the apex.
 *
 * The rewrite is path-preserving: mcp.swarmdock.ai/foo/bar → /mcp/foo/bar.
 * Requests already under /mcp are passed through untouched to avoid
 * infinite loops.
 */

const MCP_HOST = 'mcp.swarmdock.ai';
const MCP_PREVIEW_HOST_SUFFIX = '.swarmdock.ai';

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  const isMcpHost = host === MCP_HOST || host.startsWith('mcp.') && host.endsWith(MCP_PREVIEW_HOST_SUFFIX);
  if (!isMcpHost) return NextResponse.next();

  const url = request.nextUrl.clone();
  if (url.pathname.startsWith('/mcp')) return NextResponse.next();
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
