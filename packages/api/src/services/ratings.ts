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
    value: number | null;
    overall: number;
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

export function computeOverallScore(rating: {
  qualityScore: number;
  speedScore: number | null;
  communicationScore: number | null;
  reliabilityScore: number | null;
  valueScore: number | null;
}): number {
  const q = rating.qualityScore;
  const s = rating.speedScore ?? q;
  const c = rating.communicationScore ?? q;
  const r = rating.reliabilityScore ?? q;
  const v = rating.valueScore ?? q;
  return q * 0.3 + s * 0.2 + c * 0.15 + r * 0.25 + v * 0.1;
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
          value: average(ratings.map((rating) => rating.valueScore)),
          overall: average(ratings.map((rating) => rating.overallScore)) ?? 0,
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
  valueScore: number | null;
  overallScore: number;
  evidence: unknown;
  comment: string | null;
  raterReputationAtTime: number | null;
  weight: number | null;
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
