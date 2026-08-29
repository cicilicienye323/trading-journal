/**
 * Seeds the database with demo data.
 *
 * Run with `npm run db:seed`.
 *
 * ── Why this is still a stub after Slice 1b ──
 * It used to insert a row into the scaffolding `healthcheck` table, which Slice
 * 1b dropped, so it had to change in that same commit or the build would break.
 * It was rewritten as a connectivity check rather than filled in, because the
 * real seed is spec §9 and it is deliberately *not* a pile of `INSERT`s:
 *
 *   - a demo user, `demo@example.com`, created through **Better Auth's own API**
 *     so the password hash is produced the same way a real sign-up produces it
 *     (writing the `account` row by hand gives a user who can never log in);
 *   - one trading account, "Demo Prop Challenge — 10K", USD, starting balance
 *     10 000, `server_timezone = 'Europe/Athens'`, 10% max drawdown, 5% daily
 *     loss;
 *   - 180 trades loaded from `fixtures/mt5-history-eet.csv` **through the same
 *     importer the user uses** — not a second, seed-only generator. A separate
 *     path would mean the seed can pass while the importer is broken, which
 *     throws away the cheapest importer test there is;
 *   - one synthetic bad day, because the fixture's worst real day is −2.52%
 *     against a 5% limit, so the daily-loss panel would otherwise show an empty
 *     state forever. Spec §9 has the numbers and the reasoning.
 *
 * That means the real seed depends on the Slice 2 importer existing. It is
 * tracked as VCI-9, not as leftover work here.
 *
 * The point of the seed is that a recruiter can open the live URL and click
 * around without signing up — most people close the tab rather than register.
 */
import { sql } from "drizzle-orm";

import { db } from "../src/db";

async function main() {
  // Proves the connection string resolves and migrations have been applied,
  // which is what this script is good for until §9's data lands. Asking the
  // catalog rather than selecting from `trades` keeps "table missing" as a
  // clear message instead of a driver error.
  const rows = await db.execute<{ present: boolean }>(
    sql`select to_regclass('public.trades') is not null as present`,
  );

  if (!rows[0]?.present) {
    throw new Error("`trades` table not found — run `npm run db:migrate` first.");
  }

  console.log("Seed OK — database reachable and migrated.");
  console.log("Demo data lands with the Slice 2 importer (spec §9, tracked in VCI-9).");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
