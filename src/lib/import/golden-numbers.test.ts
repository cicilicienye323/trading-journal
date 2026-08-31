/**
 * The twelve published figures of spec §6.6, checked against the real fixture.
 *
 * ── Why this is the highest-value test in the project ──
 * It parses `fixtures/mt5-history.csv` end to end, derives risk for all 180
 * rows, and reconciles twelve numbers the spec computed independently and wrote
 * down. Almost every arithmetic mistake available in this codebase moves at
 * least one of them: swap open and close price and the P&L inverts; subtract
 * commission instead of adding it and net P&L drops by the commission twice;
 * invert money-per-price-point and average R collapses toward zero; use floats
 * and the totals drift by a cent. One test, most of the failure modes.
 *
 * ── Why the arithmetic below is written out by hand ──
 * It is deliberately an **independent oracle**, not a call into the statistics
 * module. Slice 3 will build `lib/stats/calculators.ts` for these same figures;
 * if this test called it, the test would only prove the calculators agree with
 * themselves. Summing scaled integers here with plain `BigInt` — not even the
 * `Decimal` helpers in `lib/money.ts` — means the parser, the risk derivation
 * and the decimal module are all being checked against something that shares no
 * code with them. When Slice 3 lands, its calculators get checked against the
 * same published table, and the two agree because both match the spec rather
 * than because both run the same lines.
 *
 * ── No database ──
 * Every number here comes out of pure functions, which is why the CI job that
 * gates deploys needs no Postgres (spec §8.2).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseCsv } from "./mt5-csv";
import { toImportWriteValues } from "./write-values";

/** §6.6 imports into an account with this balance and this zone. */
const STARTING_BALANCE = "10000.00";
const ACCOUNT = { id: "00000000-0000-0000-0000-000000000000", serverTimezone: "UTC" };

const parsed = parseCsv(readFileSync("fixtures/mt5-history.csv", "utf8"));
if (!parsed.ok) throw new Error(`fixture did not parse: ${parsed.error}`);

const rows = parsed.rows.map((row) => toImportWriteValues(row, ACCOUNT));

/* ── The oracle: fixed-point arithmetic on scaled integers ─────────────────
 * Money is exact to the cent, so a cent is the unit. `BigInt` cannot lose a
 * digit, and none of this shares an implementation with the code under test.
 * ────────────────────────────────────────────────────────────────────────── */

/** `"−33.92"` at scale 2 → `-3392n`. Refuses a value it would have to round. */
function scaled(value: string, scale: number): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  if (fraction.length > scale) throw new Error(`${value} does not fit scale ${scale}`);
  const units = BigInt(whole + fraction.padEnd(scale, "0"));
  return negative ? -units : units;
}

function render(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const cut = digits.length - scale;
  return `${negative ? "-" : ""}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

/**
 * Division rounding half away from zero, rendered with `scale` decimals.
 *
 * Both arguments must be scaled the same way, so their scales cancel and the
 * quotient is a plain ratio — `count(n)` below is how a bare count is lifted to
 * meet a money or R numerator. Mixing scales silently multiplies the answer by
 * a power of ten, which is how the first draft of this file reported an average
 * R of -961.817.
 */
function ratio(numerator: bigint, denominator: bigint, scale: number): string {
  const shifted = numerator * 10n ** BigInt(scale);
  const negative = shifted < 0n !== denominator < 0n;
  const n = shifted < 0n ? -shifted : shifted;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (n % d) * 2n >= d ? n / d + 1n : n / d;
  return render(negative ? -quotient : quotient, scale);
}

/** A count, lifted to `scale` so it can divide a value held at that scale. */
function count(value: number, scale: number): bigint {
  return BigInt(value) * 10n ** BigInt(scale);
}

/** §5.1, restated here rather than imported, for the same reason as the rest. */
const cents = (row: (typeof rows)[number]) =>
  scaled(row.grossProfit, 2) + scaled(row.commission!, 2) + scaled(row.swap!, 2);

const netByTrade = rows.map(cents);
const wins = netByTrade.filter((net) => net > 0n);
const losses = netByTrade.filter((net) => net < 0n);
const breakeven = netByTrade.filter((net) => net === 0n);

const grossProfit = wins.reduce((total, net) => total + net, 0n);
const grossLoss = -losses.reduce((total, net) => total + net, 0n);
const netPnl = netByTrade.reduce((total, net) => total + net, 0n);

const rMultiples = rows
  .map((row) => row.rMultiple)
  .filter((value): value is string => value !== null)
  .map((value) => scaled(value, 3));

describe("spec §6.6 golden numbers", () => {
  it("parses every row of the fixture, rejecting none", () => {
    // If this fails, every figure below is being computed over a subset and
    // the mismatches would be misleading.
    expect(parsed.ok && parsed.rejected).toEqual([]);
    expect(rows).toHaveLength(180);
  });

  it("counts 180 trades: 98 wins, 82 losses, 0 breakeven", () => {
    expect(rows).toHaveLength(180);
    expect([wins.length, losses.length, breakeven.length]).toEqual([98, 82, 0]);
  });

  it("has a win rate of 54.44%", () => {
    // Breakeven trades belong in the denominator (§5.3). There are none here,
    // so this fixture cannot catch that mistake — `edge-cases.csv` has the
    // breakeven row, and Slice 3's calculator tests are where it is checked.
    expect(ratio(BigInt(wins.length) * 100n, BigInt(rows.length), 2)).toBe("54.44");
  });

  it("has a gross profit of 14,664.41 and a gross loss of 6,568.95", () => {
    expect(render(grossProfit, 2)).toBe("14664.41");
    expect(render(grossLoss, 2)).toBe("6568.95");
  });

  it("has a profit factor of 2.2324", () => {
    expect(ratio(grossProfit, grossLoss, 4)).toBe("2.2324");
  });

  it("has an expectancy of 44.9748 per trade", () => {
    expect(ratio(netPnl, count(rows.length, 2), 4)).toBe("44.9748");
  });

  it("has a net P&L of 8,095.46", () => {
    // The single number a reader would check first against their broker.
    expect(render(netPnl, 2)).toBe("8095.46");
  });

  it("has an average R of +0.4552 across all 180 trades", () => {
    // Coverage is 180/180 because every row in this fixture has a stop loss —
    // which is also why §6.4 asks for a separate hand-made fixture to exercise
    // the no-stop path at all.
    expect(rMultiples).toHaveLength(180);
    const sum = rMultiples.reduce((total, r) => total + r, 0n);
    expect(ratio(sum, count(rMultiples.length, 3), 4)).toBe("0.4552");
  });

  it("puts every losing trade's R between -1.04 and -0.87, averaging -0.962", () => {
    // §6.6's fastest bug detector. Losers hit their stop, so they land just
    // past -1R once commission is counted. R in the hundreds means pip value
    // was computed as 10 ** -digits; R near zero means moneyPerPricePoint is
    // inverted. Either way this assertion fails long before a dashboard exists
    // to look wrong.
    const loserR = rows
      .filter((_, index) => netByTrade[index] < 0n)
      .map((row) => scaled(row.rMultiple!, 3));

    expect(loserR).toHaveLength(82);
    expect(
      render(
        loserR.reduce((a, b) => (a < b ? a : b)),
        3,
      ),
    ).toBe("-1.036");
    expect(
      render(
        loserR.reduce((a, b) => (a > b ? a : b)),
        3,
      ),
    ).toBe("-0.872");
    expect(
      ratio(
        loserR.reduce((total, r) => total + r, 0n),
        count(82, 3),
        3,
      ),
    ).toBe("-0.962");
  });

  it("ends at an equity of 18,095.46 after a max drawdown of 578.61 (3.98%)", () => {
    // The equity curve is the one figure that depends on *order*, so it is
    // computed the way §5.3 defines it: by closed_at ascending, tie-broken so
    // the result does not depend on the order rows happened to arrive in.
    const ordered = rows
      .map((row, index) => ({ closedAt: row.closedAt!.getTime(), net: netByTrade[index] }))
      .sort((a, b) => a.closedAt - b.closedAt || Number(a.net - b.net));

    let equity = scaled(STARTING_BALANCE, 2);
    let peak = equity;
    let maxDrawdown = 0n;
    let peakAtMaxDrawdown = equity;

    for (const trade of ordered) {
      equity += trade.net;
      if (equity > peak) peak = equity;
      if (peak - equity > maxDrawdown) {
        maxDrawdown = peak - equity;
        peakAtMaxDrawdown = peak;
      }
    }

    expect(render(equity, 2)).toBe("18095.46");
    expect(render(maxDrawdown, 2)).toBe("578.61");
    expect(ratio(maxDrawdown * 100n, peakAtMaxDrawdown, 2)).toBe("3.98");
  });

  it("covers exactly the six symbols the spec lists", () => {
    expect([...new Set(rows.map((row) => row.symbol))].sort()).toEqual([
      "AUDUSD",
      "EURUSD",
      "GBPJPY",
      "GBPUSD",
      "USDJPY",
      "XAUUSD",
    ]);
  });
});
