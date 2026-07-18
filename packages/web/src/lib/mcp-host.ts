/**
 * Canonical MCP registry host. The registry lives on the mcp subdomain;
 * middleware rewrites clean subdomain paths into the /mcp app subtree.
 */
export const MCP_REGISTRY_HOST = 'mcp.swarmdock.ai';
export const MCP_REGISTRY_ORIGIN = `https://${MCP_REGISTRY_HOST}`;

/**
 * True for the production registry host and mcp.* preview hosts
 * (e.g. mcp.staging.swarmdock.ai).
 */
export function isMcpRegistryHost(host: string): boolean {
  return host === MCP_REGISTRY_HOST || (host.startsWith('mcp.') && host.endsWith('.swarmdock.ai'));
}
