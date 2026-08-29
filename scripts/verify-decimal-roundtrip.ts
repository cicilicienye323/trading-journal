/**
 * Proves a decimal survives the full round trip unchanged:
 *
 *   app -> Zod -> Drizzle -> postgres-js -> Postgres -> back -> app
 *
 * Run with `npm run verify:decimals` (needs a database — see below).
 *
 * ── Why this is a script and not a unit test ──
 * Everything in `src/**\/*.test.ts` runs without a database, on purpose: it keeps
 * CI fast and keeps the test suite honest about being unit tests. This check
 * cannot honour that rule, because the thing it verifies *is* the database
 * round trip. So it lives here, is run deliberately, and is not part of
 * `npm run verify`.
 *
 * ── Why it is worth having at all ──
 * `lib/money.ts` keeps floats out of the write path, and that half is provable
 * by reading the code. The read path is not: the driver decides how to decode a
 * `numeric` wire value, and if any layer parses it into a JS number then the
 * exactness is destroyed on the way *out*, no matter how careful the way in
 * was. Drizzle's `numeric` maps to `string`, but that is a claim about types —
 * this asserts the runtime behaviour, with values a double provably cannot
 * represent.
 *
 * The final section prints what the naive float implementation would have
 * produced for the same sums, so the difference is visible rather than asserted.
 */
import { eq } from "drizzle-orm";

import { db } from "../src/db";
import { trades, tradingAccounts, user } from "../src/db/schema";

const PROBE_USER_ID = "decimal-roundtrip-probe";
const PROBE_ACCOUNT_ID = "33333333-3333-3333-3333-333333333333";
const BIG = "12345678901234.99";

/** Values picked because binary floating point cannot represent them exactly. */
const CASES = [
  {
    label: "0.1 + 0.2",
    gross: "0.10",
    commission: "0.20",
    swap: "0.00",
    net: "0.30",
  },
  {
    label: "full numeric(18,2)",
    gross: BIG,
    commission: "0.00",
    swap: "0.00",
    net: BIG,
  },
  {
    // A float round trip renders this as "1.5" and the column's scale is lost.
    label: "trailing zero preserved",
    gross: "1.50",
    commission: "0.00",
    swap: "0.00",
    net: "1.50",
  },
  {
    label: "spec §4.3 example",
    gross: "100.00",
    commission: "-3.50",
    swap: "-1.25",
    net: "95.25",
  },
  {
    // Above 2^53, so a double cannot even hold the integer part exactly.
    label: "beyond 2^53",
    gross: "99999999999999.99",
    commission: "-0.01",
    swap: "0.00",
    net: "99999999999999.98",
  },
  {
    label: "accumulated small losses",
    gross: "-0.01",
    commission: "-0.01",
    swap: "-0.01",
    net: "-0.03",
  },
];

async function cleanup() {
  // Cascades to the account and its trades.
  await db.delete(user).where(eq(user.id, PROBE_USER_ID));
}

async function main() {
  await cleanup();

  await db.insert(user).values({
    id: PROBE_USER_ID,
    name: "decimal probe",
    email: "decimal-roundtrip-probe@example.invalid",
    emailVerified: false,
  });

  await db.insert(tradingAccounts).values({
    id: PROBE_ACCOUNT_ID,
    userId: PROBE_USER_ID,
    name: "Decimal probe",
    currency: "USD",
    startingBalance: BIG,
    serverTimezone: "UTC",
  });

  let failures = 0;
  const report = (ok: boolean, line: string) => {
    if (!ok) failures++;
    console.log(`${ok ? "  pass" : "  FAIL"}  ${line}`);
  };

  const [account] = await db
    .select()
    .from(tradingAccounts)
    .where(eq(tradingAccounts.id, PROBE_ACCOUNT_ID));

  console.log("Round trip through Drizzle + postgres-js:\n");
  report(
    account.startingBalance === BIG && typeof account.startingBalance === "string",
    `starting_balance  ${account.startingBalance}  (typeof ${typeof account.startingBalance})`,
  );

  for (const testCase of CASES) {
    const [inserted] = await db
      .insert(trades)
      .values({
        userId: PROBE_USER_ID,
        tradingAccountId: PROBE_ACCOUNT_ID,
        symbol: "EURUSD",
        direction: "buy",
        volume: "0.10",
        openedAt: new Date(),
        closedAt: new Date(),
        openPrice: "1.00000",
        closePrice: "1.00000",
        grossProfit: testCase.gross,
        commission: testCase.commission,
        swap: testCase.swap,
        // Note there is no `netProfit` here, and there cannot be: it is a
        // generated column, so Drizzle drops it from the insert type.
      })
      .returning();

    const [read] = await db.select().from(trades).where(eq(trades.id, inserted.id));

    report(
      read.grossProfit === testCase.gross &&
        read.netProfit === testCase.net &&
        typeof read.netProfit === "string",
      `${testCase.label.padEnd(26)} gross=${read.grossProfit}  net=${read.netProfit}  (want ${testCase.net})`,
    );
  }

  console.log("\nWhat the same sums would be in floating point:\n");
  for (const testCase of CASES) {
    // The one place in this repo where money is deliberately put through a
    // float — to show what is being avoided.
    const asFloat = Number(testCase.gross) + Number(testCase.commission) + Number(testCase.swap);
    const drifted = String(asFloat) !== testCase.net;
    console.log(
      `  ${drifted ? "DRIFT" : "ok   "}  ${testCase.label.padEnd(26)} float=${asFloat}  exact=${testCase.net}`,
    );
  }

  await cleanup();

  console.log(
    `\n${failures === 0 ? "All decimals survived unchanged." : `${failures} failure(s).`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("Probe failed:", error);
  await cleanup().catch(() => {});
  process.exit(1);
});
