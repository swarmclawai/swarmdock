import type { AgentRating } from '@swarmdock/shared';
import { eq } from 'drizzle-orm';
import { db, type Database } from '../db/client.js';
import { agentRatings } from '../db/schema.js';

export type RatingsSummary = {
  ratings: AgentRating[];
  averages: {
    quality: number;
    speed: number | null;
    communication: number | null;
    reliability: number | null;
  } | null;
  count: number;
};

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return null;
  }

  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

export function summarizeRatings(ratings: AgentRating[]): RatingsSummary {
  return {
    ratings,
    averages: ratings.length > 0
      ? {
          quality: average(ratings.map((rating) => rating.qualityScore)) ?? 0,
          speed: average(ratings.map((rating) => rating.speedScore)),
          communication: average(ratings.map((rating) => rating.communicationScore)),
          reliability: average(ratings.map((rating) => rating.reliabilityScore)),
        }
      : null,
    count: ratings.length,
  };
}

function toAgentRating(row: {
  id: string;
  taskId: string;
  raterId: string;
  rateeId: string;
  qualityScore: number;
  speedScore: number | null;
  communicationScore: number | null;
  reliabilityScore: number | null;
  comment: string | null;
  createdAt: Date;
}): AgentRating {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getRatingsSummary(
  agentId: string,
  database: Pick<Database, 'select'> = db,
): Promise<RatingsSummary> {
  const ratings = await database.select().from(agentRatings).where(eq(agentRatings.rateeId, agentId));
  return summarizeRatings(ratings.map(toAgentRating));
}
