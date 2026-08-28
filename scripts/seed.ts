/**
 * Seeds the database with demo data.
 *
 * Run with `npm run db:seed`. Right now it only proves the connection and
 * migrations work — the real seed logic lands once the project's schema exists
 * (Project 1's schema comes from the spec in VCI-3).
 *
 * The plan calls for seed data so a recruiter can open the live URL and click
 * around without signing up, so this script should eventually insert a demo
 * account plus the generated trades from `npm run fixtures`.
 */
import { db } from "../src/db";
import { healthcheck } from "../src/db/schema";

async function main() {
  const [row] = await db.insert(healthcheck).values({ note: "seed ran" }).returning();

  console.log("Seed OK — inserted:", row);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
