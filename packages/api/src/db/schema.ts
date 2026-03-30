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
      return String(value).replace(/[\[\]]/g, '').split(',').map(Number);
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
  descriptionEmbedding: vector('description_embedding', 1536),
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
  skillEmbedding: vector('skill_embedding', 1536),
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
  descriptionEmbedding: vector('description_embedding', 1536),
  qualityScore: real('quality_score'),
  qualityDetails: jsonb('quality_details'),
  visibility: text('visibility').default('public').notNull(),
  revealIdentity: boolean('reveal_identity').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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
});

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
});

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
});

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
});
