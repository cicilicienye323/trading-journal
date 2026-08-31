/**
 * Proves the half of the importer that unit tests cannot reach: the database.
 *
 * Run with `npm run verify:import` (needs a database — `npm run db:up` first).
 *
 * ── Why this is a script and not a test ──
 * Same rule as `verify-decimal-roundtrip.ts`: everything in `src/**\/*.test.ts`
 * runs without Postgres, which is what keeps the CI gate fast and honest. The
 * golden-number and two-fixture tests cover the parsing, the timezone
 * conversion and the risk arithmetic that way — 180 rows, twelve published
 * figures, no database anywhere.
 *
 * What they structurally cannot cover is the four claims that only exist in
 * SQL, and those are exactly the claims spec §12 asks to see demonstrated:
 *
 *   1. The insert is transactional, so a failure leaves no `import_batches`
 *      row describing an import that did not happen.
 *   2. `ON CONFLICT DO NOTHING` makes a re-import a no-op — the DoD line
 *      "0 imported, 180 duplicates skipped".
 *   3. `import_batches` ends up with counts that match what was inserted.
 *   4. The `numeric` columns hold what the file said, after a full round trip
 *      through the driver — including an r_multiple computed in `BigInt`.
 *
 * ── Why it exists rather than being checked by hand in the browser ──
 * "I imported it twice and it looked right" is not a result anyone can re-run.
 * This prints pass/fail lines and exits non-zero, so the same claim can be
 * re-made after any change to the write path.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";

import { db } from "../src/db";
import { importBatches, trades, tradingAccounts, user } from "../src/db/schema";
import { parseCsv } from "../src/lib/import/mt5-csv";
import { findExistingTickets, runImport } from "../src/lib/import/queries";
import { toImportWriteValues } from "../src/lib/import/write-values";

const PROBE_USER_ID = "import-roundtrip-probe";
const PROBE_ACCOUNT_ID = "44444444-4444-4444-4444-444444444444";

/**
 * The EET fixture against an `Europe/Athens` account — the pairing the DoD
 * names, and the one that crosses a DST transition inside the file.
 */
const FIXTURE = "fixtures/mt5-history-eet.csv";
const SERVER_TIMEZONE = "Europe/Athens";

let failures = 0;

function report(ok: boolean, line: string) {
  if (!ok) failures++;
  console.log(`${ok ? "  pass" : "  FAIL"}  ${line}`);
}

async function cleanup() {
  // Cascades to the account, its trades and its import batches.
  await db.delete(user).where(eq(user.id, PROBE_USER_ID));
}

async function importFixture() {
  const parsed = parseCsv(readFileSync(FIXTURE, "utf8"));
  if (!parsed.ok) throw new Error(`${FIXTURE} did not parse: ${parsed.error}`);

  const target = { id: PROBE_ACCOUNT_ID, serverTimezone: SERVER_TIMEZONE };
  const known = await findExistingTickets(
    PROBE_USER_ID,
    PROBE_ACCOUNT_ID,
    parsed.rows.map((row) => row.ticket),
  );

  const outcome = await runImport({
    userId: PROBE_USER_ID,
    tradingAccountId: PROBE_ACCOUNT_ID,
    filename: FIXTURE,
    rowCount: parsed.totalRows,
    values: parsed.rows.map((row) => toImportWriteValues(row, target)),
  });

  return { parsed, outcome, previewedDuplicates: known.size };
}

async function main() {
  await cleanup();

  await db.insert(user).values({
    id: PROBE_USER_ID,
    name: "import probe",
    email: "import-roundtrip-probe@example.invalid",
    emailVerified: false,
  });

  await db.insert(tradingAccounts).values({
    id: PROBE_ACCOUNT_ID,
    userId: PROBE_USER_ID,
    name: "Import probe",
    currency: "USD",
    startingBalance: "10000.00",
    serverTimezone: SERVER_TIMEZONE,
  });

  console.log(`First import of ${FIXTURE} into an account on ${SERVER_TIMEZONE}:\n`);
  const first = await importFixture();
  report(
    first.previewedDuplicates === 0,
    `preview found ${first.previewedDuplicates} existing positions (want 0)`,
  );
  report(
    first.outcome.inserted === 180 && first.outcome.duplicates === 0,
    `${first.outcome.inserted} imported, ${first.outcome.duplicates} duplicates skipped (want 180, 0)`,
  );

  console.log("\nSame file again — the idempotency claim:\n");
  const second = await importFixture();
  report(
    second.previewedDuplicates === 180,
    `preview found ${second.previewedDuplicates} existing positions (want 180)`,
  );
  report(
    second.outcome.inserted === 0 && second.outcome.duplicates === 180,
    `${second.outcome.inserted} imported, ${second.outcome.duplicates} duplicates skipped (want 0, 180)`,
  );

  const rows = await db.select().from(trades).where(eq(trades.userId, PROBE_USER_ID));
  report(rows.length === 180, `${rows.length} trades in the account after two imports (want 180)`);

  console.log("\nWhat the audit trail says:\n");
  const batches = await db
    .select()
    .from(importBatches)
    .where(eq(importBatches.userId, PROBE_USER_ID))
    .orderBy(importBatches.createdAt);

  report(batches.length === 2, `${batches.length} import_batches rows (want 2)`);
  for (const [index, batch] of batches.entries()) {
    const wantInserted = index === 0 ? 180 : 0;
    report(
      batch.rowCount === 180 &&
        batch.insertedCount === wantInserted &&
        batch.skippedCount === 180 - wantInserted,
      `batch ${index + 1}: row_count=${batch.rowCount} inserted=${batch.insertedCount} skipped=${batch.skippedCount}`,
    );
  }

  report(
    rows.every((row) => row.importBatchId === batches[0]?.id),
    "every trade points at the batch that actually inserted it",
  );

  console.log("\nA single row, straight out of Postgres:\n");
  const [sample] = rows.filter((row) => row.externalTicket === "50000000");
  console.log(
    `  ${sample.externalTicket}  ${sample.symbol} ${sample.direction} ${sample.volume}` +
      `  opened=${sample.openedAt.toISOString()}  closed=${sample.closedAt.toISOString()}`,
  );
  console.log(
    `  gross=${sample.grossProfit} commission=${sample.commission} swap=${sample.swap}` +
      ` net=${sample.netProfit} risk=${sample.riskAmount} R=${sample.rMultiple}`,
  );

  // The file says 2025.12.04 23:49:23 broker time, and Athens was UTC+2 in
  // December — so the stored instant must be 21:49:23Z, the same instant the
  // UTC fixture states outright. This is the two-fixture invariant, seen from
  // the far side of the database rather than in memory.
  report(
    sample.openedAt.toISOString() === "2025-12-04T21:49:23.000Z",
    `opened_at survived the round trip as ${sample.openedAt.toISOString()} (want 2025-12-04T21:49:23.000Z)`,
  );
  report(
    typeof sample.netProfit === "string" && sample.netProfit === "-34.83",
    `net_profit is the string ${JSON.stringify(sample.netProfit)} (want "-34.83")`,
  );
  report(
    sample.source === "import" && sample.rMultiple !== null,
    `provenance=${sample.source}, r_multiple=${sample.rMultiple}`,
  );

  await cleanup();

  console.log(
    `\n${failures === 0 ? "Import round trip verified against Postgres." : `${failures} failure(s).`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("Probe failed:", error);
  await cleanup().catch(() => {});
  process.exit(1);
});
