/**
 * Database schema.
 *
 * This file is intentionally near-empty. The real tables for each project are
 * defined by that project's spec — for Project 1 (Trading Journal) that lands
 * in VCI-3. Writing the schema is core work, not scaffolding.
 *
 * The one table below is here so `drizzle-kit generate` has something to
 * produce a migration from, which proves the migration pipeline works before
 * any real modelling starts. Delete it once real tables exist.
 *
 * Conventions worth keeping:
 * - `timestamp` columns use `withTimezone: true`. Trading data is timestamped
 *   in UTC and rendered in the user's zone; a naive timestamp loses that and
 *   the bug only shows up across a DST boundary.
 * - Money and prices use `numeric`, never `double precision`. Floating point
 *   cannot represent 0.1 exactly, and rounding drift in a P&L column is the
 *   kind of bug that destroys trust in a finance app.
 */
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const healthcheck = pgTable("healthcheck", {
  id: uuid("id").primaryKey().defaultRandom(),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Healthcheck = typeof healthcheck.$inferSelect;
export type NewHealthcheck = typeof healthcheck.$inferInsert;
