#!/usr/bin/env node
/**
 * Production SEO probes for the MCP registry subdomain contract.
 *
 * Verifies the canonical topology after each deploy:
 *  - clean subdomain routes return 200;
 *  - /mcp-prefixed subdomain URLs permanently redirect to clean paths;
 *  - the subdomain robots file points at the subdomain sitemap;
 *  - the subdomain sitemap contains only mcp.swarmdock.ai URLs;
 *  - unknown server routes return a real 404;
 *  - the main domain keeps its own sitemap and /mcp subtree.
 *
 * Usage: node scripts/seo-probes.mjs [base-host]
 * Exit code is non-zero when any probe fails.
 */

const MCP_ORIGIN = `https://${process.argv[2] ?? 'mcp.swarmdock.ai'}`;
const WWW_ORIGIN = 'https://www.swarmdock.ai';

let failures = 0;

function check(name, ok, detail = '') {
  const status = ok ? 'PASS' : 'FAIL';
  if (!ok) failures += 1;
  console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function fetchRaw(url) {
  const res = await fetch(url, { redirect: 'manual' });
  const body = await res.text();
  return { status: res.status, location: res.headers.get('location'), body };
}

// ── Subdomain: clean routes resolve ─────────────────────────
{
  const res = await fetchRaw(`${MCP_ORIGIN}/`);
  check('GET / on registry host returns 200', res.status === 200, `got ${res.status}`);
}
{
  const res = await fetchRaw(`${MCP_ORIGIN}/methodology`);
  check('GET /methodology returns 200', res.status === 200, `got ${res.status}`);
}

// ── Subdomain: /mcp-prefixed duplicates permanently redirect ─
{
  const res = await fetchRaw(`${MCP_ORIGIN}/mcp`);
  check(
    'GET /mcp redirects 301 to /',
    res.status === 301 && res.location === '/',
    `got ${res.status} → ${res.location}`,
  );
}
{
  const res = await fetchRaw(`${MCP_ORIGIN}/mcp/servers/filesystem`);
  check(
    'GET /mcp/servers/filesystem redirects 301 to clean path',
    res.status === 301 && res.location === '/servers/filesystem',
    `got ${res.status} → ${res.location}`,
  );
}

// ── Subdomain: robots and sitemap are registry-scoped ───────
{
  const res = await fetchRaw(`${MCP_ORIGIN}/robots.txt`);
  check(
    'robots.txt points at the subdomain sitemap',
    res.status === 200 && res.body.includes(`${MCP_ORIGIN}/sitemap.xml`),
    `got ${res.status}`,
  );
}
{
  const res = await fetchRaw(`${MCP_ORIGIN}/sitemap.xml`);
  const ok =
    res.status === 200 &&
    res.body.includes(MCP_ORIGIN) &&
    !res.body.includes(WWW_ORIGIN);
  check('sitemap.xml contains only registry-host URLs', ok, `got ${res.status}`);
}

// ── Subdomain: unknown server routes 404 ────────────────────
{
  const res = await fetchRaw(`${MCP_ORIGIN}/servers/definitely-not-a-real-server-404`);
  check('unknown server route returns 404', res.status === 404, `got ${res.status}`);
}

// ── Main domain: untouched by the registry contract ─────────
{
  const res = await fetchRaw(`${WWW_ORIGIN}/sitemap.xml`);
  check(
    'main-domain sitemap serves www URLs',
    res.status === 200 && res.body.includes(WWW_ORIGIN),
    `got ${res.status}`,
  );
}
{
  const res = await fetchRaw(`${WWW_ORIGIN}/mcp`);
  check('main-domain /mcp still resolves', res.status === 200, `got ${res.status}`);
}

console.log(failures === 0 ? '\nAll probes passed.' : `\n${failures} probe(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
