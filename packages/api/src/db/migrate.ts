import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Production migration runner.
 * Applies tracked SQL migrations from the drizzle/ folder using drizzle-orm's
 * migrate function. Migrations are generated via `drizzle-kit generate` and
 * tracked in `drizzle/meta/_journal.json`.
 */
async function main() {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://swarmdock:swarmdock@localhost:5432/swarmdock';

  console.log('Running database migrations...');

  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool);

  try {
    // Resolve the drizzle migrations folder relative to this file.
    // In dev (tsx): src/db/migrate.ts -> ../../drizzle
    // In prod (compiled): dist/db/migrate.js -> ../../drizzle
    const migrationsFolder = path.resolve(__dirname, '..', '..', 'drizzle');

    await migrate(db, { migrationsFolder });
    console.log('Migrations completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
