import { db } from '../db/client.js';
import { taskBids, agentRatings, agents } from '../db/schema.js';
import { sql, gt, and, eq } from 'drizzle-orm';
import { AGENT_STATUS } from '@swarmdock/shared';

export interface AnomalyReport {
  agentId: string;
  type: 'rapid_bidding' | 'rating_manipulation' | 'dormancy_evasion';
  details: string;
  severity: 'low' | 'medium' | 'high';
  detectedAt: Date;
}

const RAPID_BIDDING_THRESHOLD = 50; // bids per hour
const COLLUSION_WINDOW_HOURS = 24;
const COLLUSION_MUTUAL_MIN = 3;
const COLLUSION_AVG_MIN = 0.85;

/**
 * Detect agents placing an excessive number of bids in the last hour.
 */
async function detectRapidBidding(): Promise<AnomalyReport[]> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const results = await db
    .select({
      bidderId: taskBids.bidderId,
      bidCount: sql<number>`count(*)`.as('bid_count'),
    })
    .from(taskBids)
    .where(gt(taskBids.createdAt, oneHourAgo))
    .groupBy(taskBids.bidderId)
    .having(sql`count(*) > ${RAPID_BIDDING_THRESHOLD}`);

  return results.map((r) => ({
    agentId: r.bidderId,
    type: 'rapid_bidding' as const,
    details: `${r.bidCount} bids in the last hour (threshold: ${RAPID_BIDDING_THRESHOLD})`,
    severity: r.bidCount > RAPID_BIDDING_THRESHOLD * 2 ? 'high' as const : 'medium' as const,
    detectedAt: new Date(),
  }));
}

/**
 * Detect mutual high-rating clusters submitted within a short time window.
 * Tighter than the weight-based collusion check in reputation.ts — this looks at timing.
 */
async function detectRatingManipulation(): Promise<AnomalyReport[]> {
  const windowStart = new Date(Date.now() - COLLUSION_WINDOW_HOURS * 60 * 60 * 1000);

  // Find pairs where A rates B and B rates A within the window, with high scores
  const results = await db.execute(sql`
    WITH recent_ratings AS (
      SELECT rater_id, ratee_id, overall_score, created_at
      FROM agent_ratings
      WHERE created_at > ${windowStart}
    )
    SELECT
      r1.rater_id AS agent_a,
      r1.ratee_id AS agent_b,
      count(*) AS mutual_count,
      avg(r1.overall_score) AS avg_score_a_to_b,
      avg(r2.overall_score) AS avg_score_b_to_a
    FROM recent_ratings r1
    JOIN recent_ratings r2
      ON r1.rater_id = r2.ratee_id
      AND r1.ratee_id = r2.rater_id
    GROUP BY r1.rater_id, r1.ratee_id
    HAVING count(*) >= ${COLLUSION_MUTUAL_MIN}
      AND avg(r1.overall_score) > ${COLLUSION_AVG_MIN}
      AND avg(r2.overall_score) > ${COLLUSION_AVG_MIN}
  `);

  const reports: AnomalyReport[] = [];
  const seen = new Set<string>();

  for (const row of results.rows as Array<{ agent_a: string; agent_b: string; mutual_count: number }>) {
    const key = [row.agent_a, row.agent_b].sort().join(':');
    if (seen.has(key)) continue;
    seen.add(key);

    reports.push({
      agentId: row.agent_a,
      type: 'rating_manipulation',
      details: `Mutual high-rating cluster with agent ${row.agent_b}: ${row.mutual_count} mutual ratings within ${COLLUSION_WINDOW_HOURS}h`,
      severity: 'high',
      detectedAt: new Date(),
    });
  }

  return reports;
}

/**
 * Detect agents sending heartbeats without any actual activity (no tasks, no bids, no ratings).
 * Agents whose lastHeartbeat is recent but lastActiveAt hasn't advanced in 7+ days.
 */
async function detectDormancyEvasion(): Promise<AnomalyReport[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const results = await db
    .select({ id: agents.id, displayName: agents.displayName })
    .from(agents)
    .where(
      and(
        eq(agents.status, AGENT_STATUS.ACTIVE),
        gt(agents.lastHeartbeat, oneHourAgo), // Recent heartbeat
        sql`(${agents.lastActiveAt} IS NULL OR ${agents.lastActiveAt} < ${sevenDaysAgo})`, // No recent activity
      ),
    );

  return results.map((r) => ({
    agentId: r.id,
    type: 'dormancy_evasion' as const,
    details: `Agent ${r.displayName} sending heartbeats but no activity in 7+ days`,
    severity: 'low' as const,
    detectedAt: new Date(),
  }));
}

/**
 * Run all anomaly detection checks and log results.
 * Future: write to anomaly_events table and trigger admin alerts.
 */
export async function runAnomalyDetection(): Promise<AnomalyReport[]> {
  const [bidding, manipulation, evasion] = await Promise.all([
    detectRapidBidding(),
    detectRatingManipulation(),
    detectDormancyEvasion(),
  ]);

  const allReports = [...bidding, ...manipulation, ...evasion];

  for (const report of allReports) {
    console.warn(
      `[ANOMALY] ${report.severity.toUpperCase()} ${report.type}: agent ${report.agentId} — ${report.details}`,
    );
  }

  if (allReports.length > 0) {
    console.log(`[ANOMALY] detected ${allReports.length} anomalies`);
  }

  return allReports;
}
