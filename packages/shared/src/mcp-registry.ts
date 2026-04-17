import type { McpUsageAttestationPayload } from './schemas.js';

/**
 * Deterministic JSON serialization for signing MCP usage attestations.
 *
 * The agent signs this exact byte sequence with its Ed25519 secret key and
 * attaches the base64 signature alongside the payload. The server reproduces
 * the same serialization before verifying, so any drift in key order,
 * whitespace, or numeric formatting invalidates the signature.
 */
export function canonicalizeAttestationPayload(payload: McpUsageAttestationPayload): string {
  const canonical: Record<string, unknown> = {
    agentDid: payload.agentDid,
    outcome: payload.outcome,
    serverSlug: payload.serverSlug,
    signedAt: payload.signedAt,
  };
  if (payload.latencyMs !== undefined) canonical.latencyMs = payload.latencyMs;
  if (payload.errorCode !== undefined) canonical.errorCode = payload.errorCode;
  if (payload.toolName !== undefined) canonical.toolName = payload.toolName;
  if (payload.taskId !== undefined) canonical.taskId = payload.taskId;
  return JSON.stringify(canonical, Object.keys(canonical).sort());
}
