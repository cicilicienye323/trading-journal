/**
 * Database schema.
 *
 * This is the file you write the project's tables in. The real tables for
 * Project 1 (Trading Journal) are specified in VCI-3 §4 — `trading_accounts`,
 * `trades`, `import_batches`, and the enums. Writing them is core work, not
 * scaffolding, so they are deliberately not here yet.
 *
 * The `healthcheck` table below is scaffolding: it exists so the migration
 * pipeline had something to prove itself against before any real modelling
 * started. `/api/health` still reads it, so delete it and that route together,
 * once you have real tables.
 *
 * Naming trap, and it is a real one: Better Auth already owns a table called
 * `account` — it holds OAuth provider links and password hashes, nothing to do
 * with trading. Your broker account table must be named `trading_accounts`,
 * never `account`, or the two collide. Those tables live in `auth-schema.ts`
 * and are re-exported below; you should not need to edit that file.
 *
 * Conventions worth keeping:
 * - `timestamp` columns use `withTimezone: true`. Trading data is timestamped
 *   in UTC and rendered in the user's zone; a naive timestamp loses that and
 *   the bug only shows up across a DST boundary.
 * - Money and prices use `numeric`, never `double precision`. Floating point
 *   cannot represent 0.1 exactly, and rounding drift in a P&L column is the
 *   kind of bug that destroys trust in a finance app.
 * - Foreign keys to the signed-in user are `text` referencing `user.id`, not
 *   `uuid`. Better Auth generates string ids; spec §4.2 matches this.
 */
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Better Auth's tables. Re-exported so drizzle-kit sees a single schema entry
 * point and the Drizzle client has every table in scope — not because you need
 * to touch them.
 */
export * from "./auth-schema";

export const healthcheck = pgTable("healthcheck", {
  id: uuid("id").primaryKey().defaultRandom(),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Healthcheck = typeof healthcheck.$inferSelect;
export type NewHealthcheck = typeof healthcheck.$inferInsert;
