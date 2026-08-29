/**
 * Guards the schema conventions that are invisible until they break.
 *
 * These read Drizzle's table metadata — no database is involved, so they stay
 * inside the "unit tests are pure" rule CI depends on, in the same style as
 * `auth-schema.test.ts`.
 *
 * Each assertion here corresponds to a rule stated in `schema.ts`. Comments
 * describe intent; these make the intent enforceable, so the rule survives the
 * next person adding a column in a hurry.
 */
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgNumeric, PgTimestamp, PgTimestampString } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { importBatches, trades, tradingAccounts } from "./schema";

const ourTables = { tradingAccounts, trades, importBatches };

describe("naming", () => {
  it("keeps the broker account table clear of Better Auth's `account`", () => {
    // The collision called out in schema.ts and auth-schema.ts.
    expect(getTableName(tradingAccounts)).toBe("trading_accounts");
  });

  it("uses the table names the spec's SQL and indexes assume", () => {
    expect(getTableName(trades)).toBe("trades");
    expect(getTableName(importBatches)).toBe("import_batches");
  });
});

describe("every timestamp carries a timezone", () => {
  for (const [label, table] of Object.entries(ourTables)) {
    it(label, () => {
      // A naive timestamp silently drops the offset, and the bug only appears
      // across a DST boundary — the exact class of bug this project exists to
      // demonstrate it handles.
      const naive = Object.values(getTableColumns(table))
        .filter((column) => is(column, PgTimestamp) || is(column, PgTimestampString))
        .filter((column) => column.getSQLType() !== "timestamp with time zone")
        .map((column) => column.name);

      expect(naive, `${label} has timestamp column(s) without a timezone`).toEqual([]);
    });
  }
});

describe("money and prices never use floating point", () => {
  // Every column whose value is money, a price, or a quantity. If one of these
  // were `double precision`, sums would drift by fractions of a cent.
  const exactColumns: Record<string, string[]> = {
    tradingAccounts: ["starting_balance", "max_drawdown_limit_pct", "daily_loss_limit_pct"],
    trades: [
      "volume",
      "open_price",
      "close_price",
      "stop_loss",
      "take_profit",
      "gross_profit",
      "commission",
      "swap",
      "net_profit",
      "risk_amount",
      "r_multiple",
    ],
  };

  for (const [label, expected] of Object.entries(exactColumns)) {
    it(label, () => {
      const table = ourTables[label as keyof typeof ourTables];
      const numeric = Object.values(getTableColumns(table))
        .filter((column) => is(column, PgNumeric))
        .map((column) => column.name);

      for (const name of expected) {
        expect(numeric, `${label}.${name} must be numeric, never double precision`).toContain(name);
      }
    });
  }

  it("declares the precision and scale the spec asks for", () => {
    expect(getTableColumns(trades).netProfit.getSQLType()).toBe("numeric(18, 2)");
    expect(getTableColumns(trades).openPrice.getSQLType()).toBe("numeric(18, 5)");
    expect(getTableColumns(tradingAccounts).maxDrawdownLimitPct.getSQLType()).toBe("numeric(5, 2)");
  });
});

/**
 * Compile-time guards.
 *
 * These assert things about *types*, so they are enforced by `tsc` during
 * `npm run verify`, not by the assertion below — the `expect` is only there so
 * the guard sits inside a named test. If one of these properties breaks, the
 * typecheck fails; the test run would still be green, which is why the
 * behaviour is stated here rather than implied.
 */
describe("type-level guarantees (enforced by tsc, not by the assertion)", () => {
  it("types numeric columns as string, never number", () => {
    // The property the entire money path rests on: a `numeric` column that
    // surfaced as `number` would mean every read had already been through a
    // float. See lib/money.ts.
    type NetProfit = (typeof trades.$inferSelect)["netProfit"];
    type IsString = NetProfit extends string ? true : false;

    const numericColumnsAreStrings: IsString = true;
    expect(numericColumnsAreStrings).toBe(true);
  });

  it("keeps net_profit out of the insert type", () => {
    // Generated columns are dropped from $inferInsert, so application code is
    // structurally unable to set P&L. If that ever changed, `HasNetProfit`
    // becomes `true` and this assignment stops compiling.
    type HasNetProfit = "netProfit" extends keyof typeof trades.$inferInsert ? true : false;

    const generatedColumnsAreNotInsertable: HasNetProfit = false;
    expect(generatedColumnsAreNotInsertable).toBe(false);
  });
});

describe("net_profit is computed by the database", () => {
  it("is a generated column", () => {
    // If this ever stops being generated, P&L becomes something application
    // code can set — and then the importer, the manual form and the seed script
    // each get their own chance to compute it differently.
    expect(getTableColumns(trades).netProfit.generated).toBeDefined();
  });

  it("is absent from the insert type, so code cannot set it", () => {
    // The compile-time half of the same guarantee: `netProfit` is not a key of
    // $inferInsert. Expressed as a type-level assertion that fails the build if
    // it ever becomes insertable.
    type Insert = typeof trades.$inferInsert;
    type HasNetProfit = "netProfit" extends keyof Insert ? true : false;
    const generatedColumnsAreNotInsertable: HasNetProfit = false;
    expect(generatedColumnsAreNotInsertable).toBe(false);
  });
});

describe("authorization scoping is possible without a join", () => {
  it("denormalizes user_id onto trades and import_batches", () => {
    // The column that lets §8.3's rule be one predicate on the table being
    // queried. Without it every scoped query needs a join, and a rule that
    // needs a join is a rule that eventually gets dropped.
    expect(getTableColumns(trades).userId.name).toBe("user_id");
    expect(getTableColumns(trades).userId.notNull).toBe(true);
    expect(getTableColumns(importBatches).userId.name).toBe("user_id");
  });
});
