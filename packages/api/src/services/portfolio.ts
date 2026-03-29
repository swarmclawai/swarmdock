import { and, desc, eq, isNotNull, notInArray, asc } from 'drizzle-orm';
import type { PortfolioItem } from '@swarmdock/shared';
import { db } from '../db/client.js';
import { agents, tasks, portfolioItems } from '../db/schema.js';

type PortfolioTaskRow = {
  id: string;
  title: string;
  description: string;
  completedAt: Date | null;
  qualityScore: number | null;
  resultArtifacts: unknown;
  resultFiles: string[] | null;
  requesterId: string | null;
  requesterDisplayName: string | null;
};

export function derivePortfolioItems(portfolioTasks: PortfolioTaskRow[]): PortfolioItem[] {
  return portfolioTasks
    .filter((task) => {
      const artifactCount = Array.isArray(task.resultArtifacts) ? task.resultArtifacts.length : 0;
      const fileCount = Array.isArray(task.resultFiles) ? task.resultFiles.length : 0;
      return artifactCount > 0 || fileCount > 0;
    })
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      description: task.description,
      completedAt: task.completedAt!.toISOString(),
      qualityScore: task.qualityScore,
      requester: task.requesterId
        ? {
            id: task.requesterId,
            displayName: task.requesterDisplayName ?? 'Unknown requester',
          }
        : null,
      artifacts: Array.isArray(task.resultArtifacts) ? task.resultArtifacts : [],
      files: Array.isArray(task.resultFiles) ? task.resultFiles : [],
    }));
}

export async function getAgentPortfolio(agentId: string) {
  const portfolioTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      completedAt: tasks.completedAt,
      qualityScore: tasks.qualityScore,
      resultArtifacts: tasks.resultArtifacts,
      resultFiles: tasks.resultFiles,
      requesterId: agents.id,
      requesterDisplayName: agents.displayName,
    })
    .from(tasks)
    .leftJoin(agents, eq(tasks.requesterId, agents.id))
    .where(and(
      eq(tasks.assigneeId, agentId),
      isNotNull(tasks.completedAt),
    ))
    .orderBy(desc(tasks.completedAt))
    .limit(20);

  const items = derivePortfolioItems(portfolioTasks);

  return {
    items,
    count: items.length,
  };
}

function toPortfolioItem(row: typeof portfolioItems.$inferSelect): PortfolioItem {
  return {
    id: row.id,
    agentId: row.agentId,
    taskId: row.taskId ?? '',
    title: row.title,
    description: row.description ?? '',
    category: row.category,
    completedAt: row.createdAt.toISOString(),
    qualityScore: row.qualityScore,
    requester: null,
    artifacts: Array.isArray(row.artifacts) ? row.artifacts : [],
    files: Array.isArray(row.files) ? row.files : [],
    isPinned: row.isPinned,
    displayOrder: row.displayOrder,
  };
}

export async function getPortfolioItems(agentId: string): Promise<PortfolioItem[]> {
  const rows = await db
    .select()
    .from(portfolioItems)
    .where(eq(portfolioItems.agentId, agentId))
    .orderBy(desc(portfolioItems.isPinned), asc(portfolioItems.displayOrder));

  return rows.map(toPortfolioItem);
}

export async function createPortfolioItem(
  agentId: string,
  taskId: string,
): Promise<PortfolioItem> {
  const [task] = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      qualityScore: tasks.qualityScore,
      resultArtifacts: tasks.resultArtifacts,
      resultFiles: tasks.resultFiles,
      skillRequirements: tasks.skillRequirements,
    })
    .from(tasks)
    .where(and(
      eq(tasks.id, taskId),
      eq(tasks.assigneeId, agentId),
      isNotNull(tasks.completedAt),
    ))
    .limit(1);

  if (!task) {
    throw new Error(`No completed task ${taskId} found for agent ${agentId}`);
  }

  const [row] = await db
    .insert(portfolioItems)
    .values({
      agentId,
      taskId,
      title: task.title,
      description: task.description,
      category: task.skillRequirements[0] ?? 'general',
      artifacts: task.resultArtifacts ?? [],
      files: task.resultFiles ?? [],
      qualityScore: task.qualityScore,
    })
    .returning();

  return toPortfolioItem(row);
}

export async function updatePortfolioItem(
  itemId: string,
  agentId: string,
  updates: { isPinned?: boolean; displayOrder?: number },
): Promise<PortfolioItem> {
  const [row] = await db
    .update(portfolioItems)
    .set(updates)
    .where(and(
      eq(portfolioItems.id, itemId),
      eq(portfolioItems.agentId, agentId),
    ))
    .returning();

  if (!row) {
    throw new Error(`Portfolio item ${itemId} not found for agent ${agentId}`);
  }

  return toPortfolioItem(row);
}

export async function deletePortfolioItem(
  itemId: string,
  agentId: string,
): Promise<void> {
  const result = await db
    .delete(portfolioItems)
    .where(and(
      eq(portfolioItems.id, itemId),
      eq(portfolioItems.agentId, agentId),
    ))
    .returning({ id: portfolioItems.id });

  if (result.length === 0) {
    throw new Error(`Portfolio item ${itemId} not found for agent ${agentId}`);
  }
}

export async function getCombinedPortfolio(agentId: string) {
  // Get curated items first
  const curated = await getPortfolioItems(agentId);
  const curatedTaskIds = curated
    .map((item) => item.taskId)
    .filter((id): id is string => !!id);

  // Get derived items for tasks not already in curated portfolio
  const portfolioTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      completedAt: tasks.completedAt,
      qualityScore: tasks.qualityScore,
      resultArtifacts: tasks.resultArtifacts,
      resultFiles: tasks.resultFiles,
      requesterId: agents.id,
      requesterDisplayName: agents.displayName,
    })
    .from(tasks)
    .leftJoin(agents, eq(tasks.requesterId, agents.id))
    .where(and(
      eq(tasks.assigneeId, agentId),
      isNotNull(tasks.completedAt),
      ...(curatedTaskIds.length > 0 ? [notInArray(tasks.id, curatedTaskIds)] : []),
    ))
    .orderBy(desc(tasks.completedAt))
    .limit(20);

  const derived = derivePortfolioItems(portfolioTasks);

  return {
    curated,
    derived,
    items: [...curated, ...derived],
    count: curated.length + derived.length,
  };
}
