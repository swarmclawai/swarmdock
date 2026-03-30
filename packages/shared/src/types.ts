import type { Scope, ReputationDimension } from './constants.js';

export interface Agent {
  id: string;
  did: string;
  publicKey: string; // base64 encoded
  displayName: string;
  description: string | null;
  avatarUrl: string | null;
  ownerDid: string | null;
  framework: string | null;
  frameworkVersion: string | null;
  modelProvider: string | null;
  modelName: string | null;
  agentCard: unknown;
  walletAddress: string;
  trustLevel: number;
  dailySpendingLimit: string | null;
  earningTotal: string | null;
  agentCardUrl: string | null;
  status: string;
  verifiedAt: string | null;
  lastHeartbeat: string | null;
  lastActiveAt: string | null;
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
  inputModes: string[];
  outputModes: string[];
  pricingModel: string;
  basePrice: string;
  currency: string;
  examplePrompts: string[];
  benchmarkScores: unknown;
  sampleOutputs: unknown;
  tasksCompleted: number;
  avgCompletionTime: string | null;
  avgQualityScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  requesterId: string;
  assigneeId: string | null;
  title: string;
  description: string;
  skillRequirements: string[];
  inputData: unknown;
  inputFiles: string[] | null;
  matchingMode: string;
  budgetMin: string | null;
  budgetMax: string;
  currency: string;
  finalPrice: string | null;
  platformFee: string | null;
  paymentTxId: string | null;
  status: string;
  deadline: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  resultArtifacts: unknown;
  resultFiles: string[] | null;
  qualityScore: number | null;
  qualityDetails: unknown;
  visibility: string;
  revealIdentity: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInvitation {
  id: string;
  taskId: string;
  agentId: string;
  source: string;
  status: string;
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

export interface Dispute {
  id: string;
  taskId: string;
  raisedByAgentId: string;
  againstAgentId: string | null;
  reason: string;
  evidence: unknown;
  status: string;
  resolution: string | null;
  resolutionNotes: string | null;
  tribunalAgents: string[] | null;
  tribunalVotes: unknown;
  verdict: string | null;
  createdAt: string;
  resolvedAt: string | null;
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
  valueScore: number | null;
  overallScore: number;
  evidence: unknown;
  comment: string | null;
  raterReputationAtTime: number | null;
  weight: number | null;
  createdAt: string;
}

export interface AgentReputationRecord {
  agentId: string;
  dimension: ReputationDimension;
  score: number;
  confidence: number;
  totalRatings: number;
  recentTrend: number | null;
  updatedAt: string;
}

export interface PortfolioItem {
  id?: string;
  agentId?: string;
  taskId: string;
  title: string;
  description: string;
  category?: string;
  completedAt: string;
  qualityScore: number | null;
  requester: {
    id: string;
    displayName: string;
  } | null;
  artifacts: unknown[];
  files: string[];
  isPinned?: boolean;
  displayOrder?: number;
}

export interface Transaction {
  id: string;
  taskId: string | null;
  type: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  amount: string;
  currency: string;
  txHash: string | null;
  blockNumber: string | null;
  network: string | null;
  status: string;
  createdAt: string;
  confirmedAt: string | null;
}

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  eventType: string;
  actorId: string | null;
  targetId: string | null;
  targetType: string | null;
  payload: unknown;
  hash: string;
  previousHash: string | null;
}

export interface StoredArtifactRef {
  key: string;
  url: string;
  contentType: string;
  byteLength: number;
  source: 'inline' | 'file';
  originalUrl?: string;
}

export type PremiumTier = 'free' | 'pro';

export interface AATPayload {
  sub: string; // DID
  agent_id: string;
  trust_level: number;
  scopes: Scope[];
  premiumTier?: PremiumTier;
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

export interface QualityReport {
  overallScore: number;
  checks: QualityCheck[];
  passed: boolean;
}

export interface QualityCheck {
  name: string;
  score: number;
  passed: boolean;
  details?: string;
}
