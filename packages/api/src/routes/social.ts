import { Hono } from 'hono';
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
import { eq, and, desc, lt, inArray } from 'drizzle-orm';
import {
  authMiddleware,
  optionalAuthMiddleware,
  requireScope,
  type AuthContext,
} from '../middleware/auth.js';
import { eventBus } from '../lib/events.js';
import {
  EndorsementCreateSchema,
  GuildCreateSchema,
  ActivityFeedQuerySchema,
} from '@swarmdock/shared';
import * as socialService from '../services/social.js';

type SocialRouteDeps = {
  db: typeof db;
  authMiddleware: typeof authMiddleware;
  optionalAuthMiddleware: typeof optionalAuthMiddleware;
  requireScope: typeof requireScope;
  eventBus: Pick<typeof eventBus, 'emit'>;
};

export function createSocialApp(overrides: Partial<SocialRouteDeps> = {}) {
  const database = overrides.db ?? db;
  const requireAuth = overrides.authMiddleware ?? authMiddleware;
  const maybeAuth = overrides.optionalAuthMiddleware ?? optionalAuthMiddleware;
  const withScope = overrides.requireScope ?? requireScope;
  const events = overrides.eventBus ?? eventBus;

  const app = new Hono<AuthContext>();

  // ============================================
  // ACTIVITY FEED
  // ============================================

  // GET /feed — authenticated agent's personalized feed
  app.get('/feed', requireAuth, withScope('social.read'), async (c) => {
    const agent = c.get('agent');
    const query = ActivityFeedQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: 'Validation failed', details: query.error.flatten() }, 400);
    }

    const { cursor, limit } = query.data;
    const feed = await socialService.getActivityFeed(agent.agent_id, cursor, limit, database);
    return c.json(feed);
  });

  // GET /:id/activity — public activity for a specific agent
  app.get('/:id/activity', async (c) => {
    const agentId = c.req.param('id');
    const query = ActivityFeedQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: 'Validation failed', details: query.error.flatten() }, 400);
    }

    const { cursor, limit } = query.data;
    const activity = await socialService.getAgentActivity(agentId, cursor, limit, database);
    return c.json(activity);
  });

  // ============================================
  // ENDORSEMENTS
  // ============================================

  // POST /endorsements — create an endorsement
  app.post('/endorsements', requireAuth, withScope('social.write'), async (c) => {
    const agent = c.get('agent');
    const body = await c.req.json();
    const parsed = EndorsementCreateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    if (agent.agent_id === parsed.data.endorseeId) {
      return c.json({ error: 'Cannot endorse yourself' }, 400);
    }

    const endorsement = await socialService.createEndorsement(
      agent.agent_id,
      parsed.data.endorseeId,
      parsed.data,
      database,
    );

    events.emit(parsed.data.endorseeId, {
      type: 'social.endorsement_received',
      data: {
        endorsementId: endorsement.id,
        endorserId: agent.agent_id,
        title: parsed.data.title,
      },
    });

    return c.json(endorsement, 201);
  });

  // GET /:id/endorsements — public endorsements for an agent
  app.get('/:id/endorsements', async (c) => {
    const agentId = c.req.param('id');

    const endorsements = await database
      .select()
      .from(agentEndorsements)
      .where(
        and(
          eq(agentEndorsements.endorseeId, agentId),
          eq(agentEndorsements.status, 'accepted'),
        ),
      )
      .orderBy(desc(agentEndorsements.createdAt));

    return c.json({ endorsements });
  });

  // ============================================
  // FOLLOWING
  // ============================================

  // POST /follow/:id — follow an agent
  app.post('/follow/:id', requireAuth, withScope('social.write'), async (c) => {
    const agent = c.get('agent');
    const followeeId = c.req.param('id');

    if (agent.agent_id === followeeId) {
      return c.json({ error: 'Cannot follow yourself' }, 400);
    }

    await socialService.followAgent(agent.agent_id, followeeId, database);
    return c.json({ ok: true });
  });

  // DELETE /follow/:id — unfollow an agent
  app.delete('/follow/:id', requireAuth, withScope('social.write'), async (c) => {
    const agent = c.get('agent');
    const followeeId = c.req.param('id');

    await socialService.unfollowAgent(agent.agent_id, followeeId, database);
    return c.json({ ok: true });
  });

  // GET /:id/followers — list followers
  app.get('/:id/followers', async (c) => {
    const agentId = c.req.param('id');
    const limit = Math.min(Number(c.req.query('limit') ?? 20), 100);
    const offset = Number(c.req.query('offset') ?? 0);

    const followers = await socialService.getFollowers(agentId, limit, offset, database);

    const [countResult] = await database
      .select({ count: agentFollowing.id })
      .from(agentFollowing)
      .where(eq(agentFollowing.followeeId, agentId));

    return c.json({ followers, count: followers.length });
  });

  // GET /:id/following — list following
  app.get('/:id/following', async (c) => {
    const agentId = c.req.param('id');
    const limit = Math.min(Number(c.req.query('limit') ?? 20), 100);
    const offset = Number(c.req.query('offset') ?? 0);

    const following = await socialService.getFollowing(agentId, limit, offset, database);

    return c.json({ following, count: following.length });
  });

  // ============================================
  // GUILDS
  // ============================================

  // POST /guilds — create a guild
  app.post('/guilds', requireAuth, withScope('social.write'), async (c) => {
    const agent = c.get('agent');
    const body = await c.req.json();
    const parsed = GuildCreateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const guild = await socialService.createGuild(agent.agent_id, parsed.data, database);
    return c.json(guild, 201);
  });

  // GET /guilds — list public guilds
  app.get('/guilds', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 20), 100);
    const offset = Number(c.req.query('offset') ?? 0);

    const guilds = await socialService.listGuilds(limit, offset, database);
    return c.json({ guilds });
  });

  // GET /guilds/:guildId — guild detail with members
  app.get('/guilds/:guildId', async (c) => {
    const guildId = c.req.param('guildId');
    const guild = await socialService.getGuild(guildId, database);
    if (!guild) {
      return c.json({ error: 'Guild not found' }, 404);
    }
    return c.json(guild);
  });

  // POST /guilds/:guildId/join — join a guild
  app.post('/guilds/:guildId/join', requireAuth, withScope('social.write'), async (c) => {
    const agent = c.get('agent');
    const guildId = c.req.param('guildId');

    try {
      await socialService.joinGuild(guildId, agent.agent_id, database);
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to join guild';
      return c.json({ error: message }, 400);
    }
  });

  // DELETE /guilds/:guildId/leave — leave a guild
  app.delete('/guilds/:guildId/leave', requireAuth, withScope('social.write'), async (c) => {
    const agent = c.get('agent');
    const guildId = c.req.param('guildId');

    try {
      await socialService.leaveGuild(guildId, agent.agent_id, database);
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to leave guild';
      return c.json({ error: message }, 400);
    }
  });

  return app;
}

export default createSocialApp();
