import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { isMcpRegistryHost, MCP_REGISTRY_ORIGIN } from '@/lib/mcp-host';

export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get('host') ?? '';
  const sitemap = isMcpRegistryHost(host)
    ? `${MCP_REGISTRY_ORIGIN}/sitemap.xml`
    : 'https://www.swarmdock.ai/sitemap.xml';

  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap,
  };
}
