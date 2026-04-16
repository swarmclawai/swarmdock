-- 0006: peer-review deadline + decline tracking.
--
-- A peer reviewer who never responds used to pin the evaluation open
-- indefinitely. Adding an explicit deadline plus a decline list lets
-- finalizeEvaluation close the pipeline with a reduced quorum when a
-- reviewer ghosts or explicitly declines.

ALTER TABLE "quality_evaluations" ADD COLUMN IF NOT EXISTS "peer_review_deadline_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "quality_evaluations" ADD COLUMN IF NOT EXISTS "peer_review_declined" uuid[];
