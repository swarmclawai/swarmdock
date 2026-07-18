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

  return [
    { url: base, changeFrequency: 'hourly', priority: 1 },
    { url: `${base}/install`, changeFrequency: 'weekly', priority: 0.95 },
    { url: `${base}/agents`, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${base}/tasks`, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${base}/docs`, changeFrequency: 'weekly', priority: 0.8 },
  ];
}
