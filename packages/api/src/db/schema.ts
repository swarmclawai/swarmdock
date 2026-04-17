import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  bigint,
  uniqueIndex,
  customType,
  serial,
  index,
} from 'drizzle-orm/pg-core';

const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverParam: string }>({
    dataType() { return `vector(${dimensions})`; },
    toDriver(value: number[]) { return `[${value.join(',')}]`; },
    fromDriver(value: unknown) {
      return String(value).replace(/[[\]]/g, '').split(',').map(Number);
    },
  })(name);

// ============================================
// AGENT IDENTITY & REGISTRY
// ============================================

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  did: text('did').unique().notNull(),
  publicKey: text('public_key').notNull(), // base64 encoded Ed25519 (32 bytes)
  displayName: text('display_name').notNull(),
  description: text('description'),
  avatarUrl: text('avatar_url'),
  ownerDid: text('owner_did'),
  framework: text('framework'),
  frameworkVersion: text('framework_version'),
  modelProvider: text('model_provider'),
  modelName: text('model_name'),
  agentCard: jsonb('agent_card'), // A2A Agent Card stored inline
  walletAddress: text('wallet_address').notNull(),
  trustLevel: integer('trust_level').default(0).notNull(),
  dailySpendingLimit: bigint('daily_spending_limit', { mode: 'bigint' }),
  earningTotal: bigint('earning_total', { mode: 'bigint' }).default(0n),
  agentCardUrl: text('agent_card_url'),
  premiumTier: text('premium_tier'), // null = free, 'pro' = premium
  isVerifiedBadge: boolean('is_verified_badge').default(false).notNull(),
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret'),
  webhookEvents: text('webhook_events').array(), // event types to deliver, null = all
  mcpEndpoint: text('mcp_endpoint'),
  mcpCapabilities: jsonb('mcp_capabilities'), // MCP tools + resources
  status: text('status').default('pending').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  descriptionEmbedding: vector('description_embedding', 768),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// AGENT CAPABILITIES / SKILLS
// ============================================

export const agentSkills = pgTable('agent_skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  skillId: text('skill_id').notNull(),
  skillName: text('skill_name').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull(),
  tags: text('tags').array().default([]).notNull(),
  inputModes: text('input_modes').array().default(['text']).notNull(),
  outputModes: text('output_modes').array().default(['text']).notNull(),
  pricingModel: text('pricing_model').default('per-task').notNull(),
  basePrice: bigint('base_price', { mode: 'bigint' }).notNull(),
  currency: text('currency').default('USDC').notNull(),
  examplePrompts: text('example_prompts').array().default([]).notNull(),
  benchmarkScores: jsonb('benchmark_scores'),
  sampleOutputs: jsonb('sample_outputs'),
  skillEmbedding: vector('skill_embedding', 768),
  tasksCompleted: integer('tasks_completed').default(0).notNull(),
  avgCompletionTime: text('avg_completion_time'), // ISO 8601 duration
  avgQualityScore: real('avg_quality_score'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('agent_skill_unique').on(table.agentId, table.skillId),
]);

// ============================================
// TASKS
// ============================================

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  requesterId: uuid('requester_id').references(() => agents.id).notNull(),
  assigneeId: uuid('assignee_id').references(() => agents.id),
  title: text('title').notNull(),
  description: text('description').notNull(),
  skillRequirements: text('skill_requirements').array().notNull(),
  inputData: jsonb('input_data'),
  inputFiles: text('input_files').array(),
  matchingMode: text('matching_mode').default('open').notNull(),
  budgetMin: bigint('budget_min', { mode: 'bigint' }),
  budgetMax: bigint('budget_max', { mode: 'bigint' }).notNull(),
  currency: text('currency').default('USDC').notNull(),
  finalPrice: bigint('final_price', { mode: 'bigint' }),
  platformFee: bigint('platform_fee', { mode: 'bigint' }),
  paymentTxId: text('payment_tx_id'),
  status: text('status').default('open').notNull(),
  deadline: timestamp('deadline', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  resultArtifacts: jsonb('result_artifacts'),
  resultFiles: text('result_files').array(),
  descriptionEmbedding: vector('description_embedding', 768),
  qualityScore: real('quality_score'),
  qualityDetails: jsonb('quality_details'),
  visibility: text('visibility').default('public').notNull(),
  revealIdentity: boolean('reveal_identity').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_tasks_status').on(table.status),
  index('idx_tasks_requester_id').on(table.requesterId),
  index('idx_tasks_assignee_id').on(table.assigneeId),
  index('idx_tasks_status_created').on(table.status, table.createdAt),
  index('idx_tasks_requester_created').on(table.requesterId, table.createdAt),
]);

// ============================================
// TASK INVITATIONS
// ============================================

export const taskInvitations = pgTable('task_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }).notNull(),
  agentId: uuid('agent_id').references(() => agents.id).notNull(),
  source: text('source').default('direct').notNull(),
  status: text('status').default('pending').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('task_invitation_unique').on(table.taskId, table.agentId),
  index('idx_task_invitations_task_id').on(table.taskId),
  index('idx_task_invitations_agent_id').on(table.agentId),
]);

// ============================================
// TASK BIDS
// ============================================

export const taskBids = pgTable('task_bids', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }).notNull(),
  bidderId: uuid('bidder_id').references(() => agents.id).notNull(),
  proposedPrice: bigint('proposed_price', { mode: 'bigint' }).notNull(),
  confidenceScore: real('confidence_score'),
  estimatedDuration: text('estimated_duration'),
  proposal: text('proposal'),
  portfolioRefs: text('portfolio_refs').array(),
  status: text('status').default('pending').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('task_bid_unique').on(table.taskId, table.bidderId),
  index('idx_task_bids_task_id').on(table.taskId),
]);

// ============================================
// ESCROW TRANSACTIONS
// ============================================

export const escrowTransactions = pgTable('escrow_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id).notNull(),
  payerId: uuid('payer_id').references(() => agents.id).notNull(),
  payeeId: uuid('payee_id').references(() => agents.id),
  amount: bigint('amount', { mode: 'bigint' }).notNull(),
  platformFee: bigint('platform_fee', { mode: 'bigint' }),
  status: text('status').default('pending').notNull(),
  escrowTxHash: text('escrow_tx_hash'),
  releaseTxHash: text('release_tx_hash'),
  network: text('network').default('base-sepolia').notNull(),
  retryCount: integer('retry_count').default(0).notNull(),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_escrow_task_status').on(table.taskId, table.status),
]);

// ============================================
// RATINGS (float 0-1 scale, weighted)
// ============================================

export const agentRatings = pgTable('agent_ratings', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id).notNull(),
  raterId: uuid('rater_id').references(() => agents.id).notNull(),
  rateeId: uuid('ratee_id').references(() => agents.id).notNull(),
  qualityScore: real('quality_score').notNull(),
  speedScore: real('speed_score'),
  communicationScore: real('communication_score'),
  reliabilityScore: real('reliability_score'),
  valueScore: real('value_score'),
  overallScore: real('overall_score').notNull(),
  evidence: jsonb('evidence'),
  comment: text('comment'),
  raterReputationAtTime: real('rater_reputation_at_time'),
  weight: real('weight').default(1.0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('rating_unique').on(table.taskId, table.raterId),
  index('idx_ratings_ratee').on(table.rateeId),
]);

// ============================================
// REPUTATION (multi-dimensional, per agent)
// ============================================

export const agentReputation = pgTable('agent_reputation', {
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  dimension: text('dimension').notNull(), // quality, reliability, speed, communication, value
  score: real('score').default(0.5).notNull(),
  confidence: real('confidence').default(0).notNull(),
  totalRatings: integer('total_ratings').default(0).notNull(),
  recentTrend: real('recent_trend').default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('agent_reputation_pk').on(table.agentId, table.dimension),
]);

// ============================================
// PORTFOLIO ITEMS (curated)
// ============================================

export const portfolioItems = pgTable('portfolio_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  taskId: uuid('task_id').references(() => tasks.id),
  title: text('title').notNull(),
  description: text('description'),
  category: text('category').notNull(),
  artifacts: jsonb('artifacts'),
  files: text('files').array(),
  qualityScore: real('quality_score'),
  completionTime: text('completion_time'), // ISO 8601 duration
  requesterRating: real('requester_rating'),
  isPinned: boolean('is_pinned').default(false).notNull(),
  displayOrder: integer('display_order').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_portfolio_agent').on(table.agentId),
]);

// ============================================
// AUDIT LOG (immutable, hash-chained)
// ============================================

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  eventType: text('event_type').notNull(),
  actorId: uuid('actor_id'),
  targetId: uuid('target_id'),
  targetType: text('target_type'), // agent, task, bid, rating, dispute
  payload: jsonb('payload').notNull(),
  hash: text('hash').notNull(),
  previousHash: text('previous_hash'),
}, (table) => [
  index('idx_audit_timestamp').on(table.timestamp),
  index('idx_audit_event_type').on(table.eventType),
  index('idx_audit_actor').on(table.actorId),
]);

// ============================================
// TRANSACTIONS (full financial audit trail)
// ============================================

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id),
  type: text('type').notNull(), // escrow_deposit, escrow_release, escrow_refund, platform_fee, tribunal_fee, dispute_refund
  fromAgentId: uuid('from_agent_id').references(() => agents.id),
  toAgentId: uuid('to_agent_id').references(() => agents.id),
  amount: bigint('amount', { mode: 'bigint' }).notNull(),
  currency: text('currency').default('USDC').notNull(),
  txHash: text('tx_hash'),
  blockNumber: bigint('block_number', { mode: 'bigint' }),
  network: text('network').default('base-sepolia'),
  status: text('status').default('pending').notNull(), // pending, confirmed, failed
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
}, (table) => [
  index('idx_transactions_task').on(table.taskId),
  index('idx_transactions_type').on(table.type),
  index('idx_transactions_from').on(table.fromAgentId),
  index('idx_transactions_to').on(table.toAgentId),
  index('idx_transactions_status').on(table.status),
]);

// ============================================
// DISPUTES (with tribunal support)
// ============================================

export const disputes = pgTable('disputes', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }).notNull(),
  raisedByAgentId: uuid('raised_by_agent_id').references(() => agents.id).notNull(),
  againstAgentId: uuid('against_agent_id').references(() => agents.id),
  reason: text('reason').notNull(),
  evidence: jsonb('evidence'),
  status: text('status').default('open').notNull(), // open, tribunal, resolved, escalated
  resolution: text('resolution'),
  resolutionNotes: text('resolution_notes'),
  tribunalAgents: text('tribunal_agents').array(), // UUIDs of 3 tribunal judges
  tribunalVotes: jsonb('tribunal_votes'), // { agentId: verdict }
  verdict: text('verdict'), // requester_wins, assignee_wins, split
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_disputes_status').on(table.status),
  index('idx_disputes_task_id').on(table.taskId),
]);

// ============================================
// EVENT OUTBOX (reliable event delivery)
// ============================================

export const eventOutbox = pgTable('event_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  subject: text('subject').notNull(),
  target: text('target').notNull(),
  agentId: uuid('agent_id').references(() => agents.id),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').default('pending').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  lastError: text('last_error'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_event_outbox_status_created').on(table.status, table.createdAt),
]);

// ============================================
// AGENT WALLETS (CDP wallet persistence)
// ============================================

export const agentWallets = pgTable('agent_wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  address: text('address').notNull(),
  network: text('network').notNull(),
  encryptedWalletData: text('encrypted_wallet_data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('agent_wallet_unique').on(table.agentId),
]);

// ============================================
// AGENT MESSAGES (A2A proxy relay)
// ============================================

export const agentMessages = pgTable('agent_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipientId: uuid('recipient_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  senderId: uuid('sender_id').references(() => agents.id),
  type: text('type').notNull(), // task.created, task.assigned, payment.released, a2a.message, etc.
  payload: jsonb('payload').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_agent_messages_recipient').on(table.recipientId),
  index('idx_agent_messages_unread').on(table.recipientId, table.readAt),
]);

// ============================================
// ANOMALY EVENTS (governance detection results)
// ============================================

export const anomalyEvents = pgTable('anomaly_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  type: text('type').notNull(), // rapid_bidding, rating_manipulation, dormancy_evasion
  severity: text('severity').notNull(), // low, medium, high
  details: text('details').notNull(),
  actionTaken: text('action_taken').default('none').notNull(), // none, warned, suspended
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_anomaly_events_agent').on(table.agentId),
  index('idx_anomaly_events_type').on(table.type),
  index('idx_anomaly_events_severity').on(table.severity),
]);

// ============================================
// CHALLENGES (auth challenge-response)
// ============================================

export const challenges = pgTable('challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  publicKey: text('public_key').notNull(),
  challenge: text('challenge').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  used: boolean('used').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_challenges_pubkey_used').on(table.publicKey, table.used),
]);

// ============================================
// QUALITY EVALUATIONS (v2 pipeline)
// ============================================

export const qualityEvaluations = pgTable('quality_evaluations', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }).notNull(),
  submittedBy: uuid('submitted_by').references(() => agents.id).notNull(),

  // Stage 1: Schema validation
  schemaValidationPassed: boolean('schema_validation_passed'),
  schemaValidationErrors: jsonb('schema_validation_errors'),
  schemaValidatedAt: timestamp('schema_validated_at', { withTimezone: true }),

  // Stage 2: LLM judge
  llmScore: real('llm_score'),
  llmReasoning: text('llm_reasoning'),
  llmMetrics: jsonb('llm_metrics'),
  llmConfidence: real('llm_confidence'),
  llmEvaluatedAt: timestamp('llm_evaluated_at', { withTimezone: true }),

  // Stage 3: Faithfulness
  faithfulnessScore: real('faithfulness_score'),
  faithfulnessDetails: jsonb('faithfulness_details'),
  faithfulnessEvaluatedAt: timestamp('faithfulness_evaluated_at', { withTimezone: true }),

  // Stage 4: Peer review
  peerReviewRequested: boolean('peer_review_requested').default(false).notNull(),
  peerReviewers: uuid('peer_reviewers').array(),
  peerReviewScore: real('peer_review_score'),
  peerReviewVotes: jsonb('peer_review_votes'),
  peerReviewCompletedAt: timestamp('peer_review_completed_at', { withTimezone: true }),
  peerReviewDeadlineAt: timestamp('peer_review_deadline_at', { withTimezone: true }),
  peerReviewDeclined: uuid('peer_review_declined').array(),

  // Final composite
  finalScore: real('final_score'),
  finalVerdict: text('final_verdict'),
  qualityReport: jsonb('quality_report'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_quality_eval_task').on(table.taskId),
  index('idx_quality_eval_submitted_by').on(table.submittedBy),
]);

export const qualityMetrics = pgTable('quality_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  evaluationId: uuid('evaluation_id').references(() => qualityEvaluations.id, { onDelete: 'cascade' }).notNull(),
  stage: text('stage').notNull(),
  metric: text('metric').notNull(),
  score: real('score').notNull(),
  reasoning: text('reasoning'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_quality_metrics_eval').on(table.evaluationId),
]);

// ============================================
// AGENT ACTIVITY FEED (v2 social)
// ============================================

export const agentActivity = pgTable('agent_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  relatedTaskId: uuid('related_task_id').references(() => tasks.id),
  relatedAgentId: uuid('related_agent_id').references(() => agents.id),
  relatedSkillId: text('related_skill_id'),
  metadata: jsonb('metadata'),
  visibility: text('visibility').default('public').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_activity_agent').on(table.agentId),
  index('idx_activity_created').on(table.createdAt),
  index('idx_activity_type').on(table.type),
]);

// ============================================
// AGENT ENDORSEMENTS (v2 social)
// ============================================

export const agentEndorsements = pgTable('agent_endorsements', {
  id: uuid('id').primaryKey().defaultRandom(),
  endorserId: uuid('endorser_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  endorseeId: uuid('endorsee_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  skillId: text('skill_id'),
  title: text('title').notNull(),
  message: text('message'),
  relatedTaskId: uuid('related_task_id').references(() => tasks.id),
  verified: boolean('verified').default(false).notNull(),
  status: text('status').default('pending').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
}, (table) => [
  index('idx_endorsements_endorsee').on(table.endorseeId),
  index('idx_endorsements_endorser').on(table.endorserId),
]);

// ============================================
// AGENT FOLLOWING (v2 social graph)
// ============================================

export const agentFollowing = pgTable('agent_following', {
  id: uuid('id').primaryKey().defaultRandom(),
  followerId: uuid('follower_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  followeeId: uuid('followee_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('agent_following_unique').on(table.followerId, table.followeeId),
  index('idx_following_follower').on(table.followerId),
  index('idx_following_followee').on(table.followeeId),
]);

// ============================================
// AGENT GUILDS (v2 social)
// ============================================

export const agentGuilds = pgTable('agent_guilds', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  founderId: uuid('founder_id').references(() => agents.id).notNull(),
  avatarUrl: text('avatar_url'),
  memberCount: integer('member_count').default(1).notNull(),
  visibility: text('visibility').default('public').notNull(),
  guildType: text('guild_type'),
  minMemberReputation: integer('min_member_reputation').default(0).notNull(),
  acceptsNewMembers: boolean('accepts_new_members').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const guildMembers = pgTable('guild_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  guildId: uuid('guild_id').references(() => agentGuilds.id, { onDelete: 'cascade' }).notNull(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').default('member').notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('guild_member_unique').on(table.guildId, table.agentId),
]);

// ============================================
// MCP REGISTRY
// ============================================
// Public directory of Model Context Protocol servers. Agents record signed
// usage attestations which feed the quality score; server authors may opt
// into paid-tier listings settled through the existing x402 pipeline.

export const mcpServers = pgTable('mcp_servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  homepage: text('homepage'),
  repoUrl: text('repo_url'),
  license: text('license'),
  transport: text('transport').notNull(),
  authMode: text('auth_mode').notNull().default('none'),
  language: text('language'),
  categories: text('categories').array().default([]).notNull(),
  tags: text('tags').array().default([]).notNull(),
  ingestedFrom: text('ingested_from').array().default([]).notNull(),
  upstreamIds: jsonb('upstream_ids').default({}).notNull(),
  qualityScore: real('quality_score').default(0).notNull(),
  verifiedUsageCount: integer('verified_usage_count').default(0).notNull(),
  submittedByAgentId: uuid('submitted_by_agent_id').references(() => agents.id),
  paidTier: boolean('paid_tier').default(false).notNull(),
  priceMicroUsdc: bigint('price_micro_usdc', { mode: 'bigint' }),
  payoutAddress: text('payout_address'),
  descriptionEmbedding: vector('description_embedding', 768),
  lastCrawledAt: timestamp('last_crawled_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('mcp_servers_slug_idx').on(table.slug),
  index('mcp_servers_quality_idx').on(table.qualityScore),
  index('mcp_servers_transport_idx').on(table.transport),
]);

export const mcpServerTools = pgTable('mcp_server_tools', {
  id: uuid('id').primaryKey().defaultRandom(),
  serverId: uuid('server_id').references(() => mcpServers.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  inputSchema: jsonb('input_schema'),
  toolEmbedding: vector('tool_embedding', 768),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('mcp_server_tools_server_name_idx').on(table.serverId, table.name),
]);

export const mcpServerInstallations = pgTable('mcp_server_installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  serverId: uuid('server_id').references(() => mcpServers.id, { onDelete: 'cascade' }).notNull(),
  method: text('method').notNull(),
  spec: jsonb('spec').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('mcp_server_installations_server_idx').on(table.serverId),
]);

export const mcpUsageEvents = pgTable('mcp_usage_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  serverId: uuid('server_id').references(() => mcpServers.id, { onDelete: 'cascade' }).notNull(),
  agentId: uuid('agent_id').references(() => agents.id).notNull(),
  agentDid: text('agent_did').notNull(),
  taskId: uuid('task_id').references(() => tasks.id),
  outcome: text('outcome').notNull(),
  latencyMs: integer('latency_ms'),
  errorCode: text('error_code'),
  toolName: text('tool_name'),
  signature: text('signature').notNull(),
  signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('mcp_usage_events_server_idx').on(table.serverId),
  index('mcp_usage_events_agent_idx').on(table.agentId),
  index('mcp_usage_events_outcome_idx').on(table.outcome),
]);

export const mcpServerRatings = pgTable('mcp_server_ratings', {
  id: uuid('id').primaryKey().defaultRandom(),
  serverId: uuid('server_id').references(() => mcpServers.id, { onDelete: 'cascade' }).notNull(),
  agentId: uuid('agent_id').references(() => agents.id).notNull(),
  score: integer('score').notNull(),
  comment: text('comment'),
  usageEventId: uuid('usage_event_id').references(() => mcpUsageEvents.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('mcp_server_ratings_agent_server_idx').on(table.agentId, table.serverId),
  index('mcp_server_ratings_server_idx').on(table.serverId),
]);

