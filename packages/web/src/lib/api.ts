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

export type PortfolioItem = {
  taskId: string;
  title: string;
  description: string;
  completedAt: string;
  qualityScore: number | null;
  requester: {
    id: string;
    displayName: string;
  } | null;
  artifacts: unknown[];
  files: string[];
};

export type PortfolioResponse = {
  items: PortfolioItem[];
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

export type TaskDispute = {
  id: string;
  taskId: string;
  raisedByAgentId: string;
  againstAgentId: string | null;
  reason: string;
  status: string;
  resolution: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  resolvedAt: string | null;
  updatedAt: string;
};

export type TaskListItem = {
  id: string;
  requesterId: string | null;
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
  visibility: string;
  revealIdentity: boolean;
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
  dispute: TaskDispute | null;
};

export type TaskListResponse = {
  tasks: TaskListItem[];
  limit: number;
  offset: number;
  total: number;
};

type AgentSummaryInput = Partial<AgentSummary> & {
  skills?: Array<Partial<AgentSkill>>;
};

type AgentDetailInput = AgentSummaryInput & {
  skills?: Array<Partial<AgentSkill>>;
};

type TaskListItemInput = Partial<TaskListItem>;

type TaskDetailInput = TaskListItemInput & {
  requester?: TaskParty | null;
  assignee?: TaskParty | null;
  bids?: TaskDetail['bids'];
  dispute?: TaskDispute | null;
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

function normalizeTopSkills(
  topSkills: AgentSummaryInput['topSkills'],
  skills: AgentSummaryInput['skills'],
): AgentTopSkill[] {
  if (Array.isArray(topSkills)) {
    return topSkills.map((skill) => ({
      skillId: String(skill.skillId ?? ''),
      skillName: String(skill.skillName ?? ''),
      category: String(skill.category ?? 'General'),
    }));
  }

  if (Array.isArray(skills)) {
    return skills.slice(0, 4).map((skill, index) => ({
      skillId: String(skill.skillId ?? `skill-${index}`),
      skillName: String(skill.skillName ?? skill.category ?? 'Unnamed Skill'),
      category: String(skill.category ?? 'General'),
    }));
  }

  return [];
}

function normalizeSkill(skill: Partial<AgentSkill>, index: number): AgentSkill {
  return {
    id: String(skill.id ?? `skill-${index}`),
    skillId: String(skill.skillId ?? skill.id ?? `skill-${index}`),
    skillName: String(skill.skillName ?? skill.category ?? 'Unnamed Skill'),
    description: String(skill.description ?? ''),
    category: String(skill.category ?? 'General'),
    tags: Array.isArray(skill.tags) ? skill.tags.map(String) : [],
    pricingModel: String(skill.pricingModel ?? 'per-task'),
    basePrice: String(skill.basePrice ?? '0'),
    currency: String(skill.currency ?? 'USDC'),
    examplePrompts: Array.isArray(skill.examplePrompts) ? skill.examplePrompts.map(String) : [],
    tasksCompleted: typeof skill.tasksCompleted === 'number' ? skill.tasksCompleted : 0,
    avgQualityScore: typeof skill.avgQualityScore === 'number' ? skill.avgQualityScore : null,
  };
}

function normalizeAgentSummary(agent: AgentSummaryInput): AgentSummary {
  const normalizedSkills = Array.isArray(agent.skills) ? agent.skills.map(normalizeSkill) : [];
  const topSkills = normalizeTopSkills(agent.topSkills, normalizedSkills);

  return {
    id: String(agent.id ?? ''),
    did: String(agent.did ?? ''),
    displayName: String(agent.displayName ?? 'Unknown Agent'),
    description: agent.description ?? null,
    framework: agent.framework ?? null,
    frameworkVersion: agent.frameworkVersion ?? null,
    modelProvider: agent.modelProvider ?? null,
    modelName: agent.modelName ?? null,
    walletAddress: String(agent.walletAddress ?? ''),
    trustLevel: typeof agent.trustLevel === 'number' ? agent.trustLevel : 0,
    dailySpendingLimit: agent.dailySpendingLimit ?? null,
    agentCardUrl: agent.agentCardUrl ?? null,
    status: String(agent.status ?? 'unknown'),
    lastHeartbeat: agent.lastHeartbeat ?? null,
    createdAt: String(agent.createdAt ?? new Date(0).toISOString()),
    updatedAt: String(agent.updatedAt ?? new Date(0).toISOString()),
    skillCount: typeof agent.skillCount === 'number' ? agent.skillCount : normalizedSkills.length,
    topSkills,
  };
}

function normalizeAgentDetail(agent: AgentDetailInput): AgentDetail {
  const normalizedSkills = Array.isArray(agent.skills) ? agent.skills.map(normalizeSkill) : [];
  const summary = normalizeAgentSummary({ ...agent, skills: normalizedSkills });

  return {
    ...summary,
    skills: normalizedSkills,
  };
}

function normalizeTaskListItem(task: TaskListItemInput): TaskListItem {
  return {
    id: String(task.id ?? ''),
    requesterId: task.requesterId ? String(task.requesterId) : null,
    assigneeId: task.assigneeId ?? null,
    title: String(task.title ?? 'Untitled Task'),
    description: String(task.description ?? ''),
    skillRequirements: Array.isArray(task.skillRequirements) ? task.skillRequirements.map(String) : [],
    inputData: task.inputData ?? null,
    matchingMode: String(task.matchingMode ?? 'open'),
    budgetMin: task.budgetMin ?? null,
    budgetMax: String(task.budgetMax ?? '0'),
    currency: String(task.currency ?? 'USDC'),
    finalPrice: task.finalPrice ?? null,
    status: String(task.status ?? 'unknown'),
    deadline: task.deadline ?? null,
    startedAt: task.startedAt ?? null,
    submittedAt: task.submittedAt ?? null,
    completedAt: task.completedAt ?? null,
    resultArtifacts: task.resultArtifacts ?? null,
    resultFiles: Array.isArray(task.resultFiles) ? task.resultFiles.map(String) : null,
    qualityScore: typeof task.qualityScore === 'number' ? task.qualityScore : null,
    visibility: String(task.visibility ?? 'public'),
    revealIdentity: typeof task.revealIdentity === 'boolean' ? task.revealIdentity : true,
    createdAt: String(task.createdAt ?? new Date(0).toISOString()),
    updatedAt: String(task.updatedAt ?? new Date(0).toISOString()),
    bidCount: typeof task.bidCount === 'number' ? task.bidCount : 0,
  };
}

function normalizeTaskDetail(task: TaskDetailInput): TaskDetail {
  const summary = normalizeTaskListItem(task);

  return {
    ...summary,
    requester: task.requester ?? null,
    assignee: task.assignee ?? null,
    bids: Array.isArray(task.bids)
      ? task.bids.map((bid) => ({
          ...bid,
          proposedPrice: String(bid.proposedPrice ?? '0'),
          confidenceScore: typeof bid.confidenceScore === 'number' ? bid.confidenceScore : null,
          estimatedDuration: bid.estimatedDuration ?? null,
          proposal: bid.proposal ?? null,
          portfolioRefs: Array.isArray(bid.portfolioRefs) ? bid.portfolioRefs.map(String) : null,
          status: String(bid.status ?? 'unknown'),
          createdAt: String(bid.createdAt ?? new Date(0).toISOString()),
          bidderDisplayName: bid.bidderDisplayName ?? null,
          bidder: bid.bidder ?? null,
        }))
      : [],
    dispute: task.dispute
      ? {
          id: String(task.dispute.id ?? ''),
          taskId: String(task.dispute.taskId ?? summary.id),
          raisedByAgentId: String(task.dispute.raisedByAgentId ?? ''),
          againstAgentId: task.dispute.againstAgentId ?? null,
          reason: String(task.dispute.reason ?? ''),
          status: String(task.dispute.status ?? 'open'),
          resolution: task.dispute.resolution ?? null,
          resolutionNotes: task.dispute.resolutionNotes ?? null,
          createdAt: String(task.dispute.createdAt ?? new Date(0).toISOString()),
          resolvedAt: task.dispute.resolvedAt ?? null,
          updatedAt: String(task.dispute.updatedAt ?? new Date(0).toISOString()),
        }
      : null,
  };
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
  const response = await fetchJson<{
    agents?: AgentSummaryInput[];
    limit?: number;
    offset?: number;
    total?: number;
  }>(
    `/api/v1/agents${buildQuery(params)}`,
    30,
  );

  if (!response || !Array.isArray(response.agents)) {
    return null;
  }

  return {
    agents: response.agents.map(normalizeAgentSummary),
    limit: typeof response.limit === 'number' ? response.limit : response.agents.length,
    offset: typeof response.offset === 'number' ? response.offset : 0,
    total: typeof response.total === 'number' ? response.total : response.agents.length,
  };
}

export async function fetchAgent(id: string): Promise<AgentDetail | null> {
  const response = await fetchJson<AgentDetailInput>(`/api/v1/agents/${id}`, 30);
  return response ? normalizeAgentDetail(response) : null;
}

export async function fetchAgentRatings(id: string): Promise<RatingsSummary | null> {
  const canonical = await fetchJson<RatingsSummary>(`/api/v1/agents/${id}/ratings`, 60);
  if (canonical) {
    return canonical;
  }

  return fetchJson<RatingsSummary>(`/api/v1/ratings/agents/${id}`, 60);
}

export async function fetchAgentPortfolio(id: string): Promise<PortfolioResponse | null> {
  const response = await fetchJson<{
    items?: Array<Partial<PortfolioItem>>;
    count?: number;
  }>(`/api/v1/agents/${id}/portfolio`, 30);

  if (!response || !Array.isArray(response.items)) {
    return null;
  }

  return {
    items: response.items.map((item) => ({
      taskId: String(item.taskId ?? ''),
      title: String(item.title ?? 'Untitled Task'),
      description: String(item.description ?? ''),
      completedAt: String(item.completedAt ?? new Date(0).toISOString()),
      qualityScore: typeof item.qualityScore === 'number' ? item.qualityScore : null,
      requester: item.requester
        ? {
            id: String(item.requester.id ?? ''),
            displayName: String(item.requester.displayName ?? 'Unknown requester'),
          }
        : null,
      artifacts: Array.isArray(item.artifacts) ? item.artifacts : [],
      files: Array.isArray(item.files) ? item.files.map(String) : [],
    })),
    count: typeof response.count === 'number' ? response.count : response.items.length,
  };
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
  const response = await fetchJson<{
    tasks?: TaskListItemInput[];
    limit?: number;
    offset?: number;
    total?: number;
  }>(
    `/api/v1/tasks${buildQuery(params)}`,
    20,
  );

  if (!response || !Array.isArray(response.tasks)) {
    return null;
  }

  return {
    tasks: response.tasks.map(normalizeTaskListItem),
    limit: typeof response.limit === 'number' ? response.limit : response.tasks.length,
    offset: typeof response.offset === 'number' ? response.offset : 0,
    total: typeof response.total === 'number' ? response.total : response.tasks.length,
  };
}

export async function fetchTask(id: string): Promise<TaskDetail | null> {
  const response = await fetchJson<TaskDetailInput>(`/api/v1/tasks/${id}`, 15);
  return response ? normalizeTaskDetail(response) : null;
}

// ── Invitations ─────────────────────────────────────────────

export type InvitationItem = {
  invitation: {
    id: string;
    taskId: string;
    agentId: string;
    source: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  task: TaskListItem;
};

export type InvitationListResponse = {
  invitations: InvitationItem[];
  limit: number;
  offset: number;
  total: number;
};

export async function fetchInvitations(token: string, params: { status?: string; limit?: string; offset?: string } = {}): Promise<InvitationListResponse | null> {
  try {
    const response = await fetch(`${API_URL}/api/v1/tasks/invitations${buildQuery(params)}`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 10 },
    });
    if (!response.ok) return null;
    const data = await response.json() as {
      invitations?: Array<{ invitation: InvitationItem['invitation']; task: TaskListItemInput }>;
      limit?: number;
      offset?: number;
      total?: number;
    };
    if (!data || !Array.isArray(data.invitations)) return null;
    return {
      invitations: data.invitations.map((item) => ({
        invitation: item.invitation,
        task: normalizeTaskListItem(item.task),
      })),
      limit: data.limit ?? data.invitations.length,
      offset: data.offset ?? 0,
      total: data.total ?? data.invitations.length,
    };
  } catch {
    return null;
  }
}

// ── Leaderboard ──────────────────────────────────────────────

export type LeaderboardResponse = {
  agents: AgentSummary[];
  total: number;
};

export async function fetchLeaderboard(params: { limit?: string; dimension?: string } = {}): Promise<LeaderboardResponse | null> {
  const response = await fetchAgents({ limit: params.limit ?? '50' });
  if (!response) return null;
  const sorted = [...response.agents].sort((a, b) => b.trustLevel - a.trustLevel);
  return { agents: sorted, total: response.total };
}

// ── Admin ────────────────────────────────────────────────────

async function fetchJsonWithAuth<T>(path: string, adminKey: string): Promise<T | null> {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      headers: { 'X-Admin-Key': adminKey },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch { return null; }
}

export type AdminStats = {
  agents: { active: number };
  tasks: { total: number; open: number; completed: number };
  volume: { totalReleased: string; currency: string };
  ratings: { total: number };
  timestamp: string;
};

export async function fetchAdminStats(adminKey: string): Promise<AdminStats | null> {
  return fetchJsonWithAuth<AdminStats>('/api/v1/admin/stats', adminKey);
}

export type AdminRevenue = {
  totalFees: string;
  currency: string;
  recentTransactions: Array<{
    id: string;
    taskId: string;
    amount: string;
    platformFee: string | null;
    status: string;
    createdAt: string;
  }>;
};

export async function fetchAdminRevenue(adminKey: string): Promise<AdminRevenue | null> {
  return fetchJsonWithAuth<AdminRevenue>('/api/v1/admin/revenue', adminKey);
}

export type AdminTransactionsResponse = {
  transactions: Array<{
    id: string;
    taskId: string | null;
    type: string;
    fromAgentId: string | null;
    toAgentId: string | null;
    amount: string;
    currency: string;
    txHash: string | null;
    status: string;
    createdAt: string;
  }>;
  total: number;
  limit: number;
  offset: number;
};

export async function fetchAdminTransactions(adminKey: string, params?: { limit?: string; offset?: string }): Promise<AdminTransactionsResponse | null> {
  const query = buildQuery({ limit: params?.limit, offset: params?.offset });
  return fetchJsonWithAuth<AdminTransactionsResponse>(`/api/v1/admin/transactions${query}`, adminKey);
}
