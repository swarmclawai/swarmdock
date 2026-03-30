import { MeiliSearch } from 'meilisearch';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agentSkills, agents, tasks } from '../db/schema.js';
import { AGENT_STATUS } from '@swarmdock/shared';

type AgentDocument = {
  id: string;
  displayName: string;
  description: string;
  framework: string | null;
  modelProvider: string | null;
  modelName: string | null;
  trustLevel: number;
  status: string;
  skillTokens: string[];
  skillCategories: string[];
  createdAt: string;
};

type TaskDocument = {
  id: string;
  title: string;
  description: string;
  status: string;
  matchingMode: string;
  requesterId: string;
  assigneeId: string | null;
  skillRequirements: string[];
  budgetMin: string | null;
  budgetMax: string;
  budgetFloor: string;
  visibility: string;
  createdAt: string;
};

let client: MeiliSearch | null | undefined;
let ensureIndexesPromise: Promise<void> | null = null;

function getClient() {
  if (client !== undefined) {
    return client;
  }

  if (!process.env.MEILISEARCH_URL?.trim()) {
    client = null;
    return client;
  }

  client = new MeiliSearch({
    host: process.env.MEILISEARCH_URL,
    apiKey: process.env.MEILISEARCH_API_KEY,
  });
  return client;
}

export function isSearchEnabled(): boolean {
  return Boolean(getClient());
}

async function ensureIndexes() {
  const meili = getClient();
  if (!meili) {
    return;
  }

  if (!ensureIndexesPromise) {
    ensureIndexesPromise = (async () => {
      const agentIndex = meili.index('agents');
      const taskIndex = meili.index('tasks');

      await meili.createIndex('agents', { primaryKey: 'id' }).catch(() => undefined);
      await meili.createIndex('tasks', { primaryKey: 'id' }).catch(() => undefined);

      await agentIndex.updateFilterableAttributes(['status', 'framework', 'modelProvider', 'trustLevel', 'skillCategories', 'skillTokens']);
      await taskIndex.updateFilterableAttributes(['status', 'matchingMode', 'requesterId', 'assigneeId', 'skillRequirements', 'visibility']);
    })().catch((error) => {
      ensureIndexesPromise = null;
      throw error;
    });
  }

  await ensureIndexesPromise;
}

export async function indexAgentDocument(agentId: string): Promise<void> {
  const meili = getClient();
  if (!meili) {
    return;
  }

  await ensureIndexes();

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    await meili.index('agents').deleteDocument(agentId).catch(() => undefined);
    return;
  }

  const skills = await db.select().from(agentSkills).where(eq(agentSkills.agentId, agentId));
  const document: AgentDocument = {
    id: agent.id,
    displayName: agent.displayName,
    description: agent.description ?? '',
    framework: agent.framework,
    modelProvider: agent.modelProvider,
    modelName: agent.modelName,
    trustLevel: agent.trustLevel,
    status: agent.status,
    skillTokens: skills.flatMap((skill) => [skill.skillId, skill.skillName, ...skill.tags]).map((value) => value.toLowerCase()),
    skillCategories: skills.map((skill) => skill.category.toLowerCase()),
    createdAt: agent.createdAt.toISOString(),
  };

  await meili.index('agents').updateDocuments([document]);
}

export async function indexTaskDocument(taskId: string): Promise<void> {
  const meili = getClient();
  if (!meili) {
    return;
  }

  await ensureIndexes();

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) {
    await meili.index('tasks').deleteDocument(taskId).catch(() => undefined);
    return;
  }

  const document: TaskDocument = {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    matchingMode: task.matchingMode,
    requesterId: task.requesterId,
    assigneeId: task.assigneeId ?? null,
    skillRequirements: task.skillRequirements.map((skill) => skill.toLowerCase()),
    budgetMin: task.budgetMin?.toString() ?? null,
    budgetMax: task.budgetMax.toString(),
    budgetFloor: (task.budgetMin ?? task.budgetMax).toString(),
    visibility: task.visibility,
    createdAt: task.createdAt.toISOString(),
  };

  await meili.index('tasks').updateDocuments([document]);
}

export async function syncAllSearchIndexes(): Promise<void> {
  const meili = getClient();
  if (!meili) {
    return;
  }

  await ensureIndexes();

  const activeAgents = await db.select().from(agents).where(eq(agents.status, AGENT_STATUS.ACTIVE));
  const activeAgentIds = activeAgents.map((agent) => agent.id);
  const skillRows = activeAgentIds.length > 0
    ? await db.select().from(agentSkills).where(inArray(agentSkills.agentId, activeAgentIds))
    : [];
  const skillsByAgent = new Map<string, typeof skillRows>();
  for (const row of skillRows) {
    const entries = skillsByAgent.get(row.agentId) ?? [];
    entries.push(row);
    skillsByAgent.set(row.agentId, entries);
  }

  const agentDocuments: AgentDocument[] = activeAgents.map((agent) => {
    const skills = skillsByAgent.get(agent.id) ?? [];
    return {
      id: agent.id,
      displayName: agent.displayName,
      description: agent.description ?? '',
      framework: agent.framework,
      modelProvider: agent.modelProvider,
      modelName: agent.modelName,
      trustLevel: agent.trustLevel,
      status: agent.status,
      skillTokens: skills.flatMap((skill) => [skill.skillId, skill.skillName, ...skill.tags]).map((value) => value.toLowerCase()),
      skillCategories: skills.map((skill) => skill.category.toLowerCase()),
      createdAt: agent.createdAt.toISOString(),
    };
  });

  const taskRows = await db.select().from(tasks);
  const taskDocuments: TaskDocument[] = taskRows.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    matchingMode: task.matchingMode,
    requesterId: task.requesterId,
    assigneeId: task.assigneeId ?? null,
    skillRequirements: task.skillRequirements.map((skill) => skill.toLowerCase()),
    budgetMin: task.budgetMin?.toString() ?? null,
    budgetMax: task.budgetMax.toString(),
    budgetFloor: (task.budgetMin ?? task.budgetMax).toString(),
    visibility: task.visibility,
    createdAt: task.createdAt.toISOString(),
  }));

  await Promise.all([
    meili.index('agents').deleteAllDocuments().catch(() => undefined),
    meili.index('tasks').deleteAllDocuments().catch(() => undefined),
  ]);
  if (agentDocuments.length > 0) {
    await meili.index('agents').addDocuments(agentDocuments);
  }
  if (taskDocuments.length > 0) {
    await meili.index('tasks').addDocuments(taskDocuments);
  }
}

function buildAgentFilters(skills?: string) {
  const filters = ['status = "active"'];
  if (skills) {
    const values = skills.split(',').map((skill) => skill.trim().toLowerCase()).filter(Boolean);
    if (values.length > 0) {
      filters.push(values.map((value) => `(skillTokens = "${value}" OR skillCategories = "${value}")`).join(' OR '));
    }
  }
  return filters;
}

function buildTaskFilters(params: {
  status?: string;
  skills?: string;
  requesterId?: string;
  assigneeId?: string;
  visibility?: string;
}) {
  const filters: string[] = [];
  if (params.visibility) filters.push(`visibility = "${params.visibility}"`);
  if (params.status) filters.push(`status = "${params.status}"`);
  if (params.requesterId) filters.push(`requesterId = "${params.requesterId}"`);
  if (params.assigneeId) filters.push(`assigneeId = "${params.assigneeId}"`);
  if (params.skills) {
    const values = params.skills.split(',').map((skill) => skill.trim().toLowerCase()).filter(Boolean);
    if (values.length > 0) {
      filters.push(values.map((value) => `skillRequirements = "${value}"`).join(' OR '));
    }
  }
  return filters;
}

export async function searchAgentsIndex(params: {
  q?: string;
  skills?: string;
  limit: number;
  offset: number;
}) {
  const meili = getClient();
  if (!meili) {
    return null;
  }

  await ensureIndexes();

  const result = await meili.index<AgentDocument>('agents').search(params.q?.trim() || '', {
    limit: params.limit,
    offset: params.offset,
    filter: buildAgentFilters(params.skills),
    facets: ['framework', 'modelProvider', 'trustLevel', 'skillCategories'],
  });

  return {
    ids: result.hits.map((hit) => hit.id),
    total: result.estimatedTotalHits ?? result.hits.length,
    facets: result.facetDistribution ?? {},
  };
}

export async function searchTasksIndex(params: {
  q?: string;
  status?: string;
  skills?: string;
  requesterId?: string;
  assigneeId?: string;
  visibility?: string;
  limit: number;
  offset: number;
}) {
  const meili = getClient();
  if (!meili) {
    return null;
  }

  await ensureIndexes();

  const result = await meili.index<TaskDocument>('tasks').search(params.q?.trim() || '', {
    limit: params.limit,
    offset: params.offset,
    filter: buildTaskFilters(params),
    facets: ['status', 'matchingMode', 'skillRequirements'],
  });

  return {
    ids: result.hits.map((hit) => hit.id),
    total: result.estimatedTotalHits ?? result.hits.length,
    facets: result.facetDistribution ?? {},
  };
}

export async function fetchOrderedRowsByIds<T extends { id: string }>(
  ids: string[],
  rowsLoader: () => Promise<T[]>,
): Promise<T[]> {
  if (ids.length === 0) {
    return [];
  }

  const rows = await rowsLoader();
  const rowMap = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => rowMap.get(id)).filter((row): row is T => Boolean(row));
}
