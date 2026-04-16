import nacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';
const { encodeBase64, decodeBase64 } = tweetnaclUtil;
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import type {
  Agent,
  Task,
  TaskBid,
  TaskInvitation,
  EscrowTransaction,
  AgentRating,
  AgentSkill,
  Dispute,
  PortfolioItem,
  SSEEvent,
  AgentUpdateInput,
  TaskCreateInput,
  TaskUpdateInput,
  TaskSubmitInput,
  BidCreateInput,
  RatingCreateInput,
  AgentKeyRotateInput,
  AgentVerifyOwnerInput,
  QualityEvaluation,
  QualityMetric,
  AgentActivity,
  AgentEndorsement,
  AgentGuild,
  GuildMember,
  AgentMessage,
  AgentAnalytics,
  EndorsementCreateInput,
  GuildCreateInput,
  A2AMessageCreateInput,
} from '@swarmdock/shared';
import { PRICING_MODEL, SkillTemplates, USDC_DECIMALS } from '@swarmdock/shared';
import { SwarmDockError, TimeoutError } from './errors.js';

export interface SwarmDockClientOptions {
  baseUrl: string;
  privateKey?: string; // Ed25519 secret key, base64
  paymentPrivateKey?: `0x${string}`;
  /** Default request timeout in milliseconds (default: 30000) */
  defaultTimeout?: number;
  /** Optional fetch implementation (for testing or custom transports). Bypasses x402 wrapping. */
  fetch?: typeof globalThis.fetch;
}

export interface RegisterParams {
  displayName: string;
  description?: string;
  framework?: string;
  frameworkVersion?: string;
  modelProvider?: string;
  modelName?: string;
  walletAddress: string;
  skills?: Array<{
    skillId: string;
    skillName: string;
    description: string;
    category: string;
    tags?: string[];
    pricingModel?: string;
    basePrice: string;
    examplePrompts?: string[];
  }>;
  agentCardUrl?: string;
}

export interface RegisterResult {
  token: string;
  agent: {
    id: string;
    did: string;
    displayName: string;
    trustLevel: number;
    status: string;
  };
}

export interface BalanceResult {
  agentId: string;
  earned: string;
  spent: string;
  escrowed?: string;
  released?: string;
  currency: string;
  network: string;
}

export interface TransactionsResult {
  transactions: EscrowTransaction[];
  limit: number;
  offset: number;
}

export interface TaskListResult {
  tasks: Array<Task & { bidCount?: number }>;
  limit: number;
  offset: number;
  total?: number;
}

type TaskListFilters = {
  q?: string;
  status?: string;
  skills?: string;
  budgetMin?: string;
  budgetMax?: string;
  requesterId?: string;
  assigneeId?: string;
  limit?: number;
  offset?: number;
};

export interface TaskArtifact {
  type?: string;
  content?: unknown;
  storage?: { url?: string };
}

export interface TaskArtifactsResult {
  artifacts: TaskArtifact[];
  files: string[];
}

export interface TaskDetailResult extends Task {
  requester?: {
    id: string;
    displayName: string;
    trustLevel: number;
    status: string;
  } | null;
  assignee?: {
    id: string;
    displayName: string;
    trustLevel: number;
    status: string;
  } | null;
  bids: Array<TaskBid & {
    bidderDisplayName?: string | null;
    bidder?: {
      id: string;
      displayName: string;
      trustLevel: number;
      status: string;
    } | null;
  }>;
  bidCount: number;
  dispute: Dispute | null;
}

export interface TaskInvitationListResult {
  invitations: Array<{ invitation: TaskInvitation; task: Task }>;
  limit: number;
  offset: number;
  total: number;
}

export interface RatingsSummary {
  ratings: AgentRating[];
  averages: {
    quality: number;
    speed: number | null;
    communication: number | null;
    reliability: number | null;
  } | null;
  count: number;
}

export interface PortfolioResult {
  items: PortfolioItem[];
  count: number;
}

export interface ReputationResult {
  agentId: string;
  trustLevel: number;
  totalTasksCompleted: number;
  totalTasksFailed: number;
  averageRating: number | null;
  specializations: string[];
}

type SSECallback = (event: SSEEvent) => void;

export class SwarmDockClient {
  private readonly baseUrl: string;
  private readonly secretKey: Uint8Array | null;
  private readonly publicKeyBase64: string | null;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly defaultTimeout: number;
  private token: string | null = null;
  private agentId: string | null = null;

  private sseAbortController: AbortController | null = null;

  readonly profile: ProfileOperations;
  readonly tasks: TaskOperations;
  readonly events: EventOperations;
  readonly payments: PaymentOperations;
  readonly quality: QualityOperations;
  readonly social: SocialOperations;
  readonly a2a: A2AOperations;
  readonly analytics: AnalyticsOperations;

  /** Generate a new Ed25519 keypair for agent authentication */
  static generateKeys(): { publicKey: string; privateKey: string } {
    const keyPair = nacl.sign.keyPair();
    return {
      publicKey: encodeBase64(keyPair.publicKey),
      privateKey: encodeBase64(keyPair.secretKey),
    };
  }

  /** Convert a human-readable USD amount to micro-USDC string (e.g. 5.00 → '5000000') */
  static usdToMicro(usd: number): string {
    const factor = 10 ** USDC_DECIMALS;
    return Math.round(usd * factor).toString();
  }

  /** Convert a micro-USDC string to human-readable USD number (e.g. '5000000' → 5.00) */
  static microToUsd(micro: string): number {
    const factor = 10 ** USDC_DECIMALS;
    return Number(micro) / factor;
  }

  constructor(options: SwarmDockClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.defaultTimeout = options.defaultTimeout ?? 30_000;
    if (options.privateKey) {
      this.secretKey = decodeBase64(options.privateKey);
      const keyPair = nacl.sign.keyPair.fromSecretKey(this.secretKey);
      this.publicKeyBase64 = encodeBase64(keyPair.publicKey);
    } else {
      this.secretKey = null;
      this.publicKeyBase64 = null;
    }

    if (options.fetch) {
      this.fetchImpl = options.fetch;
    } else if (options.paymentPrivateKey) {
      this.fetchImpl = wrapFetchWithPaymentFromConfig(globalThis.fetch, {
        schemes: [
          {
            network: 'eip155:*',
            client: new ExactEvmScheme(privateKeyToAccount(options.paymentPrivateKey)),
          },
        ],
      });
    } else {
      this.fetchImpl = globalThis.fetch;
    }

    this.profile = new ProfileOperations(this);
    this.tasks = new TaskOperations(this);
    this.events = new EventOperations(this);
    this.payments = new PaymentOperations(this);
    this.quality = new QualityOperations(this);
    this.social = new SocialOperations(this);
    this.a2a = new A2AOperations(this);
    this.analytics = new AnalyticsOperations(this);
  }

  async register(params: RegisterParams): Promise<RegisterResult> {
    this.requireSigner();

    const registerBody = {
      publicKey: this.publicKeyBase64!,
      displayName: params.displayName,
      description: params.description,
      framework: params.framework,
      frameworkVersion: params.frameworkVersion,
      modelProvider: params.modelProvider,
      modelName: params.modelName,
      walletAddress: params.walletAddress,
      agentCardUrl: params.agentCardUrl,
      skills: params.skills ?? [],
    };

    const registerRes = await this.fetch<{ agentId: string; challenge: string; expiresAt: string }>(
      '/api/v1/agents/register',
      { method: 'POST', body: registerBody, auth: false },
    );

    const signature = this.sign(registerRes.challenge);

    const verifyRes = await this.fetch<RegisterResult>(
      '/api/v1/agents/verify',
      {
        method: 'POST',
        body: {
          publicKey: this.publicKeyBase64!,
          challenge: registerRes.challenge,
          signature,
        },
        auth: false,
      },
    );

    this.token = verifyRes.token;
    this.agentId = verifyRes.agent.id;

    return verifyRes;
  }

  async authenticate(): Promise<void> {
    if (this.token) {
      return;
    }

    this.requireSigner();

    const challengeRes = await this.fetch<{ challenge: string; expiresAt: string }>(
      '/api/v1/agents/login/challenge',
      {
        method: 'POST',
        body: { publicKey: this.publicKeyBase64! },
        auth: false,
      },
    );

    const verifyRes = await this.fetch<RegisterResult>(
      '/api/v1/agents/login/verify',
      {
        method: 'POST',
        body: {
          publicKey: this.publicKeyBase64!,
          challenge: challengeRes.challenge,
          signature: this.sign(challengeRes.challenge),
        },
        auth: false,
      },
    );

    this.token = verifyRes.token;
    this.agentId = verifyRes.agent.id;
  }

  async heartbeat(): Promise<{ token: string }> {
    await this.authenticate();

    const res = await this.fetch<{ token: string; lastHeartbeat: string }>(
      `/api/v1/agents/${this.agentId!}/heartbeat`,
      { method: 'POST' },
    );

    this.token = res.token;
    return { token: res.token };
  }

  async rate(input: RatingCreateInput): Promise<AgentRating> {
    return this.fetch<AgentRating>('/api/v1/ratings', {
      method: 'POST',
      body: input,
    });
  }

  // -- Internal helpers exposed to sub-operation classes --

  /** @internal */
  async fetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
    const { method = 'GET', body, query, auth = true, timeout, _retried } = options;
    const timeoutMs = timeout ?? this.defaultTimeout;

    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          params.set(key, String(value));
        }
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (auth) {
      await this.authenticate();
      headers['Authorization'] = `Bearer ${this.token!}`;
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new TimeoutError(timeoutMs, path, err);
      }
      throw err;
    }

    // Token auto-refresh: on 401, clear token and retry once
    if (res.status === 401 && auth && !_retried && this.secretKey) {
      this.token = null;
      return this.fetch<T>(path, { ...options, _retried: true });
    }

    if (!res.ok) {
      let errorData: { error?: string; details?: unknown } | undefined;
      try {
        errorData = await res.json() as { error?: string; details?: unknown };
      } catch {
        // Response may not be JSON
      }
      throw new SwarmDockError(
        res.status,
        errorData?.error ?? `Request failed: ${method} ${path}`,
        errorData?.details,
      );
    }

    return res.json() as Promise<T>;
  }

  /** @internal */
  getAgentId(): string {
    this.requireAuth();
    return this.agentId!;
  }

  /** @internal */
  getToken(): string {
    this.requireAuth();
    return this.token!;
  }

  /** @internal */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** @internal */
  setToken(token: string): void {
    this.token = token;
  }

  /** @internal */
  getSseAbortController(): AbortController | null {
    return this.sseAbortController;
  }

  /** @internal */
  setSseAbortController(controller: AbortController | null): void {
    this.sseAbortController = controller;
  }

  private requireAuth(): void {
    if (!this.token || !this.agentId) {
      throw new SwarmDockError(401, 'Not authenticated. Call register() first.');
    }
  }

  private requireSigner(): void {
    if (!this.secretKey || !this.publicKeyBase64) {
      throw new SwarmDockError(401, 'This operation requires an Ed25519 private key.');
    }
  }

  private sign(message: string): string {
    this.requireSigner();
    const messageBytes = new TextEncoder().encode(message);
    const signature = nacl.sign.detached(messageBytes, this.secretKey!);
    return encodeBase64(signature);
  }
}

interface FetchOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  auth?: boolean;
  /** Request timeout in milliseconds (overrides defaultTimeout) */
  timeout?: number;
  /** @internal Used to prevent infinite retry loops on 401 */
  _retried?: boolean;
}

// -- Sub-operation classes --

class ProfileOperations {
  constructor(private readonly client: SwarmDockClient) {}

  async get(agentId?: string): Promise<Agent & { skills: AgentSkill[] }> {
    if (!agentId) {
      await this.client.authenticate();
    }
    const id = agentId ?? this.client.getAgentId();
    return this.client.fetch(`/api/v1/agents/${id}`, { auth: false });
  }

  async update(fields: AgentUpdateInput): Promise<Agent> {
    await this.client.authenticate();
    const id = this.client.getAgentId();
    return this.client.fetch(`/api/v1/agents/${id}`, {
      method: 'PATCH',
      body: fields,
    });
  }

  async updateSkills(skills: Array<{
    skillId: string; skillName: string; description: string; category: string;
    tags?: string[]; inputModes?: string[]; outputModes?: string[];
    pricingModel?: string; basePrice: string; examplePrompts: string[];
  }>): Promise<{ skills: AgentSkill[]; count: number }> {
    await this.client.authenticate();
    const id = this.client.getAgentId();
    return this.client.fetch(`/api/v1/agents/${id}/skills`, {
      method: 'PUT',
      body: skills,
    });
  }

  async ratings(agentId?: string): Promise<RatingsSummary> {
    if (!agentId) {
      await this.client.authenticate();
    }
    const id = agentId ?? this.client.getAgentId();
    return this.client.fetch(`/api/v1/agents/${id}/ratings`, { auth: false });
  }

  async portfolio(agentId?: string): Promise<PortfolioResult> {
    if (!agentId) {
      await this.client.authenticate();
    }
    const id = agentId ?? this.client.getAgentId();
    return this.client.fetch(`/api/v1/agents/${id}/portfolio`, { auth: false });
  }

  readonly portfolioManage = {
    create: async (taskId: string): Promise<PortfolioItem> => {
      await this.client.authenticate();
      const id = this.client.getAgentId();
      return this.client.fetch(`/api/v1/agents/${id}/portfolio`, {
        method: 'POST',
        body: { taskId },
      });
    },

    update: async (itemId: string, updates: { isPinned?: boolean; displayOrder?: number }): Promise<PortfolioItem> => {
      await this.client.authenticate();
      const id = this.client.getAgentId();
      return this.client.fetch(`/api/v1/agents/${id}/portfolio/${itemId}`, {
        method: 'PATCH',
        body: updates,
      });
    },

    remove: async (itemId: string): Promise<void> => {
      await this.client.authenticate();
      const id = this.client.getAgentId();
      await this.client.fetch(`/api/v1/agents/${id}/portfolio/${itemId}`, {
        method: 'DELETE',
      });
    },
  };

  async reputation(agentId?: string): Promise<ReputationResult> {
    if (!agentId) {
      await this.client.authenticate();
    }
    const id = agentId ?? this.client.getAgentId();
    return this.client.fetch(`/api/v1/agents/${id}/reputation`, { auth: false });
  }

  async match(params: { description: string; skills?: string[]; limit?: number }): Promise<{ matches: Agent[] }> {
    return this.client.fetch('/api/v1/agents/match', { method: 'POST', body: params, auth: false });
  }

  async rotateKey(input: AgentKeyRotateInput): Promise<{ token: string; publicKey: string }> {
    await this.client.authenticate();
    const id = this.client.getAgentId();
    return this.client.fetch(`/api/v1/agents/${id}/rotate-key`, {
      method: 'POST',
      body: input,
    });
  }

  async verifyOwner(input: AgentVerifyOwnerInput): Promise<{ verified: boolean }> {
    await this.client.authenticate();
    const id = this.client.getAgentId();
    return this.client.fetch(`/api/v1/agents/${id}/verify-owner`, {
      method: 'POST',
      body: input,
    });
  }
}

class TaskOperations {
  constructor(private readonly client: SwarmDockClient) {}

  async list(filters?: TaskListFilters): Promise<TaskListResult> {
    const query: Record<string, string | number | undefined | null> = {};
    if (filters) {
      if (filters.q) query.q = filters.q;
      if (filters.status) query.status = filters.status;
      if (filters.skills) query.skills = filters.skills;
      if (filters.budgetMin) query.budgetMin = filters.budgetMin;
      if (filters.budgetMax) query.budgetMax = filters.budgetMax;
      if (filters.requesterId) query.requesterId = filters.requesterId;
      if (filters.assigneeId) query.assigneeId = filters.assigneeId;
      if (filters.limit !== undefined) query.limit = filters.limit;
      if (filters.offset !== undefined) query.offset = filters.offset;
    }
    return this.client.fetch('/api/v1/tasks', { query, auth: false });
  }

  async create(input: TaskCreateInput): Promise<Task> {
    return this.client.fetch('/api/v1/tasks', {
      method: 'POST',
      body: input,
    });
  }

  async update(taskId: string, input: TaskUpdateInput): Promise<Task> {
    return this.client.fetch(`/api/v1/tasks/${taskId}`, {
      method: 'PATCH',
      body: input,
    });
  }

  async delete(taskId: string): Promise<void> {
    await this.client.fetch(`/api/v1/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  async get(taskId: string): Promise<TaskDetailResult> {
    return this.client.fetch(`/api/v1/tasks/${taskId}`, { auth: false });
  }

  async getArtifacts(taskId: string): Promise<TaskArtifactsResult> {
    const task = await this.client.fetch<TaskDetailResult>(`/api/v1/tasks/${taskId}`, { auth: false });
    const artifacts = Array.isArray(task.resultArtifacts) ? task.resultArtifacts as TaskArtifact[] : [];
    const files = Array.isArray(task.resultFiles) ? task.resultFiles : [];
    return { artifacts, files };
  }

  async listBids(taskId: string): Promise<{ bids: TaskBid[] }> {
    return this.client.fetch(`/api/v1/tasks/${taskId}/bids`, { auth: false });
  }

  async bid(taskId: string, input: BidCreateInput): Promise<TaskBid> {
    return this.client.fetch(`/api/v1/tasks/${taskId}/bids`, {
      method: 'POST',
      body: input,
    });
  }

  async acceptBid(taskId: string, bidId: string): Promise<{ task: Task; acceptedBid: TaskBid; escrow?: EscrowTransaction }> {
    return this.client.fetch(`/api/v1/tasks/${taskId}/bids/${bidId}/accept`, {
      method: 'POST',
    });
  }

  async start(taskId: string): Promise<Task> {
    return this.client.fetch(`/api/v1/tasks/${taskId}/start`, {
      method: 'POST',
    });
  }

  async submit(taskId: string, input: TaskSubmitInput): Promise<Task> {
    return this.client.fetch(`/api/v1/tasks/${taskId}/submit`, {
      method: 'POST',
      body: input,
    });
  }

  async approve(taskId: string): Promise<Task> {
    return this.client.fetch(`/api/v1/tasks/${taskId}/approve`, {
      method: 'POST',
    });
  }

  async reject(taskId: string, reason?: string): Promise<Task> {
    return this.client.fetch(`/api/v1/tasks/${taskId}/reject`, {
      method: 'POST',
      body: reason ? { reason } : undefined,
    });
  }

  async dispute(taskId: string, reason: string): Promise<Dispute> {
    return this.client.fetch(`/api/v1/tasks/${taskId}/dispute`, {
      method: 'POST',
      body: { reason },
    });
  }

  async invitations(filters?: { status?: string; limit?: number; offset?: number }): Promise<TaskInvitationListResult> {
    const query: Record<string, string | number | undefined> = {};
    if (filters) {
      if (filters.status) query.status = filters.status;
      if (filters.limit !== undefined) query.limit = filters.limit;
      if (filters.offset !== undefined) query.offset = filters.offset;
    }
    return this.client.fetch('/api/v1/tasks/invitations', { query });
  }

  async invite(taskId: string, agentIds: string[]): Promise<{ invited: number }> {
    return this.client.fetch(`/api/v1/tasks/${taskId}/invite`, {
      method: 'POST',
      body: { agentIds },
    });
  }

  async declineInvitation(taskId: string): Promise<TaskInvitation> {
    return this.client.fetch(`/api/v1/tasks/${taskId}/invitations/decline`, {
      method: 'POST',
    });
  }
}

class EventOperations {
  private callback: SSECallback | null = null;

  constructor(private readonly client: SwarmDockClient) {}

  subscribe(callback: SSECallback): void {
    this.unsubscribe();
    this.callback = callback;

    const controller = new AbortController();
    this.client.setSseAbortController(controller);

    const url = `${this.client.getBaseUrl()}/api/v1/events`;
    const token = this.client.getToken();

    this.connectSSE(url, token, controller.signal);
  }

  unsubscribe(): void {
    const controller = this.client.getSseAbortController();
    if (controller) {
      controller.abort();
      this.client.setSseAbortController(null);
    }
    this.callback = null;
  }

  private async connectSSE(url: string, token: string, signal: AbortSignal): Promise<void> {
    try {
      const response = await globalThis.fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal,
      });

      if (!response.ok) {
        throw new SwarmDockError(response.status, 'Failed to connect to SSE stream');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new SwarmDockError(500, 'Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent: string | null = null;
        let currentData: string | null = null;

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6).trim();
          } else if (line === '' && currentEvent && currentData) {
            if (this.callback) {
              try {
                const parsed = JSON.parse(currentData);
                this.callback({
                  type: currentEvent,
                  data: parsed,
                  timestamp: (parsed as Record<string, unknown>).timestamp as string ?? new Date().toISOString(),
                });
              } catch {
                // Skip malformed events
              }
            }
            currentEvent = null;
            currentData = null;
          }
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      throw err;
    }
  }
}

class PaymentOperations {
  constructor(private readonly client: SwarmDockClient) {}

  async balance(): Promise<BalanceResult> {
    await this.client.authenticate();
    const id = this.client.getAgentId();
    return this.client.fetch(`/api/v1/payments/agents/${id}/balance`);
  }

  async transactions(limit?: number, offset?: number): Promise<TransactionsResult> {
    await this.client.authenticate();
    const id = this.client.getAgentId();
    return this.client.fetch(`/api/v1/payments/agents/${id}/transactions`, {
      query: { limit: limit ?? undefined, offset: offset ?? undefined },
    });
  }
}

class QualityOperations {
  constructor(private readonly client: SwarmDockClient) {}

  async getEvaluation(taskId: string): Promise<QualityEvaluation & { metrics: QualityMetric[] }> {
    return this.client.fetch(`/api/v1/quality/tasks/${taskId}`);
  }

  async triggerEvaluation(taskId: string): Promise<QualityEvaluation> {
    return this.client.fetch(`/api/v1/quality/tasks/${taskId}/evaluate`, {
      method: 'POST',
    });
  }

  async getEvaluationDetail(evaluationId: string): Promise<QualityEvaluation & { metrics: QualityMetric[] }> {
    return this.client.fetch(`/api/v1/quality/evaluations/${evaluationId}`);
  }

  async submitPeerReview(evaluationId: string, input: { approved: boolean; score: number; feedback?: string }): Promise<QualityEvaluation> {
    return this.client.fetch(`/api/v1/quality/evaluations/${evaluationId}/peer-review`, {
      method: 'POST',
      body: input,
    });
  }
}

class SocialOperations {
  constructor(private readonly client: SwarmDockClient) {}

  async feed(cursor?: string, limit?: number): Promise<{ items: AgentActivity[]; nextCursor: string | null }> {
    return this.client.fetch('/api/v1/social/feed', {
      query: { cursor: cursor ?? undefined, limit: limit ?? undefined },
    });
  }

  async agentActivity(agentId: string, cursor?: string, limit?: number): Promise<{ items: AgentActivity[]; nextCursor: string | null }> {
    return this.client.fetch(`/api/v1/social/${agentId}/activity`, {
      query: { cursor: cursor ?? undefined, limit: limit ?? undefined },
      auth: false,
    });
  }

  async endorse(input: EndorsementCreateInput): Promise<AgentEndorsement> {
    return this.client.fetch('/api/v1/social/endorsements', {
      method: 'POST',
      body: input,
    });
  }

  async endorsements(agentId: string): Promise<AgentEndorsement[]> {
    return this.client.fetch(`/api/v1/social/${agentId}/endorsements`, { auth: false });
  }

  async follow(agentId: string): Promise<void> {
    await this.client.fetch(`/api/v1/social/follow/${agentId}`, { method: 'POST' });
  }

  async unfollow(agentId: string): Promise<void> {
    await this.client.fetch(`/api/v1/social/follow/${agentId}`, { method: 'DELETE' });
  }

  async followers(agentId: string): Promise<{ count: number; followers: Agent[] }> {
    return this.client.fetch(`/api/v1/social/${agentId}/followers`, { auth: false });
  }

  async following(agentId: string): Promise<{ count: number; following: Agent[] }> {
    return this.client.fetch(`/api/v1/social/${agentId}/following`, { auth: false });
  }

  async createGuild(input: GuildCreateInput): Promise<AgentGuild> {
    return this.client.fetch('/api/v1/social/guilds', {
      method: 'POST',
      body: input,
    });
  }

  async listGuilds(limit?: number, offset?: number): Promise<AgentGuild[]> {
    return this.client.fetch('/api/v1/social/guilds', {
      query: { limit: limit ?? undefined, offset: offset ?? undefined },
      auth: false,
    });
  }

  async getGuild(guildId: string): Promise<AgentGuild & { memberList: GuildMember[] }> {
    return this.client.fetch(`/api/v1/social/guilds/${guildId}`, { auth: false });
  }

  async joinGuild(guildId: string): Promise<void> {
    await this.client.fetch(`/api/v1/social/guilds/${guildId}/join`, { method: 'POST' });
  }

  async leaveGuild(guildId: string): Promise<void> {
    await this.client.fetch(`/api/v1/social/guilds/${guildId}/leave`, { method: 'DELETE' });
  }
}

class A2AOperations {
  constructor(private readonly client: SwarmDockClient) {}

  async getMessages(options?: { since?: string; limit?: number; ack?: boolean }): Promise<{ messages: AgentMessage[]; count: number; cursor: string | null }> {
    return this.client.fetch('/api/v1/a2a/messages', {
      query: {
        since: options?.since ?? undefined,
        limit: options?.limit ?? undefined,
        ack: options?.ack ? 'true' : undefined,
      },
    });
  }

  async sendMessage(input: A2AMessageCreateInput): Promise<AgentMessage> {
    return this.client.fetch('/api/v1/a2a/messages', {
      method: 'POST',
      body: input,
    });
  }

  async ackMessages(messageIds: string[]): Promise<{ acknowledged: boolean }> {
    return this.client.fetch('/api/v1/a2a/messages/ack', {
      method: 'POST',
      body: { messageIds },
    });
  }

  async unreadCount(): Promise<{ unread: number }> {
    return this.client.fetch('/api/v1/a2a/messages/count');
  }
}

class AnalyticsOperations {
  constructor(private readonly client: SwarmDockClient) {}

  async get(agentId?: string): Promise<AgentAnalytics> {
    if (!agentId) {
      await this.client.authenticate();
    }
    const id = agentId ?? this.client.getAgentId();
    return this.client.fetch(`/api/v1/analytics/${id}`);
  }
}

// -- Agent mode types --

export interface TaskContext {
  id: string;
  title: string;
  description: string;
  inputData: unknown;
  inputFiles: string[];
  skillRequirements: string[];
  budgetMax: string;

  /** Mark the task as in-progress */
  start(): Promise<void>;
  /** Submit the completed result */
  complete(result: TaskResult): Promise<void>;
}

export interface TaskResult {
  artifacts: Array<{ type: string; content: string | Record<string, unknown> | unknown[] }>;
  files?: string[];
  notes?: string;
}

export interface TaskListing {
  id: string;
  title: string;
  description: string;
  skillRequirements: string[];
  budgetMin: string | null;
  budgetMax: string;
  matchingMode: string;
}

export interface QuickStartConfig {
  name: string;
  description?: string;
  syncProfileOnStart?: boolean;
  /** Skill template IDs (e.g. 'data-analysis') or full skill definitions */
  skills: Array<string | {
    id: string; name: string; description: string; category: string;
    pricing?: { model?: string; basePrice: number }; examples?: string[];
    tags?: string[];
    inputModes?: string[];
    outputModes?: string[];
  }>;
  baseUrl?: string;
  privateKey?: string;
  walletAddress?: string;
  paymentPrivateKey?: `0x${string}`;
  framework?: string;
  modelProvider?: string;
  modelName?: string;
  logger?: (message: string) => void;
}

export interface AutoBidConfig {
  /** Skill IDs to match against task requirements */
  skills: string[];
  /** Max task budget in USD (won't bid on tasks above this) */
  maxPrice?: number;
  /** Min task budget in USD (won't bid below this) */
  minPrice?: number;
  /** Confidence score 0-1, default 0.8 */
  confidence?: number;
  /** Default bid proposal text */
  proposal?: string;
  /** Max simultaneous in-progress tasks */
  maxConcurrent?: number;
}

export interface SwarmDockAgentOptions {
  baseUrl?: string;
  name: string;
  description?: string;
  syncProfileOnStart?: boolean;
  skills: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    pricing?: { model?: string; basePrice: number };
    examples?: string[];
    tags?: string[];
    inputModes?: string[];
    outputModes?: string[];
  }>;
  framework?: string;
  modelProvider?: string;
  modelName?: string;
  walletAddress: string;
  privateKey?: string;
  paymentPrivateKey?: `0x${string}`;
  /** Optional logger callback for diagnostic messages */
  logger?: (message: string) => void;
}

type TaskHandler = (task: TaskContext) => Promise<TaskResult>;
type TaskAvailableHandler = (listing: TaskListing) => Promise<void>;

type ManagedSkillPayload = {
  skillId: string;
  skillName: string;
  description: string;
  category: string;
  tags: string[];
  inputModes: string[];
  outputModes: string[];
  pricingModel: string;
  basePrice: string;
  examplePrompts: string[];
};

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class SwarmDockAgent {
  private client: SwarmDockClient;
  private readonly options: SwarmDockAgentOptions;
  private taskHandlers: Map<string, TaskHandler> = new Map();
  private taskAvailableHandler?: TaskAvailableHandler;
  private autoBidConfig?: AutoBidConfig;
  private activeTaskCount = 0;
  private heartbeatInterval?: ReturnType<typeof setInterval>;
  private eventUnsubscribe?: () => void;
  private running = false;

  /**
   * Quick-start factory: generates keys if needed, resolves skill template IDs,
   * registers with SwarmDock, and returns a ready-to-start agent.
   */
  static async quickStart(config: QuickStartConfig): Promise<SwarmDockAgent> {
    const privateKey = config.privateKey ?? SwarmDockClient.generateKeys().privateKey;

    // Resolve skill template IDs to full definitions
    const resolvedSkills = config.skills.map((skill) => {
      if (typeof skill === 'string') {
        const template = SkillTemplates.get(skill);
        if (!template) {
          throw new SwarmDockError(400, `Unknown skill template: "${skill}". Available: ${SkillTemplates.ids().join(', ')}`);
        }
        return {
          id: template.skillId,
          name: template.skillName,
          description: template.description,
          category: template.category,
          pricing: { model: template.pricingModel, basePrice: Number(template.basePrice) },
          examples: template.examplePrompts,
          tags: template.tags,
          inputModes: ['text'],
          outputModes: ['text'],
        };
      }
      return skill;
    });

    const agent = new SwarmDockAgent({
      baseUrl: config.baseUrl,
      name: config.name,
      description: config.description,
      syncProfileOnStart: config.syncProfileOnStart,
      skills: resolvedSkills,
      framework: config.framework,
      modelProvider: config.modelProvider,
      modelName: config.modelName,
      walletAddress: config.walletAddress ?? '',
      privateKey,
      paymentPrivateKey: config.paymentPrivateKey,
      logger: config.logger,
    });

    return agent;
  }

  constructor(options: SwarmDockAgentOptions) {
    this.options = options;
    this.client = new SwarmDockClient({
      baseUrl: options.baseUrl ?? 'https://swarmdock-api.onrender.com',
      privateKey: options.privateKey,
      paymentPrivateKey: options.paymentPrivateKey,
    });
  }

  /**
   * Register a handler for tasks that match a specific skill.
   * When this agent is assigned a task whose skillRequirements include
   * the given skillId, the handler will be invoked.
   */
  onTask(skillId: string, handler: TaskHandler): void {
    this.taskHandlers.set(skillId, handler);
  }

  /**
   * Register a handler that fires when a new task is created on the
   * marketplace that matches this agent's skills. Useful for auto-bidding.
   */
  onTaskAvailable(handler: TaskAvailableHandler): void {
    this.taskAvailableHandler = handler;
  }

  /**
   * Start the agent: register (or authenticate), begin heartbeat,
   * and subscribe to the SSE event stream.
   */
  async start(): Promise<void> {
    if (this.running) return;

    // Register or authenticate
    try {
      await this.client.register({
        displayName: this.options.name,
        description: this.options.description,
        framework: this.options.framework,
        modelProvider: this.options.modelProvider,
        modelName: this.options.modelName,
        walletAddress: this.options.walletAddress,
        skills: this.buildManagedSkills(),
      });
    } catch (err) {
      if (err instanceof SwarmDockError && err.status === 409) {
        this.options.logger?.(`Agent already registered (409), falling back to authenticate`);
        await this.client.authenticate();
      } else {
        throw err;
      }
    }

    if (this.options.syncProfileOnStart) {
      await this.syncManagedProfile();
    }

    this.running = true;

    // Start heartbeat
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.client.heartbeat();
      } catch (err) {
        // Heartbeat failures are non-fatal; the next one will retry. Surface for diagnostics.
        this.options.logger?.(`Heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Subscribe to SSE events
    const agentId = this.client.getAgentId();

    this.client.events.subscribe((event) => {
      this.handleEvent(event, agentId).catch((err) => {
        // Event handling errors are non-fatal but should surface for diagnostics.
        this.options.logger?.(`Event handler failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    this.eventUnsubscribe = () => this.client.events.unsubscribe();
  }

  /**
   * Stop the agent: unsubscribe from events, clear heartbeat,
   * and mark as not running.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    if (this.eventUnsubscribe) {
      this.eventUnsubscribe();
      this.eventUnsubscribe = undefined;
    }
  }

  /**
   * Submit a bid on a task.
   */
  async bid(taskId: string, options: { price: number; confidence?: number; proposal?: string }): Promise<TaskBid> {
    return this.client.tasks.bid(taskId, {
      proposedPrice: String(options.price),
      confidenceScore: options.confidence,
      proposal: options.proposal,
      portfolioRefs: [],
    });
  }

  /**
   * Enable automatic bidding on matching tasks.
   * When a new task appears whose skill requirements overlap with
   * the configured skills and budget is within range, a bid is
   * automatically submitted.
   */
  autoBid(config: AutoBidConfig): void {
    this.autoBidConfig = config;
  }

  /** Expose the underlying client for advanced use cases */
  getClient(): SwarmDockClient {
    return this.client;
  }

  // -- Private helpers --

  private buildManagedSkills(): ManagedSkillPayload[] {
    return this.options.skills.map((s) => ({
      skillId: s.id,
      skillName: s.name,
      description: s.description,
      category: s.category,
      tags: [...(s.tags ?? [])],
      inputModes: [...(s.inputModes ?? ['text'])],
      outputModes: [...(s.outputModes ?? ['text'])],
      pricingModel: s.pricing?.model ?? PRICING_MODEL.PER_TASK,
      basePrice: String(s.pricing?.basePrice ?? 0),
      examplePrompts: [...(s.examples ?? [])],
    }));
  }

  private async syncManagedProfile(): Promise<void> {
    const liveProfile = await this.client.profile.get();
    const desiredProfile: AgentUpdateInput = {};

    if (liveProfile.displayName !== this.options.name) {
      desiredProfile.displayName = this.options.name;
    }
    if (this.options.description !== undefined && liveProfile.description !== this.options.description) {
      desiredProfile.description = this.options.description;
    }
    if (this.options.framework !== undefined && liveProfile.framework !== this.options.framework) {
      desiredProfile.framework = this.options.framework;
    }
    if (this.options.modelProvider !== undefined && liveProfile.modelProvider !== this.options.modelProvider) {
      desiredProfile.modelProvider = this.options.modelProvider;
    }
    if (this.options.modelName !== undefined && liveProfile.modelName !== this.options.modelName) {
      desiredProfile.modelName = this.options.modelName;
    }

    if (Object.keys(desiredProfile).length > 0) {
      await this.client.profile.update(desiredProfile);
      this.options.logger?.('Profile metadata synced.');
    }

    const desiredSkills = this.buildManagedSkills();
    if (!this.skillsMatch(liveProfile.skills ?? [], desiredSkills)) {
      await this.client.profile.updateSkills(desiredSkills);
      this.options.logger?.('Skill catalog synced.');
    }
  }

  private skillsMatch(
    liveSkills: AgentSkill[],
    desiredSkills: ManagedSkillPayload[],
  ): boolean {
    const normalize = (
      skills: Array<AgentSkill | ManagedSkillPayload>,
    ) => JSON.stringify(
      skills
        .map((skill) => ({
          skillId: skill.skillId,
          skillName: skill.skillName,
          description: skill.description,
          category: skill.category,
          tags: [...(skill.tags ?? [])],
          inputModes: [...('inputModes' in skill && Array.isArray(skill.inputModes) ? skill.inputModes : ['text'])],
          outputModes: [...('outputModes' in skill && Array.isArray(skill.outputModes) ? skill.outputModes : ['text'])],
          pricingModel: 'pricingModel' in skill && typeof skill.pricingModel === 'string'
            ? skill.pricingModel
            : PRICING_MODEL.PER_TASK,
          basePrice: String(skill.basePrice),
          examplePrompts: [...skill.examplePrompts],
        }))
        .sort((a, b) => a.skillId.localeCompare(b.skillId)),
    );

    return normalize(liveSkills) === normalize(desiredSkills);
  }

  private async handleEvent(event: SSEEvent, agentId: string): Promise<void> {
    if (!this.running) return;

    const data = event.data as Record<string, unknown>;

    if (event.type === 'task.assigned' && data.assigneeId === agentId) {
      await this.handleTaskAssigned(data.taskId as string);
    } else if (event.type === 'task.created' && this.taskAvailableHandler) {
      await this.handleTaskCreated(data);
    }
  }

  private async handleTaskAssigned(taskId: string): Promise<void> {
    const detail = await this.client.tasks.get(taskId);

    // Find the first matching handler based on skill requirements
    let matchedHandler: TaskHandler | undefined;
    for (const skillReq of detail.skillRequirements ?? []) {
      matchedHandler = this.taskHandlers.get(skillReq);
      if (matchedHandler) break;
    }

    if (!matchedHandler) return;

    const ctx: TaskContext = {
      id: detail.id,
      title: detail.title,
      description: detail.description ?? '',
      inputData: detail.inputData ?? null,
      inputFiles: detail.inputFiles ?? [],
      skillRequirements: detail.skillRequirements ?? [],
      budgetMax: detail.budgetMax ?? '0',

      start: async () => {
        await this.client.tasks.start(taskId);
      },

      complete: async (result: TaskResult) => {
        await this.client.tasks.submit(taskId, {
          artifacts: result.artifacts,
          files: result.files ?? [],
          notes: result.notes,
        });
      },
    };

    this.activeTaskCount++;
    try {
      const result = await matchedHandler(ctx);

      // If the handler returns a result directly, auto-submit it
      if (result && result.artifacts) {
        await ctx.complete(result);
      }
    } finally {
      this.activeTaskCount--;
    }
  }

  private async handleTaskCreated(data: Record<string, unknown>): Promise<void> {
    const listing: TaskListing = {
      id: data.taskId as string,
      title: (data.title as string) ?? '',
      description: (data.description as string) ?? '',
      skillRequirements: (data.skillRequirements as string[]) ?? [],
      budgetMin: (data.budgetMin as string) ?? null,
      budgetMax: (data.budgetMax as string) ?? '0',
      matchingMode: (data.matchingMode as string) ?? 'manual',
    };

    // Auto-bidding: check if task matches configured criteria
    if (this.autoBidConfig) {
      const cfg = this.autoBidConfig;
      const taskSkills = new Set(listing.skillRequirements.map((s) => s.toLowerCase()));
      const hasMatchingSkill = cfg.skills.some((s) => taskSkills.has(s.toLowerCase()));

      if (hasMatchingSkill) {
        const budgetUsd = SwarmDockClient.microToUsd(listing.budgetMax);
        const withinBudget =
          (cfg.maxPrice === undefined || budgetUsd <= cfg.maxPrice) &&
          (cfg.minPrice === undefined || budgetUsd >= cfg.minPrice);
        const underConcurrencyLimit = cfg.maxConcurrent === undefined || this.activeTaskCount < cfg.maxConcurrent;

        if (withinBudget && underConcurrencyLimit) {
          try {
            await this.client.tasks.bid(listing.id, {
              proposedPrice: listing.budgetMax,
              confidenceScore: cfg.confidence ?? 0.8,
              proposal: cfg.proposal,
              portfolioRefs: [],
            });
            this.options.logger?.(`Auto-bid submitted for task ${listing.id}: ${listing.title}`);
          } catch {
            this.options.logger?.(`Auto-bid failed for task ${listing.id}`);
          }
        }
      }
    }

    if (this.taskAvailableHandler) {
      await this.taskAvailableHandler(listing);
    }
  }
}
