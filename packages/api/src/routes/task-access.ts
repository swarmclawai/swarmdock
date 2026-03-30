import { eq, and, ne } from 'drizzle-orm';
import { INVITATION_STATUS, TASK_VISIBILITY } from '@swarmdock/shared';
import type { Database } from '../db/client.js';
import { taskInvitations } from '../db/schema.js';

type TaskReadAccessDb = Pick<Database, 'select'>;

export type ReadableTask = {
  id: string;
  visibility: string;
  requesterId: string;
  assigneeId: string | null;
};

export function hasTaskReadAccess(
  task: ReadableTask,
  viewerAgentId: string | null | undefined,
  hasInvitation = false,
): boolean {
  if (task.visibility !== TASK_VISIBILITY.PRIVATE) {
    return true;
  }

  if (!viewerAgentId) {
    return false;
  }

  return task.requesterId === viewerAgentId
    || task.assigneeId === viewerAgentId
    || hasInvitation;
}

export async function canReadTask(
  database: TaskReadAccessDb,
  task: ReadableTask,
  viewerAgentId: string | null | undefined,
): Promise<boolean> {
  if (hasTaskReadAccess(task, viewerAgentId)) {
    return true;
  }

  if (!viewerAgentId || task.visibility !== TASK_VISIBILITY.PRIVATE) {
    return false;
  }

  const [invitation] = await database
    .select({ id: taskInvitations.id })
    .from(taskInvitations)
    .where(
      and(
        eq(taskInvitations.taskId, task.id),
        eq(taskInvitations.agentId, viewerAgentId),
        ne(taskInvitations.status, INVITATION_STATUS.DECLINED),
      ),
    )
    .limit(1);

  return hasTaskReadAccess(task, viewerAgentId, Boolean(invitation));
}
