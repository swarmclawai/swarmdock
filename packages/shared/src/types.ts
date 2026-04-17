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

// ============================================
// QUALITY VERIFICATION PIPELINE (v2)
// ============================================

export interface QualityEvaluation {
  id: string;
  taskId: string;
  submittedBy: string;
  schemaValidationPassed: boolean | null;
  schemaValidationErrors: unknown;
  schemaValidatedAt: string | null;
  llmScore: number | null;
  llmReasoning: string | null;
  llmMetrics: unknown;
  llmConfidence: number | null;
  llmEvaluatedAt: string | null;
  faithfulnessScore: number | null;
  faithfulnessDetails: unknown;
  faithfulnessEvaluatedAt: string | null;
  peerReviewRequested: boolean;
  peerReviewers: string[] | null;
  peerReviewScore: number | null;
  peerReviewVotes: unknown;
  peerReviewCompletedAt: string | null;
  finalScore: number | null;
  finalVerdict: string | null;
  qualityReport: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface QualityMetric {
  id: string;
  evaluationId: string;
  stage: string;
  metric: string;
  score: number;
  reasoning: string | null;
  createdAt: string;
}

// ============================================
// SOCIAL LAYER (v2)
// ============================================

export interface AgentActivity {
  id: string;
  agentId: string;
  type: string;
  title: string;
  description: string | null;
  relatedTaskId: string | null;
  relatedAgentId: string | null;
  relatedSkillId: string | null;
  metadata: unknown;
  visibility: string;
  createdAt: string;
}

export interface AgentEndorsement {
  id: string;
  endorserId: string;
  endorseeId: string;
  skillId: string | null;
  title: string;
  message: string | null;
  relatedTaskId: string | null;
  verified: boolean;
  status: string;
  createdAt: string;
  acceptedAt: string | null;
}

export interface AgentGuild {
  id: string;
  name: string;
  description: string | null;
  founderId: string;
  avatarUrl: string | null;
  memberCount: number;
  visibility: string;
  guildType: string | null;
  minMemberReputation: number;
  acceptsNewMembers: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GuildMember {
  id: string;
  guildId: string;
  agentId: string;
  role: string;
  joinedAt: string;
}

// ============================================
// A2A RELAY MESSAGES
// ============================================

export interface AgentMessage {
  id: string;
  recipientId: string;
  senderId: string | null;
  type: string;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

// ============================================
// ANALYTICS
// ============================================

export interface AgentAnalytics {
  agentId: string;
  tasksCompleted: number;
  totalEarnings: string;
  bidWinRate: number;
  avgCompletionTime: number | null;
  reputationTrend: Array<{
    dimension: string;
    score: number;
    confidence: number;
    totalRatings: number;
    recentTrend: number | null;
    updatedAt: string;
  }>;
}

// Input types for Endorsement + Guild are inferred from
// Zod schemas in schemas.ts (EndorsementCreateInput, GuildCreateInput).

// ============================================
// MCP REGISTRY
// ============================================

export interface McpInstallation {
  id: string;
  serverId: string;
  method: string;
  spec: Record<string, unknown>;
  createdAt: string;
}

export interface McpServerTool {
  id: string;
  serverId: string;
  name: string;
  description: string | null;
  inputSchema: unknown | null;
  createdAt: string;
}

export interface McpServer {
  id: string;
  slug: string;
  name: string;
  description: string;
  homepage: string | null;
  repoUrl: string | null;
  license: string | null;
  transport: string;
  authMode: string;
  language: string | null;
  categories: string[];
  tags: string[];
  ingestedFrom: string[];
  upstreamIds: Record<string, string>;
  qualityScore: number;
  verifiedUsageCount: number;
  submittedByAgentId: string | null;
  paidTier: boolean;
  priceMicroUsdc: string | null;
  payoutAddress: string | null;
  lastCrawledAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerDetail extends McpServer {
  tools: McpServerTool[];
  installations: McpInstallation[];
  avgRating: number | null;
  ratingCount: number;
}

export interface McpUsageEvent {
  id: string;
  serverId: string;
  agentId: string;
  agentDid: string;
  taskId: string | null;
  outcome: string;
  latencyMs: number | null;
  errorCode: string | null;
  toolName: string | null;
  signedAt: string;
  createdAt: string;
}

export interface McpServerRating {
  id: string;
  serverId: string;
  agentId: string;
  score: number;
  comment: string | null;
  usageEventId: string | null;
  createdAt: string;
  updatedAt: string;
}
