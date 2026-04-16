/**
 * Integration test infrastructure.
 *
 * Provides a real-Postgres test environment for tests that need to exercise
 * locking, transaction boundaries, and other behaviour that fake DBs cannot.
 *
 * Pre-requisites:
 *  - The dev Postgres container (docker-compose) must be reachable.
 *  - DATABASE_URL must point at a DEDICATED test database (default
 *    `postgresql://swarmdock:swarmdock@localhost:5432/swarmdock_test`).
 *    The test:integration npm script sets this for you.
 *
 * On first use of a process, the test database is created if missing and
 * Drizzle migrations are applied. Between tests, callers should invoke
 * `truncateAll()` to reset state without paying the migration cost.
 */

import { sql } from 'drizzle-orm';
import pg from 'pg';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../../src/db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

const DEFAULT_TEST_URL = 'postgresql://swarmdock:swarmdock@localhost:5432/swarmdock_test';

let initialized = false;

function getTestUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_TEST_URL;
}

function getMaintenanceUrl(testUrl: string): string {
  // Same host/credentials, target the default `postgres` maintenance DB.
  // Used only to issue CREATE DATABASE if the test DB doesn't exist.
  const u = new URL(testUrl);
  u.pathname = '/postgres';
  return u.toString();
}

function getTestDbName(testUrl: string): string {
  return new URL(testUrl).pathname.replace(/^\//, '') || 'swarmdock_test';
}

async function ensureDatabaseExists(testUrl: string): Promise<void> {
  const dbName = getTestDbName(testUrl);
  const maintenancePool = new pg.Pool({ connectionString: getMaintenanceUrl(testUrl) });
  try {
    const { rows } = await maintenancePool.query<{ exists: boolean }>(
      `SELECT 1 AS exists FROM pg_database WHERE datname = $1`,
      [dbName],
    );
    if (rows.length === 0) {
      // Identifier interpolation is required because Postgres does not allow
      // parameter binding in DDL. Validate the name to keep injection-proof.
      if (!/^[a-z0-9_]+$/i.test(dbName)) {
        throw new Error(`Refusing to CREATE DATABASE with unsafe name: ${dbName}`);
      }
      await maintenancePool.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await maintenancePool.end();
  }

  // Ensure pgvector is installed in the (possibly new) test DB. The schema
  // uses vector(1536) columns, and drizzle-kit push fails without it.
  const dbPool = new pg.Pool({ connectionString: testUrl });
  try {
    await dbPool.query('CREATE EXTENSION IF NOT EXISTS vector');
  } finally {
    await dbPool.end();
  }
}

/**
 * Set up the test database (create if missing, push the live schema).
 *
 * Uses `drizzle-kit push` rather than the tracked migrations because the
 * historical migration files have a few `CREATE TABLE IF NOT EXISTS` statements
 * for tables that already exist, which silently skips column additions. Push
 * applies the current schema definition directly — exactly what a test DB
 * should look like. Idempotent — safe to call from every test file's `before()`.
 */
export async function setupTestDb(): Promise<void> {
  if (initialized) return;
  const testUrl = getTestUrl();

  await ensureDatabaseExists(testUrl);

  const result = spawnSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, DATABASE_URL: testUrl },
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(
      `drizzle-kit push failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }

  initialized = true;
}

/**
 * Truncate every table in the public schema with CASCADE + RESTART IDENTITY.
 * Discovers tables from information_schema so newly added tables don't break it.
 */
export async function truncateAll(): Promise<void> {
  // Re-import the singleton so callers don't have to plumb it through.
  const { db } = await import('../../src/db/client.js');

  const result = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '__drizzle%'
      AND tablename NOT LIKE 'drizzle_%'
  `);

  const tables = result.rows.map((r) => `"${r.tablename}"`);
  if (tables.length === 0) return;

  await db.execute(sql.raw(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`));
}

/**
 * Insert an agent row with sensible defaults; override any field via `overrides`.
 * Returns the inserted row (with generated id).
 */
export async function createTestAgent(
  overrides: Partial<typeof schema.agents.$inferInsert> = {},
): Promise<typeof schema.agents.$inferSelect> {
  const { db } = await import('../../src/db/client.js');
  const suffix = Math.random().toString(36).slice(2, 10);
  const [row] = await db
    .insert(schema.agents)
    .values({
      publicKey: `test-pk-${suffix}`,
      did: `did:web:swarmdock.ai:agents:test-${suffix}`,
      displayName: `Test Agent ${suffix}`,
      walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
      status: 'active',
      trustLevel: 2,
      ...overrides,
    })
    .returning();
  return row;
}

/**
 * Insert a task row with sensible defaults; requires a valid requesterId
 * (use createTestAgent first). Returns the inserted row.
 */
export async function createTestTask(
  requesterId: string,
  overrides: Partial<typeof schema.tasks.$inferInsert> = {},
): Promise<typeof schema.tasks.$inferSelect> {
  const { db } = await import('../../src/db/client.js');
  const [row] = await db
    .insert(schema.tasks)
    .values({
      requesterId,
      title: 'Test task',
      description: 'Integration test fixture task',
      skillRequirements: ['test'],
      budgetMax: 5_000_000n,
      status: 'open',
      visibility: 'public',
      ...overrides,
    })
    .returning();
  return row;
}
