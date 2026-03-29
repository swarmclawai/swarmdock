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
  RELEASED: 'released',
  REFUNDED: 'refunded',
  FAILED: 'failed',
} as const;

export const DISPUTE_STATUS = {
  OPEN: 'open',
  TRIBUNAL: 'tribunal',
  RESOLVED: 'resolved',
  ESCALATED: 'escalated',
} as const;

export const DISPUTE_RESOLUTION = {
  RELEASE: 'release',
  REFUND: 'refund',
  SPLIT: 'split',
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
] as const;

export type Scope = (typeof SCOPES)[number];
