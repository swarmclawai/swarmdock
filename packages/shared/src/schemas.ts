import { z } from 'zod';
import {
  TASK_STATUS,
  MATCHING_MODE,
  PRICING_MODEL,
  DISPUTE_RESOLUTION,
  DISPUTE_VERDICT,
  TASK_VISIBILITY,
  GUILD_VISIBILITY,
} from './constants.js';

const MICRO_USDC_AMOUNT_MESSAGE = 'Must be a non-negative integer amount in micro-USDC';
export const MicroUsdcAmountSchema = z.string().regex(/^\d+$/, MICRO_USDC_AMOUNT_MESSAGE);

export const AgentSkillSchema = z.object({
  skillId: z.string().min(1),
  skillName: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  tags: z.array(z.string()).default([]),
  inputModes: z.array(z.string()).default(['text']),
  outputModes: z.array(z.string()).default(['text']),
  pricingModel: z.enum([
    PRICING_MODEL.PER_TASK,
    PRICING_MODEL.PER_HOUR,
    PRICING_MODEL.PER_TOKEN,
    PRICING_MODEL.PER_REQUEST,
    PRICING_MODEL.CUSTOM,
  ]).default(PRICING_MODEL.PER_TASK),
  basePrice: MicroUsdcAmountSchema,
  examplePrompts: z.array(z.string().min(1)).min(5, 'At least 5 example prompts required per skill'),
  benchmarkScores: z.unknown().optional(),
  sampleOutputs: z.unknown().optional(),
});

export const AgentSkillsUpdateSchema = z.array(AgentSkillSchema).min(1, 'At least one skill required');

// Agent registration
export const AgentRegisterSchema = z.object({
  publicKey: z.string().min(1, 'Public key is required'),
  displayName: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  avatarUrl: z.string().url().optional(),
  ownerDid: z.string().optional(),
  framework: z.string().optional(),
  frameworkVersion: z.string().optional(),
  modelProvider: z.string().optional(),
  modelName: z.string().optional(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address').optional(),
  agentCardUrl: z.string().url().optional(),
  skills: z.array(AgentSkillSchema).default([]),
});

export const AgentVerifySchema = z.object({
  publicKey: z.string().min(1),
  challenge: z.string().min(1),
  signature: z.string().min(1),
});

export const AgentLoginChallengeSchema = z.object({
  publicKey: z.string().min(1),
});

export const AgentUpdateSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM wallet address').optional(),
  avatarUrl: z.string().url().nullable().optional(),
  ownerDid: z.string().nullable().optional(),
  framework: z.string().optional(),
  frameworkVersion: z.string().optional(),
  modelProvider: z.string().optional(),
  modelName: z.string().optional(),
  agentCardUrl: z.string().url().optional(),
  dailySpendingLimit: MicroUsdcAmountSchema.optional(),
  webhookUrl: z.string().url().nullable().optional(),
  webhookSecret: z.string().min(16).max(256).nullable().optional(),
  webhookEvents: z.array(z.string()).nullable().optional(),
  mcpEndpoint: z.string().url().nullable().optional(),
  mcpCapabilities: z.unknown().nullable().optional(),
});

// Tasks
export const TaskCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(10000),
  skillRequirements: z.array(z.string().min(1)).min(1),
  inputData: z.unknown().optional(),
  inputFiles: z.array(z.string().url()).default([]),
  matchingMode: z.enum([
    MATCHING_MODE.DIRECT,
    MATCHING_MODE.OPEN,
    MATCHING_MODE.AUTO,
  ]).default(MATCHING_MODE.OPEN),
  budgetMin: MicroUsdcAmountSchema.optional(),
  budgetMax: MicroUsdcAmountSchema,
  deadline: z.string().datetime().optional(),
  directAssigneeId: z.string().uuid().optional(), // for direct matching
  visibility: z.enum([
    TASK_VISIBILITY.PUBLIC,
    TASK_VISIBILITY.PRIVATE,
  ]).default(TASK_VISIBILITY.PUBLIC),
  revealIdentity: z.boolean().default(true),
  invitedAgentIds: z.array(z.string().uuid()).default([]),
});

export const TaskUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().min(1).max(10000).optional(),
  deadline: z.string().datetime().optional(),
});

export const TaskSubmitSchema = z.object({
  artifacts: z.array(z.object({
    type: z.string().min(1),
    content: z.union([
      z.string().max(10_000_000), // 10MB text max
      z.record(z.unknown()),      // JSON objects
      z.array(z.unknown()),       // JSON arrays
    ]),
  })).min(1),
  files: z.array(z.string().url()).default([]),
  notes: z.string().max(5000).optional(),
});

export const TaskDisputeSchema = z.object({
  reason: z.string().min(1).max(5000),
  evidence: z.unknown().optional(),
});

export const DisputeResolveSchema = z.object({
  resolution: z.enum([
    DISPUTE_RESOLUTION.RELEASE,
    DISPUTE_RESOLUTION.REFUND,
  ]),
  notes: z.string().max(5000).optional(),
});

export const TribunalVoteSchema = z.object({
  verdict: z.enum([
    DISPUTE_VERDICT.REQUESTER_WINS,
    DISPUTE_VERDICT.ASSIGNEE_WINS,
    DISPUTE_VERDICT.SPLIT,
  ]),
  notes: z.string().max(5000).optional(),
});

export const InviteAgentsSchema = z.object({
  agentIds: z.array(z.string().uuid()).min(1),
});

export const InvitationListQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

const TASK_STATUS_VALUES = Object.values(TASK_STATUS) as [string, ...string[]];

export const TaskListQuerySchema = z.object({
  q: z.string().optional(),
  status: z.enum(TASK_STATUS_VALUES).optional(),
  skills: z.string().optional(), // comma-separated
  budgetMin: MicroUsdcAmountSchema.optional(),
  budgetMax: MicroUsdcAmountSchema.optional(),
  requesterId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export const AgentListQuerySchema = z.object({
  q: z.string().optional(),
  skills: z.string().optional(), // comma-separated
  framework: z.string().optional(),
  minTrustLevel: z.coerce.number().min(0).max(4).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

// Bids
export const BidCreateSchema = z.object({
  proposedPrice: MicroUsdcAmountSchema,
  confidenceScore: z.number().min(0).max(1).optional(),
  estimatedDuration: z.string().optional(), // ISO 8601 duration
  proposal: z.string().max(5000).optional(),
  portfolioRefs: z.array(z.string().url()).default([]),
});

// Ratings (float 0-1 scale)
export const RatingCreateSchema = z.object({
  taskId: z.string().uuid(),
  rateeId: z.string().uuid(),
  qualityScore: z.number().min(0).max(1),
  speedScore: z.number().min(0).max(1).optional(),
  communicationScore: z.number().min(0).max(1).optional(),
  reliabilityScore: z.number().min(0).max(1).optional(),
  valueScore: z.number().min(0).max(1).optional(),
  evidence: z.unknown().optional(),
  comment: z.string().max(2000).optional(),
});

// Key rotation
export const AgentKeyRotateSchema = z.object({
  currentSignature: z.string().min(1, 'Current key signature required'),
  newPublicKey: z.string().min(1, 'New public key required'),
  newKeySignature: z.string().min(1, 'New key signature required'),
  rotationChallenge: z.string().min(1, 'Rotation challenge required'),
});

// Owner verification
export const AgentVerifyOwnerSchema = z.object({
  ownerDid: z.string().min(1, 'Owner DID required'),
  signature: z.string().min(1, 'Signature required'),
  challenge: z.string().min(1, 'Challenge required'),
});

// Portfolio
export const PortfolioItemUpdateSchema = z.object({
  isPinned: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export type AgentRegisterInput = z.infer<typeof AgentRegisterSchema>;
export type AgentVerifyInput = z.infer<typeof AgentVerifySchema>;
export type AgentLoginChallengeInput = z.infer<typeof AgentLoginChallengeSchema>;
export type AgentUpdateInput = z.infer<typeof AgentUpdateSchema>;
export type TaskCreateInput = z.infer<typeof TaskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof TaskUpdateSchema>;
export type TaskSubmitInput = z.infer<typeof TaskSubmitSchema>;
export type TaskDisputeInput = z.infer<typeof TaskDisputeSchema>;
export type DisputeResolveInput = z.infer<typeof DisputeResolveSchema>;
export type TribunalVoteInput = z.infer<typeof TribunalVoteSchema>;
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
export type AgentListQuery = z.infer<typeof AgentListQuerySchema>;
export type BidCreateInput = z.infer<typeof BidCreateSchema>;
export type RatingCreateInput = z.infer<typeof RatingCreateSchema>;
export type PortfolioItemUpdateInput = z.infer<typeof PortfolioItemUpdateSchema>;
export type InviteAgentsInput = z.infer<typeof InviteAgentsSchema>;
export type InvitationListQuery = z.infer<typeof InvitationListQuerySchema>;
export type AgentKeyRotateInput = z.infer<typeof AgentKeyRotateSchema>;
export type AgentVerifyOwnerInput = z.infer<typeof AgentVerifyOwnerSchema>;

// ============================================
// SOCIAL LAYER
// ============================================

export const EndorsementCreateSchema = z.object({
  endorseeId: z.string().uuid(),
  skillId: z.string().optional(),
  title: z.string().min(1).max(200),
  message: z.string().max(2000).optional(),
  relatedTaskId: z.string().uuid().optional(),
});

export const GuildCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  visibility: z.enum([
    GUILD_VISIBILITY.PUBLIC,
    GUILD_VISIBILITY.PRIVATE,
    GUILD_VISIBILITY.INVITE_ONLY,
  ]).default(GUILD_VISIBILITY.PUBLIC),
  guildType: z.string().max(100).optional(),
  minMemberReputation: z.number().int().min(0).max(4).default(0),
});

export const ActivityFeedQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const PeerReviewSchema = z.object({
  approved: z.boolean(),
  score: z.number().min(0).max(1),
  feedback: z.string().max(5000).optional(),
});

export type EndorsementCreateInput = z.infer<typeof EndorsementCreateSchema>;
export type GuildCreateInput = z.infer<typeof GuildCreateSchema>;
export type ActivityFeedQuery = z.infer<typeof ActivityFeedQuerySchema>;
export type PeerReviewInput = z.infer<typeof PeerReviewSchema>;

// ============================================
// A2A RELAY MESSAGES
// ============================================

export const A2AMessageCreateSchema = z.object({
  recipientId: z.string().uuid(),
  type: z.string().min(1),
  payload: z.unknown(),
});

export type A2AMessageCreateInput = z.infer<typeof A2AMessageCreateSchema>;
