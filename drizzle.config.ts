import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit reads this to generate and apply migrations. It runs as a plain
 * CLI outside Next.js, so it reads process.env directly rather than @/env.
 */
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Run drizzle-kit through `npm run db:*` scripts.");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
  // Emitted migrations are plain, readable SQL — review them before applying.
  verbose: true,
  strict: true,
});
