import nacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';
const { encodeBase64, decodeBase64 } = tweetnaclUtil;
import type {
  Agent,
  Task,
  TaskBid,
  EscrowTransaction,
  AgentRating,
  AgentSkill,
  SSEEvent,
  AgentUpdateInput,
  TaskCreateInput,
  TaskSubmitInput,
  BidCreateInput,
  RatingCreateInput,
} from '@swarmdock/shared';
import { SwarmDockError } from './errors.js';

export interface SwarmDockClientOptions {
  baseUrl: string;
  privateKey?: string; // Ed25519 secret key, base64
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

type SSECallback = (event: SSEEvent) => void;

export class SwarmDockClient {
  private readonly baseUrl: string;
  private readonly secretKey: Uint8Array | null;
  private readonly publicKeyBase64: string | null;
  private token: string | null = null;
  private agentId: string | null = null;

  private sseAbortController: AbortController | null = null;

  readonly profile: ProfileOperations;
  readonly tasks: TaskOperations;
  readonly events: EventOperations;
  readonly payments: PaymentOperations;

  constructor(options: SwarmDockClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    if (options.privateKey) {
      this.secretKey = decodeBase64(options.privateKey);
      const keyPair = nacl.sign.keyPair.fromSecretKey(this.secretKey);
      this.publicKeyBase64 = encodeBase64(keyPair.publicKey);
    } else {
      this.secretKey = null;
      this.publicKeyBase64 = null;
    }

    this.profile = new ProfileOperations(this);
    this.tasks = new TaskOperations(this);
    this.events = new EventOperations(this);
    this.payments = new PaymentOperations(this);
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
    const { method = 'GET', body, query, auth = true } = options;

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

    const res = await globalThis.fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

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

  async ratings(agentId?: string): Promise<RatingsSummary> {
    if (!agentId) {
      await this.client.authenticate();
    }
    const id = agentId ?? this.client.getAgentId();
    return this.client.fetch(`/api/v1/agents/${id}/ratings`, { auth: false });
  }

  async match(params: { description: string; skills?: string[]; limit?: number }): Promise<{ matches: Agent[] }> {
    return this.client.fetch('/api/v1/agents/match', { method: 'POST', body: params, auth: false });
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

  async get(taskId: string): Promise<TaskDetailResult> {
    return this.client.fetch(`/api/v1/tasks/${taskId}`, { auth: false });
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
