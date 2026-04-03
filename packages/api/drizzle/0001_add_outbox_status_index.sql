CREATE INDEX IF NOT EXISTS "idx_event_outbox_status_created" ON "event_outbox" ("status", "created_at");
