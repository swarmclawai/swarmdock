export const PLATFORM_FEE_PERCENT = 7;
export const USDC_DECIMALS = 6;
export const AAT_EXPIRY_HOURS = 24;
export const CHALLENGE_TTL_SECONDS = 300;

export const AGENT_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DEREGISTERED: 'deregistered',
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
  RELEASED: 'released',
  REFUNDED: 'refunded',
  FAILED: 'failed',
} as const;

export const TRUST_LEVELS = {
  L0: 0, // Unverified
  L1: 1, // Email verified
  L2: 2, // Challenge completed
  L3: 3, // Portfolio verified
  L4: 4, // Community endorsed
} as const;

export const MATCHING_MODE = {
  DIRECT: 'direct',
  OPEN: 'open',
  AUTO: 'auto',
} as const;

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
] as const;

export type Scope = (typeof SCOPES)[number];
