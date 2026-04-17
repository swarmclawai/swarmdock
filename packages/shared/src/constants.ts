export const PLATFORM_FEE_PERCENT = 7;
export const USDC_DECIMALS = 6;
export const AAT_EXPIRY_HOURS = 24;
export const CHALLENGE_TTL_SECONDS = 300;

export const AGENT_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DEREGISTERED: 'deregistered',
  DORMANT: 'dormant',
  BANNED: 'banned',
} as const;

export const TASK_STATUS = {
  OPEN: 'open',
  BIDDING: 'bidding',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  REVIEW: 'review',
  COMPLETED: 'completed',
  DISPUTED: 'disputed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  FAILED: 'failed',
} as const;

export const BID_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
} as const;

export const ESCROW_STATUS = {
  PENDING: 'pending',
  FUNDED: 'funded',
  RELEASING: 'releasing',
  RELEASED: 'released',
  REFUNDING: 'refunding',
  REFUNDED: 'refunded',
  RELEASE_FAILED: 'release_failed',
  REFUND_FAILED: 'refund_failed',
  FAILED: 'failed',
} as const;

export const DISPUTE_STATUS = {
  OPEN: 'open',
  TRIBUNAL: 'tribunal',
  RESOLVED: 'resolved',
  ESCALATED: 'escalated',
  /** Not enough eligible judges — admin must resolve manually. */
  ADMIN_REQUIRED: 'admin_required',
} as const;

export const DISPUTE_RESOLUTION = {
  RELEASE: 'release',
  REFUND: 'refund',
  // SPLIT: 'split', — disabled until partial release is implemented in escrow.ts
} as const;

export const DISPUTE_VERDICT = {
  REQUESTER_WINS: 'requester_wins',
  ASSIGNEE_WINS: 'assignee_wins',
  SPLIT: 'split',
} as const;

export const TRANSACTION_TYPE = {
  ESCROW_DEPOSIT: 'escrow_deposit',
  ESCROW_RELEASE: 'escrow_release',
  ESCROW_REFUND: 'escrow_refund',
  PLATFORM_FEE: 'platform_fee',
  TRIBUNAL_FEE: 'tribunal_fee',
  DISPUTE_REFUND: 'dispute_refund',
  MCP_TOOL_CALL: 'mcp_tool_call',
  MCP_SUBSCRIPTION: 'mcp_subscription',
} as const;

export const TRANSACTION_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
} as const;

export const REPUTATION_DIMENSIONS = [
  'quality',
  'reliability',
  'speed',
  'communication',
  'value',
] as const;

export type ReputationDimension = (typeof REPUTATION_DIMENSIONS)[number];

export const TRUST_LEVELS = {
  L0: 0, // Unverified — anonymous agent
  L1: 1, // Challenge completed — basic registration
  L2: 2, // Tasks completed — has track record
  L3: 3, // Portfolio verified — consistently good work
  L4: 4, // Community endorsed — top reputation
} as const;

export const MATCHING_MODE = {
  DIRECT: 'direct',
  OPEN: 'open',
  AUTO: 'auto',
} as const;

export const TASK_VISIBILITY = {
  PUBLIC: 'public',
  PRIVATE: 'private',
} as const;

export const INVITATION_SOURCE = {
  DIRECT: 'direct',
  SYSTEM_MATCH: 'system_match',
} as const;

export const INVITATION_STATUS = {
  PENDING: 'pending',
  VIEWED: 'viewed',
  DECLINED: 'declined',
} as const;

export const PRIVATE_TASK_MATCH_LIMIT = 5;

/**
 * Weight applied to description-embedding cosine similarity when blending
 * with skill-overlap score during invitation matching. `0` disables semantic
 * matching; `1` ignores skill overlap. Operators override at runtime via the
 * MATCHING_EMBEDDING_WEIGHT env var.
 */
export const MATCHING_EMBEDDING_WEIGHT_DEFAULT = 0.3;

/**
 * Max candidates pulled from the embedding-similarity pool before merging
 * with the skill-overlap pool. The union is trimmed to PRIVATE_TASK_MATCH_LIMIT.
 */
export const EMBEDDING_CANDIDATE_LIMIT = 20;

export const PRICING_MODEL = {
  PER_TASK: 'per-task',
  PER_HOUR: 'per-hour',
  PER_TOKEN: 'per-token',
  PER_REQUEST: 'per-request',
  CUSTOM: 'custom',
} as const;

export const SCOPES = [
  'tasks.read',
  'tasks.write',
  'bids.write',
  'profile.write',
  'ratings.write',
  'portfolio.write',
  'quality.read',
  'quality.write',
  'social.read',
  'social.write',
  'mcp.read',
  'mcp.write',
] as const;

export type Scope = (typeof SCOPES)[number];

// ============================================
// QUALITY VERIFICATION
// ============================================

export const QUALITY_VERDICT = {
  PASSED: 'passed',
  FAILED: 'failed',
  NEEDS_REVISION: 'needs_revision',
  /** No stages contributed a score — needs human review rather than auto-fail. */
  PENDING_REVIEW: 'pending_review',
} as const;

/** Default deadline (ms) after which a peer review falls back to reduced quorum. */
export const PEER_REVIEW_DEADLINE_MS = 72 * 60 * 60 * 1000; // 72 hours

export const QUALITY_STAGE = {
  SCHEMA_VALIDATION: 'schema_validation',
  LLM_JUDGE: 'llm_judge',
  FAITHFULNESS: 'faithfulness',
  PEER_REVIEW: 'peer_review',
} as const;

// ============================================
// SOCIAL LAYER
// ============================================

export const ACTIVITY_TYPE = {
  TASK_COMPLETED: 'task_completed',
  TASK_CREATED: 'task_created',
  SKILL_ADDED: 'skill_added',
  ENDORSEMENT_GIVEN: 'endorsement_given',
  ENDORSEMENT_RECEIVED: 'endorsement_received',
  GUILD_JOINED: 'guild_joined',
  MILESTONE_REACHED: 'milestone_reached',
  REPUTATION_CHANGE: 'reputation_change',
} as const;

export const ENDORSEMENT_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
} as const;

export const GUILD_VISIBILITY = {
  PUBLIC: 'public',
  PRIVATE: 'private',
  INVITE_ONLY: 'invite_only',
} as const;

export const GUILD_ROLE = {
  FOUNDER: 'founder',
  ADMIN: 'admin',
  MEMBER: 'member',
} as const;

// ============================================
// MCP MARKETPLACE
// ============================================

export const MCP_SERVICE_STATUS = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  DEPRECATED: 'deprecated',
} as const;

export const MCP_PRICING_MODEL = {
  PER_CALL: 'per_call',
  PER_MINUTE: 'per_minute',
  SUBSCRIPTION: 'subscription',
} as const;

export const MCP_SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const;

// ============================================
// MCP REGISTRY
// ============================================

export const MCP_TRANSPORT = {
  STDIO: 'stdio',
  SSE: 'sse',
  HTTP: 'streamable_http',
  WEBSOCKET: 'websocket',
} as const;

export const MCP_AUTH_MODE = {
  NONE: 'none',
  API_KEY: 'api_key',
  OAUTH: 'oauth',
  BEARER: 'bearer',
} as const;

export const MCP_INSTALL_METHOD = {
  NPM: 'npm',
  NPX: 'npx',
  PIPX: 'pipx',
  UVX: 'uvx',
  DOCKER: 'docker',
  BINARY: 'binary',
  REMOTE: 'remote',
} as const;

export const MCP_USAGE_OUTCOME = {
  SUCCESS: 'success',
  ERROR: 'error',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled',
} as const;

export const MCP_REGISTRY_SOURCE = {
  SMITHERY: 'smithery',
  MCP_OFFICIAL: 'mcp_official',
  GLAMA: 'glama',
  PULSEMCP: 'pulsemcp',
  SUBMITTED: 'submitted',
} as const;

/** Max payload size for signed usage attestations (bytes). */
export const MCP_ATTESTATION_MAX_BYTES = 2048;
