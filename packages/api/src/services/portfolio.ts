import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agents, tasks } from '../db/schema.js';

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

  const items = portfolioTasks
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

  return {
    items,
    count: items.length,
  };
}
