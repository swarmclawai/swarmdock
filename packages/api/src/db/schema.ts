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
} from 'drizzle-orm/pg-core';

const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverParam: string }>({
    dataType() { return `vector(${dimensions})`; },
    toDriver(value: number[]) { return `[${value.join(',')}]`; },
    fromDriver(value: unknown) {
      return String(value).replace(/[\[\]]/g, '').split(',').map(Number);
    },
  })(name);

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  did: text('did').unique().notNull(),
  publicKey: text('public_key').notNull(), // base64 encoded Ed25519 (32 bytes)
  displayName: text('display_name').notNull(),
  description: text('description'),
  framework: text('framework'),
  frameworkVersion: text('framework_version'),
  modelProvider: text('model_provider'),
  modelName: text('model_name'),
  walletAddress: text('wallet_address').notNull(),
  trustLevel: integer('trust_level').default(0).notNull(),
  dailySpendingLimit: bigint('daily_spending_limit', { mode: 'bigint' }),
  agentCardUrl: text('agent_card_url'),
  status: text('status').default('pending').notNull(),
  lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  descriptionEmbedding: vector('description_embedding', 768),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const agentSkills = pgTable('agent_skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  skillId: text('skill_id').notNull(),
  skillName: text('skill_name').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull(),
  tags: text('tags').array().default([]).notNull(),
  pricingModel: text('pricing_model').default('per-task').notNull(),
  basePrice: bigint('base_price', { mode: 'bigint' }).notNull(),
  currency: text('currency').default('USDC').notNull(),
  examplePrompts: text('example_prompts').array().default([]).notNull(),
  skillEmbedding: vector('skill_embedding', 768),
  tasksCompleted: integer('tasks_completed').default(0).notNull(),
  avgQualityScore: real('avg_quality_score'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('agent_skill_unique').on(table.agentId, table.skillId),
]);

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  requesterId: uuid('requester_id').references(() => agents.id).notNull(),
  assigneeId: uuid('assignee_id').references(() => agents.id),
  title: text('title').notNull(),
  description: text('description').notNull(),
  skillRequirements: text('skill_requirements').array().notNull(),
  inputData: jsonb('input_data'),
  matchingMode: text('matching_mode').default('open').notNull(),
  budgetMin: bigint('budget_min', { mode: 'bigint' }),
  budgetMax: bigint('budget_max', { mode: 'bigint' }).notNull(),
  currency: text('currency').default('USDC').notNull(),
  finalPrice: bigint('final_price', { mode: 'bigint' }),
  status: text('status').default('open').notNull(),
  deadline: timestamp('deadline', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  resultArtifacts: jsonb('result_artifacts'),
  resultFiles: text('result_files').array(),
  descriptionEmbedding: vector('description_embedding', 768),
  qualityScore: real('quality_score'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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
]);

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

export const agentRatings = pgTable('agent_ratings', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id).notNull(),
  raterId: uuid('rater_id').references(() => agents.id).notNull(),
  rateeId: uuid('ratee_id').references(() => agents.id).notNull(),
  qualityScore: integer('quality_score').notNull(),
  speedScore: integer('speed_score'),
  communicationScore: integer('communication_score'),
  reliabilityScore: integer('reliability_score'),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('rating_unique').on(table.taskId, table.raterId),
]);

export const disputes = pgTable('disputes', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }).notNull(),
  raisedByAgentId: uuid('raised_by_agent_id').references(() => agents.id).notNull(),
  againstAgentId: uuid('against_agent_id').references(() => agents.id),
  reason: text('reason').notNull(),
  status: text('status').default('open').notNull(),
  resolution: text('resolution'),
  resolutionNotes: text('resolution_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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

export const challenges = pgTable('challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  publicKey: text('public_key').notNull(),
  challenge: text('challenge').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  used: boolean('used').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
