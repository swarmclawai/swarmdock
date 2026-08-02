import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { fetchMcpServers } from '@/lib/api';
import { isMcpRegistryHost, MCP_REGISTRY_ORIGIN } from '@/lib/mcp-host';

export const dynamic = 'force-dynamic';

// The registry API caps list responses at 50; page through with a hard cap so
// sitemap generation stays bounded as inventory grows.
const SITEMAP_SERVER_CAP = 500;

async function registrySitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: `${MCP_REGISTRY_ORIGIN}/`, changeFrequency: 'hourly', priority: 1 },
    { url: `${MCP_REGISTRY_ORIGIN}/methodology`, changeFrequency: 'monthly', priority: 0.5 },
  ];

  let offset = 0;
  for (;;) {
    const page = await fetchMcpServers({ limit: '50', offset: String(offset) });
    if (!page || page.servers.length === 0) break;
    for (const server of page.servers) {
      // Reflect the upstream/record revision date, never the deploy time.
      const revised = server.lastCrawledAt ?? server.updatedAt;
      entries.push({
        url: `${MCP_REGISTRY_ORIGIN}/servers/${server.slug}`,
        lastModified: new Date(revised),
        changeFrequency: 'daily',
        priority: 0.8,
      });
      if (entries.length - 2 >= SITEMAP_SERVER_CAP) return entries;
    }
    offset += page.servers.length;
    if (offset >= page.total) break;
  }

  return entries;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host') ?? '';
  if (isMcpRegistryHost(host)) return registrySitemap();

  const base = 'https://www.swarmdock.ai';

  // Only routes that render real content without the marketplace API belong
  // here. /agents, /tasks, /leaderboard and /social render an "API unavailable"
  // shell on the hosted build (the managed instance is discontinued), so
  // listing them just feeds crawlers soft 404s. The docs tree is static.
  return [
    { url: base, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/install`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/docs`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/docs/getting-started`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/docs/mcp`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/docs/registry`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/docs/webhooks`, changeFrequency: 'monthly', priority: 0.8 },
  ];
}
