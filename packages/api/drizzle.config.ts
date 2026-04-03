import { defineConfig } from 'drizzle-kit';

// drizzle-kit needs BigInt JSON serialization for snapshot diffing
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://swarmdock:swarmdock@localhost:5432/swarmdock',
  },
});
