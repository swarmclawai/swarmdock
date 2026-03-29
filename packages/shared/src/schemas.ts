import { z } from 'zod';
import { TASK_STATUS, MATCHING_MODE, PRICING_MODEL, BID_STATUS, SCOPES } from './constants.js';

// Agent registration
export const AgentRegisterSchema = z.object({
  publicKey: z.string().min(1, 'Public key is required'),
  displayName: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  framework: z.string().optional(),
  frameworkVersion: z.string().optional(),
  modelProvider: z.string().optional(),
  modelName: z.string().optional(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  agentCardUrl: z.string().url().optional(),
  skills: z.array(z.object({
    skillId: z.string().min(1),
    skillName: z.string().min(1),
    description: z.string().min(1),
    category: z.string().min(1),
    tags: z.array(z.string()).default([]),
    pricingModel: z.enum([
      PRICING_MODEL.PER_TASK,
      PRICING_MODEL.PER_HOUR,
      PRICING_MODEL.PER_TOKEN,
      PRICING_MODEL.PER_REQUEST,
      PRICING_MODEL.CUSTOM,
    ]).default(PRICING_MODEL.PER_TASK),
    basePrice: z.string().min(1), // USDC amount as string (6 decimals)
    examplePrompts: z.array(z.string()).default([]),
  })).default([]),
});

export const AgentVerifySchema = z.object({
  publicKey: z.string().min(1),
  challenge: z.string().min(1),
  signature: z.string().min(1),
});

export const AgentUpdateSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  framework: z.string().optional(),
  frameworkVersion: z.string().optional(),
  modelProvider: z.string().optional(),
  modelName: z.string().optional(),
  agentCardUrl: z.string().url().optional(),
  dailySpendingLimit: z.string().optional(),
});

// Tasks
export const TaskCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(10000),
  skillRequirements: z.array(z.string().min(1)).min(1),
  inputData: z.unknown().optional(),
  matchingMode: z.enum([
    MATCHING_MODE.DIRECT,
    MATCHING_MODE.OPEN,
    MATCHING_MODE.AUTO,
  ]).default(MATCHING_MODE.OPEN),
  budgetMin: z.string().optional(),
  budgetMax: z.string().min(1),
  deadline: z.string().datetime().optional(),
  directAssigneeId: z.string().uuid().optional(), // for direct matching
});

export const TaskUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().min(1).max(10000).optional(),
  deadline: z.string().datetime().optional(),
});

export const TaskSubmitSchema = z.object({
  artifacts: z.array(z.object({
    type: z.string(),
    content: z.unknown(),
  })).min(1),
  files: z.array(z.string().url()).default([]),
  notes: z.string().max(5000).optional(),
});

export const TaskListQuerySchema = z.object({
  status: z.string().optional(),
  skills: z.string().optional(), // comma-separated
  budgetMin: z.string().optional(),
  budgetMax: z.string().optional(),
  requesterId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

// Bids
export const BidCreateSchema = z.object({
  proposedPrice: z.string().min(1),
  confidenceScore: z.number().min(0).max(1).optional(),
  estimatedDuration: z.string().optional(), // ISO 8601 duration
  proposal: z.string().max(5000).optional(),
  portfolioRefs: z.array(z.string().url()).default([]),
});

// Ratings
export const RatingCreateSchema = z.object({
  taskId: z.string().uuid(),
  rateeId: z.string().uuid(),
  qualityScore: z.number().int().min(1).max(5),
  speedScore: z.number().int().min(1).max(5).optional(),
  communicationScore: z.number().int().min(1).max(5).optional(),
  reliabilityScore: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(2000).optional(),
});

export type AgentRegisterInput = z.infer<typeof AgentRegisterSchema>;
export type AgentVerifyInput = z.infer<typeof AgentVerifySchema>;
export type AgentUpdateInput = z.infer<typeof AgentUpdateSchema>;
export type TaskCreateInput = z.infer<typeof TaskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof TaskUpdateSchema>;
export type TaskSubmitInput = z.infer<typeof TaskSubmitSchema>;
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
export type BidCreateInput = z.infer<typeof BidCreateSchema>;
export type RatingCreateInput = z.infer<typeof RatingCreateSchema>;
