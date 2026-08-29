/**
 * Guards the hand-written Better Auth tables against library drift.
 *
 * The schema in `auth-schema.ts` is written by hand — there is no
 * `@better-auth/cli` in this project to generate it. So the failure mode is an
 * upgrade adding or renaming a field while our tables stay put. Better Auth
 * resolves a field to a column by plain property lookup, so a missing field
 * doesn't fail at build or at boot: it fails at runtime, on the request that
 * first touches it, with "field does not exist in the schema".
 *
 * `getAuthTables()` is the library's own description of what it requires, so
 * asking it directly is the only check that stays true across versions. If this
 * test goes red after `npm update`, the library changed its mind — read the
 * diff and update `auth-schema.ts` to match. Don't delete the assertion.
 *
 * No database is involved; this reads table metadata only, so it stays inside
 * the "unit tests are pure" rule the CI pipeline depends on.
 */
import { getTableColumns, getTableName } from "drizzle-orm";
import { getAuthTables } from "better-auth/db";
import { describe, expect, it } from "vitest";

import { account, session, user, verification } from "./auth-schema";

// Mirrors the options `lib/auth.ts` passes. The required field set can depend
// on configuration, so asking with the wrong options would check the wrong
// contract.
const required = getAuthTables({ emailAndPassword: { enabled: true } });

const ours = { user, session, account, verification };

describe("Better Auth tables match what the installed library requires", () => {
  it("covers all four models", () => {
    expect(Object.keys(required).sort()).toEqual(["account", "session", "user", "verification"]);
  });

  for (const [model, table] of Object.entries(ours)) {
    describe(model, () => {
      it("declares every field the library will look up", () => {
        const wanted = Object.keys(required[model].fields);
        // The adapter looks up `table[fieldName]`, so what matters is the
        // Drizzle *property* key, not the database column name.
        const declared = Object.keys(getTableColumns(table));

        const missing = wanted.filter((f) => !declared.includes(f));
        expect(missing, `${model} is missing field(s) the adapter will look up`).toEqual([]);
      });

      it("has an id column, which the adapter uses directly", () => {
        expect(Object.keys(getTableColumns(table))).toContain("id");
      });

      it("uses the table name the library expects", () => {
        expect(getTableName(table)).toBe(required[model].modelName);
      });

      it("stores every timestamp with a timezone", () => {
        // The repo-wide rule from schema.ts. A naive timestamp silently loses
        // the offset, and the bug only surfaces across a DST boundary — which
        // is exactly the class of bug this project exists to show it handles.
        const naive = Object.values(getTableColumns(table))
          .filter((c) => c.columnType === "PgTimestamp" || c.columnType === "PgTimestampString")
          .filter((c) => c.getSQLType() !== "timestamp with time zone")
          .map((c) => c.name);

        expect(naive, `${model} has timestamp column(s) without a timezone`).toEqual([]);
      });
    });
  }

  it("marks the fields the library says are required as NOT NULL", () => {
    const problems: string[] = [];

    for (const [model, table] of Object.entries(ours)) {
      const columns = getTableColumns(table);
      for (const [field, spec] of Object.entries(required[model].fields)) {
        const column = columns[field as keyof typeof columns];
        if (!column) continue; // covered by the per-model test above
        // A required field that is nullable in Postgres lets a half-written row
        // exist — e.g. a session with no expiry, which never expires.
        if (spec.required && !column.notNull) problems.push(`${model}.${field}`);
      }
    }

    expect(problems, "required field(s) are nullable in the database").toEqual([]);
  });

  it("names the broker-account table apart from Better Auth's `account`", () => {
    // The trap called out in schema.ts. `account` belongs to Better Auth
    // (OAuth links + password hashes); the trading table must be
    // `trading_accounts`. This asserts the half that exists today, so that
    // whoever adds the other half finds the name already taken.
    expect(getTableName(account)).toBe("account");
    expect(getTableName(account)).not.toBe("trading_accounts");
  });
});
