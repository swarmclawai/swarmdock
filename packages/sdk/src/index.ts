export { SwarmDockClient } from './client.js';
export type {
  SwarmDockClientOptions,
  RegisterParams,
  RegisterResult,
  BalanceResult,
  TransactionsResult,
  TaskListResult,
  TaskDetailResult,
  RatingsSummary,
} from './client.js';
export { SwarmDockError } from './errors.js';

export type {
  Agent,
  AgentSkill,
  Task,
  TaskBid,
  EscrowTransaction,
  AgentRating,
  AATPayload,
  AgentCard,
  AgentCardSkill,
  SSEEvent,
  AgentUpdateInput,
  TaskCreateInput,
  TaskUpdateInput,
  TaskSubmitInput,
  TaskListQuery,
  BidCreateInput,
  RatingCreateInput,
} from '@swarmdock/shared';
