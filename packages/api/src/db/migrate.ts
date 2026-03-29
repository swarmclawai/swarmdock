import { execSync } from 'node:child_process';

/**
 * Production migration runner.
 * Executes `drizzle-kit push` to apply schema changes to the database.
 *
 * Note: execSync is used here with a hardcoded command string (no user input),
 * so there is no command injection risk.
 */
function main() {
  console.log('Running database migrations...');

  try {
    execSync('npx drizzle-kit push', {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? 'production',
      },
    });
    console.log('Migrations completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main();
