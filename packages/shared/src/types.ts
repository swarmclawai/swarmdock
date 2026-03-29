import type { Scope } from './constants.js';

export interface Agent {
  id: string;
  did: string;
  publicKey: string; // base64 encoded
  displayName: string;
  description: string | null;
  framework: string | null;
  frameworkVersion: string | null;
  modelProvider: string | null;
  modelName: string | null;
  walletAddress: string;
  trustLevel: number;
  dailySpendingLimit: string | null;
  agentCardUrl: string | null;
  status: string;
  lastHeartbeat: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSkill {
  id: string;
  agentId: string;
  skillId: string;
  skillName: string;
  description: string;
  category: string;
  tags: string[];
  pricingModel: string;
  basePrice: string;
  currency: string;
  examplePrompts: string[];
  tasksCompleted: number;
  avgQualityScore: number | null;
  createdAt: string;
}

export interface Task {
  id: string;
  requesterId: string;
  assigneeId: string | null;
  title: string;
  description: string;
  skillRequirements: string[];
  inputData: unknown;
  matchingMode: string;
  budgetMin: string | null;
  budgetMax: string;
  currency: string;
  finalPrice: string | null;
  status: string;
  deadline: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  resultArtifacts: unknown;
  resultFiles: string[] | null;
  qualityScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskBid {
  id: string;
  taskId: string;
  bidderId: string;
  proposedPrice: string;
  confidenceScore: number | null;
  estimatedDuration: string | null;
  proposal: string | null;
  portfolioRefs: string[] | null;
  status: string;
  createdAt: string;
}

export interface EscrowTransaction {
  id: string;
  taskId: string;
  payerId: string;
  payeeId: string | null;
  amount: string;
  platformFee: string | null;
  status: string;
  escrowTxHash: string | null;
  releaseTxHash: string | null;
  network: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRating {
  id: string;
  taskId: string;
  raterId: string;
  rateeId: string;
  qualityScore: number;
  speedScore: number | null;
  communicationScore: number | null;
  reliabilityScore: number | null;
  comment: string | null;
  createdAt: string;
}

export interface AATPayload {
  sub: string; // DID
  agent_id: string;
  trust_level: number;
  scopes: Scope[];
  iat: number;
  exp: number;
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  skills: AgentCardSkill[];
  authentication?: {
    schemes: string[];
    credentials?: string;
  };
}

export interface AgentCardSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface SSEEvent {
  type: string;
  data: unknown;
  timestamp: string;
}
