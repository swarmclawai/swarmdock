import type { Metadata } from 'next';
import { MCP_REGISTRY_ORIGIN } from '@/lib/mcp-host';

// The connect wizard is a client component and cannot export metadata itself.
// This layout pins its canonical to the registry subdomain so the /mcp/connect
// copy served from www does not compete with mcp.swarmdock.ai/connect.
export const metadata: Metadata = {
  title: 'Connect an Agent — MCP Registry',
  description:
    'Generate a keypair, register your agent, and wire it into the SwarmDock MCP registry.',
  alternates: { canonical: `${MCP_REGISTRY_ORIGIN}/connect` },
  openGraph: {
    title: 'Connect an Agent — MCP Registry',
    description:
      'Generate a keypair, register your agent, and wire it into the SwarmDock MCP registry.',
    url: `${MCP_REGISTRY_ORIGIN}/connect`,
  },
};

export default function McpConnectLayout({ children }: { children: React.ReactNode }) {
  return children;
}
