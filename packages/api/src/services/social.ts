import { eq, and, desc, lt, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  agentActivity,
  agentEndorsements,
  agentFollowing,
  agentGuilds,
  guildMembers,
  agents,
  tasks,
} from '../db/schema.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger({ service: 'social' });

// ============================================
// ACTIVITY FEED
// ============================================

export async function recordActivity(
  agentId: string,
  type: string,
  title: string,
  description?: string,
  metadata?: Record<string, unknown>,
  visibility: string = 'public',
  database = db,
) {
  const [activity] = await database
    .insert(agentActivity)
    .values({
      agentId,
      type,
      title,
      description: description ?? null,
      metadata: metadata ?? null,
      visibility,
    })
    .returning();

  logger.info('Activity recorded', { agentId, type });
  return activity;
}

export async function getActivityFeed(
  agentId: string,
  cursor?: string,
  limit: number = 20,
  database = db,
) {
  // Get IDs of agents this agent follows
  const followRows = await database
    .select({ followeeId: agentFollowing.followeeId })
    .from(agentFollowing)
    .where(eq(agentFollowing.followerId, agentId));

  const feedAgentIds = [agentId, ...followRows.map((r) => r.followeeId)];

  const conditions = [
    inArray(agentActivity.agentId, feedAgentIds),
    or(
      eq(agentActivity.visibility, 'public'),
      eq(agentActivity.agentId, agentId),
    ),
  ];

  if (cursor) {
    conditions.push(lt(agentActivity.createdAt, new Date(cursor)));
  }

  const rows = await database
    .select()
    .from(agentActivity)
    .where(and(...conditions))
    .orderBy(desc(agentActivity.createdAt))
    .limit(limit + 1);

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const last = rows.pop()!;
    nextCursor = last.createdAt.toISOString();
  }

  return { items: rows, nextCursor };
}

export async function getAgentActivity(
  agentId: string,
  cursor?: string,
  limit: number = 20,
  database = db,
) {
  const conditions = [
    eq(agentActivity.agentId, agentId),
    eq(agentActivity.visibility, 'public'),
  ];

  if (cursor) {
    conditions.push(lt(agentActivity.createdAt, new Date(cursor)));
  }

  const rows = await database
    .select()
    .from(agentActivity)
    .where(and(...conditions))
    .orderBy(desc(agentActivity.createdAt))
    .limit(limit + 1);

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const last = rows.pop()!;
    nextCursor = last.createdAt.toISOString();
  }

  return { items: rows, nextCursor };
}

// ============================================
// ENDORSEMENTS
// ============================================

export async function createEndorsement(
  endorserId: string,
  endorseeId: string,
  data: { skillId?: string; title: string; message?: string; relatedTaskId?: string },
  database = db,
) {
  if (endorserId === endorseeId) {
    throw new Error('Cannot endorse yourself');
  }

  let verified = false;

  // If a related task is provided, verify collaboration
  if (data.relatedTaskId) {
    const [task] = await database
      .select({ requesterId: tasks.requesterId, assigneeId: tasks.assigneeId })
      .from(tasks)
      .where(eq(tasks.id, data.relatedTaskId))
      .limit(1);

    if (task) {
      const parties = [task.requesterId, task.assigneeId];
      if (parties.includes(endorserId) && parties.includes(endorseeId)) {
        verified = true;
      }
    }
  }

  const [endorsement] = await database
    .insert(agentEndorsements)
    .values({
      endorserId,
      endorseeId,
      skillId: data.skillId ?? null,
      title: data.title,
      message: data.message ?? null,
      relatedTaskId: data.relatedTaskId ?? null,
      verified,
    })
    .returning();

  logger.info('Endorsement created', { endorserId, endorseeId, verified });
  return endorsement;
}

// ============================================
// FOLLOWING
// ============================================

export async function followAgent(
  followerId: string,
  followeeId: string,
  database = db,
) {
  await database
    .insert(agentFollowing)
    .values({ followerId, followeeId })
    .onConflictDoNothing();

  logger.info('Agent followed', { followerId, followeeId });
}

export async function unfollowAgent(
  followerId: string,
  followeeId: string,
  database = db,
) {
  await database
    .delete(agentFollowing)
    .where(
      and(
        eq(agentFollowing.followerId, followerId),
        eq(agentFollowing.followeeId, followeeId),
      ),
    );

  logger.info('Agent unfollowed', { followerId, followeeId });
}

export async function getFollowers(
  agentId: string,
  limit: number = 20,
  offset: number = 0,
  database = db,
) {
  const rows = await database
    .select({
      id: agents.id,
      displayName: agents.displayName,
      avatarUrl: agents.avatarUrl,
      followedAt: agentFollowing.createdAt,
    })
    .from(agentFollowing)
    .innerJoin(agents, eq(agentFollowing.followerId, agents.id))
    .where(eq(agentFollowing.followeeId, agentId))
    .orderBy(desc(agentFollowing.createdAt))
    .limit(limit)
    .offset(offset);

  return rows;
}

export async function getFollowing(
  agentId: string,
  limit: number = 20,
  offset: number = 0,
  database = db,
) {
  const rows = await database
    .select({
      id: agents.id,
      displayName: agents.displayName,
      avatarUrl: agents.avatarUrl,
      followedAt: agentFollowing.createdAt,
    })
    .from(agentFollowing)
    .innerJoin(agents, eq(agentFollowing.followeeId, agents.id))
    .where(eq(agentFollowing.followerId, agentId))
    .orderBy(desc(agentFollowing.createdAt))
    .limit(limit)
    .offset(offset);

  return rows;
}

// ============================================
// GUILDS
// ============================================

export async function createGuild(
  founderId: string,
  data: {
    name: string;
    description?: string;
    visibility?: string;
    guildType?: string;
    minMemberReputation?: number;
  },
  database = db,
) {
  const [guild] = await database
    .insert(agentGuilds)
    .values({
      name: data.name,
      description: data.description ?? null,
      founderId,
      visibility: data.visibility ?? 'public',
      guildType: data.guildType ?? null,
      minMemberReputation: data.minMemberReputation ?? 0,
    })
    .returning();

  // Auto-add founder as member
  await database.insert(guildMembers).values({
    guildId: guild.id,
    agentId: founderId,
    role: 'founder',
  });

  logger.info('Guild created', { guildId: guild.id, founderId });
  return guild;
}

export async function joinGuild(
  guildId: string,
  agentId: string,
  database = db,
) {
  const [guild] = await database
    .select()
    .from(agentGuilds)
    .where(eq(agentGuilds.id, guildId))
    .limit(1);

  if (!guild) {
    throw new Error('Guild not found');
  }

  if (!guild.acceptsNewMembers) {
    throw new Error('Guild is not accepting new members');
  }

  await database.insert(guildMembers).values({
    guildId,
    agentId,
    role: 'member',
  });

  await database
    .update(agentGuilds)
    .set({
      memberCount: sql`${agentGuilds.memberCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(agentGuilds.id, guildId));

  logger.info('Agent joined guild', { guildId, agentId });
}

export async function leaveGuild(
  guildId: string,
  agentId: string,
  database = db,
) {
  // Check if the agent is the founder
  const [member] = await database
    .select({ role: guildMembers.role })
    .from(guildMembers)
    .where(
      and(
        eq(guildMembers.guildId, guildId),
        eq(guildMembers.agentId, agentId),
      ),
    )
    .limit(1);

  if (!member) {
    throw new Error('Not a member of this guild');
  }

  if (member.role === 'founder') {
    throw new Error('Founders cannot leave their guild');
  }

  await database
    .delete(guildMembers)
    .where(
      and(
        eq(guildMembers.guildId, guildId),
        eq(guildMembers.agentId, agentId),
      ),
    );

  await database
    .update(agentGuilds)
    .set({
      memberCount: sql`${agentGuilds.memberCount} - 1`,
      updatedAt: new Date(),
    })
    .where(eq(agentGuilds.id, guildId));

  logger.info('Agent left guild', { guildId, agentId });
}

export async function listGuilds(
  limit: number = 20,
  offset: number = 0,
  database = db,
) {
  const rows = await database
    .select()
    .from(agentGuilds)
    .where(eq(agentGuilds.visibility, 'public'))
    .orderBy(desc(agentGuilds.createdAt))
    .limit(limit)
    .offset(offset);

  return rows;
}

export async function getGuild(
  guildId: string,
  database = db,
) {
  const [guild] = await database
    .select()
    .from(agentGuilds)
    .where(eq(agentGuilds.id, guildId))
    .limit(1);

  if (!guild) {
    return null;
  }

  const members = await database
    .select({
      id: agents.id,
      displayName: agents.displayName,
      avatarUrl: agents.avatarUrl,
      role: guildMembers.role,
      joinedAt: guildMembers.joinedAt,
    })
    .from(guildMembers)
    .innerJoin(agents, eq(guildMembers.agentId, agents.id))
    .where(eq(guildMembers.guildId, guildId))
    .orderBy(guildMembers.joinedAt);

  return { ...guild, members };
}

// ============================================
// CONVENIENCE HELPERS
// ============================================

export async function recordTaskCompletion(
  taskId: string,
  finalScore: number,
  database = db,
) {
  const [task] = await database
    .select({
      assigneeId: tasks.assigneeId,
      title: tasks.title,
      requesterId: tasks.requesterId,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!task?.assigneeId) return null;

  return recordActivity(
    task.assigneeId,
    'task_completed',
    `Completed task: ${task.title}`,
    undefined,
    { taskId, finalScore, requesterId: task.requesterId },
    'public',
    database,
  );
}

export async function recordSkillAdded(
  agentId: string,
  skillName: string,
  database = db,
) {
  return recordActivity(
    agentId,
    'skill_added',
    `Added skill: ${skillName}`,
    undefined,
    { skillName },
    'public',
    database,
  );
}
