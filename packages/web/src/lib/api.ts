const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100';

export type HealthResponse = {
  status: string;
  version: string;
  database: string;
  timestamp: string;
};

export type AgentTopSkill = {
  skillId: string;
  skillName: string;
  category: string;
};

export type AgentSummary = {
  id: string;
  did: string;
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
  skillCount: number;
  topSkills: AgentTopSkill[];
};

export type AgentSkill = {
  id: string;
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
};

export type AgentDetail = AgentSummary & {
  skills: AgentSkill[];
};

export type RatingsSummary = {
  ratings: Array<{
    id: string;
    taskId: string;
    raterId: string;
    qualityScore: number;
    speedScore: number | null;
    communicationScore: number | null;
    reliabilityScore: number | null;
    comment: string | null;
    createdAt: string;
  }>;
  averages: {
    quality: number;
    speed: number | null;
    communication: number | null;
    reliability: number | null;
  } | null;
  count: number;
};

export type AgentListResponse = {
  agents: AgentSummary[];
  limit: number;
  offset: number;
  total: number;
};

export type TaskParty = {
  id: string;
  displayName: string;
  trustLevel: number;
  status: string;
};

export type TaskListItem = {
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
  bidCount: number;
};

export type TaskDetail = TaskListItem & {
  requester: TaskParty | null;
  assignee: TaskParty | null;
  bids: Array<{
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
    bidderDisplayName: string | null;
    bidder: TaskParty | null;
  }>;
};

export type TaskListResponse = {
  tasks: TaskListItem[];
  limit: number;
  offset: number;
  total: number;
};

async function fetchJson<T>(path: string, revalidate: number): Promise<T | null> {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      next: { revalidate },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json() as T;
  } catch {
    return null;
  }
}

function buildQuery(params: Record<string, string | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export async function fetchHealth(): Promise<HealthResponse | null> {
  return fetchJson<HealthResponse>('/api/v1/health', 15);
}

export async function fetchAgents(params: {
  q?: string;
  skills?: string;
  limit?: string;
  offset?: string;
} = {}): Promise<AgentListResponse | null> {
  return fetchJson<AgentListResponse>(
    `/api/v1/agents${buildQuery(params)}`,
    30,
  );
}

export async function fetchAgent(id: string): Promise<AgentDetail | null> {
  return fetchJson<AgentDetail>(`/api/v1/agents/${id}`, 30);
}

export async function fetchAgentRatings(id: string): Promise<RatingsSummary | null> {
  return fetchJson<RatingsSummary>(`/api/v1/agents/${id}/ratings`, 60);
}

export async function fetchTasks(params: {
  q?: string;
  status?: string;
  skills?: string;
  budgetMin?: string;
  budgetMax?: string;
  requesterId?: string;
  assigneeId?: string;
  limit?: string;
  offset?: string;
} = {}): Promise<TaskListResponse | null> {
  return fetchJson<TaskListResponse>(
    `/api/v1/tasks${buildQuery(params)}`,
    20,
  );
}

export async function fetchTask(id: string): Promise<TaskDetail | null> {
  return fetchJson<TaskDetail>(`/api/v1/tasks/${id}`, 15);
}
