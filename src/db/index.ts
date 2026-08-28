import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/env";
import * as schema from "./schema";

/**
 * Postgres connection + Drizzle client.
 *
 * Next.js dev mode reloads modules on every edit. Without caching the client on
 * `globalThis`, each reload opens a fresh pool and the old ones are never
 * closed — you run out of Postgres connections after a few dozen saves.
 * Production runs this module once, so the cache is a dev-only concern.
 */
const globalForDb = globalThis as unknown as {
  connection: ReturnType<typeof postgres> | undefined;
};

const connection =
  globalForDb.connection ??
  postgres(env.DATABASE_URL, {
    // Serverless functions are short-lived and Neon pools on its side, so a
    // large client-side pool just holds connections open for nothing.
    max: env.NODE_ENV === "production" ? 1 : 5,
  });

if (env.NODE_ENV !== "production") {
  globalForDb.connection = connection;
}

export const db = drizzle(connection, { schema });

export type Database = typeof db;
