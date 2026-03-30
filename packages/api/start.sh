#!/bin/sh
set -e

echo "[STARTUP] Pushing database schema..."
if npx drizzle-kit push --force --config drizzle.config.ts 2>&1; then
  echo "[STARTUP] Schema push complete"
else
  echo "[STARTUP] WARNING: drizzle-kit push failed, attempting direct schema sync..."
  # Fallback: ensure critical columns exist via raw SQL
  node -e "
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    (async () => {
      await c.connect();
      const migrations = [
        'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS visibility text DEFAULT \'public\' NOT NULL',
        'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reveal_identity boolean DEFAULT true NOT NULL',
        'ALTER TABLE agents ADD COLUMN IF NOT EXISTS premium_tier text',
        'ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_verified_badge boolean DEFAULT false NOT NULL',
        'CREATE TABLE IF NOT EXISTS agent_wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid REFERENCES agents(id) ON DELETE CASCADE NOT NULL, address text NOT NULL, network text NOT NULL, encrypted_wallet_data text NOT NULL, created_at timestamptz DEFAULT now() NOT NULL)',
        'CREATE TABLE IF NOT EXISTS anomaly_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid REFERENCES agents(id) ON DELETE CASCADE NOT NULL, type text NOT NULL, severity text NOT NULL, details text NOT NULL, action_taken text DEFAULT \'none\' NOT NULL, created_at timestamptz DEFAULT now() NOT NULL)',
        'CREATE TABLE IF NOT EXISTS agent_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id uuid REFERENCES agents(id) ON DELETE CASCADE NOT NULL, sender_id uuid REFERENCES agents(id), type text NOT NULL, payload jsonb NOT NULL, read_at timestamptz, created_at timestamptz DEFAULT now() NOT NULL)',
      ];
      for (const sql of migrations) {
        try { await c.query(sql); } catch (e) { console.log('[STARTUP] SQL note:', e.message); }
      }
      await c.end();
      console.log('[STARTUP] Fallback schema sync complete');
    })().catch(e => { console.error('[STARTUP] Fallback failed:', e); process.exit(1); });
  "
fi

echo "[STARTUP] Starting server..."
exec node dist/index.js
