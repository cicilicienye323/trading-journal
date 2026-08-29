/**
 * URL filter parsing, tested against hostile input.
 *
 * The URL is the one input to this app that anyone can write freely, and a
 * filter page that 500s on `?page=abc` is a bad look on a portfolio project.
 * These tests are the specification for "degrade to a sensible default rather
 * than throw" — the behaviour, not the implementation.
 */
import { describe, expect, it } from "vitest";

import { parseTradeFilters, tradeFiltersToQuery } from "./trade-filters";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("parseTradeFilters", () => {
  it("defaults to page 1 with no filters", () => {
    expect(parseTradeFilters({})).toEqual({ page: 1 });
  });

  it("reads a full set of valid filters", () => {
    expect(
      parseTradeFilters({
        account: UUID,
        symbol: "eurusd",
        direction: "sell",
        from: "2026-04-01",
        to: "2026-04-30",
        page: "3",
      }),
    ).toEqual({
      account: UUID,
      // Uppercased so ?symbol=eurusd matches the stored EURUSD.
      symbol: "EURUSD",
      direction: "sell",
      from: "2026-04-01",
      to: "2026-04-30",
      page: 3,
    });
  });

  describe("survives garbage without throwing", () => {
    // The specific cases the review rubric names, plus the ones crawlers and
    // link previewers produce in the wild.
    const hostile: Record<string, string | string[] | undefined>[] = [
      { page: "abc" },
      { page: "" },
      { page: "0" },
      { page: "-1" },
      { page: "1e3" },
      { page: "0x10" },
      { page: "999999999" },
      { page: "1.5" },
      { symbol: ["x", "y"] },
      { account: "not-a-uuid" },
      { direction: "sideways" },
      { from: "not-a-date" },
      { from: "2026-02-31" },
      { to: "" },
      { account: undefined, symbol: undefined },
      { symbol: "a".repeat(500) },
      // Regression: `/trades?symbol=%00%01` used to be a 500. Postgres rejects
      // a NUL byte at the encoding layer (22021), which parameterised queries
      // do NOT prevent — bind parameters stop injection, not unencodable bytes.
      { symbol: "\u0000" },
      { symbol: "EUR\u0000USD" },
      { account: "\u0000" },
    ];

    for (const input of hostile) {
      it(JSON.stringify(input), () => {
        const result = parseTradeFilters(input);
        // Always renderable: a page number that a query can use.
        expect(Number.isInteger(result.page)).toBe(true);
        expect(result.page).toBeGreaterThanOrEqual(1);
      });
    }
  });

  it("falls back to page 1 for an unparseable page", () => {
    expect(parseTradeFilters({ page: "abc" }).page).toBe(1);
    expect(parseTradeFilters({ page: "0" }).page).toBe(1);
    expect(parseTradeFilters({ page: "-4" }).page).toBe(1);
    // "1e3" and "0x10" are numbers to `Number()` but not page numbers — the
    // reason this field is not `z.coerce.number()`.
    expect(parseTradeFilters({ page: "1e3" }).page).toBe(1);
    expect(parseTradeFilters({ page: "0x10" }).page).toBe(1);
  });

  it("drops invalid filters instead of failing the whole parse", () => {
    // A bad symbol must not take the valid direction down with it.
    const result = parseTradeFilters({ account: "nope", direction: "buy" });
    expect(result.account).toBeUndefined();
    expect(result.direction).toBe("buy");
  });

  it("treats an empty parameter as no filter", () => {
    // What the "All accounts" option submits.
    const result = parseTradeFilters({ account: "", symbol: "", direction: "" });
    expect(result.account).toBeUndefined();
    expect(result.symbol).toBeUndefined();
    expect(result.direction).toBeUndefined();
  });

  it("collapses a repeated parameter to its first value", () => {
    expect(parseTradeFilters({ direction: ["buy", "sell"] }).direction).toBe("buy");
  });

  it("drops a symbol containing bytes Postgres cannot encode", () => {
    // The regression this guards: `/trades?symbol=%00%01` reached the database
    // as a bind parameter and Postgres rejected the *encoding* (22021), which
    // surfaced as a 500. Dropping the filter renders the unfiltered list, which
    // is the right answer for a filter value that cannot match anything.
    expect(parseTradeFilters({ symbol: "\u0000" }).symbol).toBeUndefined();
    expect(parseTradeFilters({ symbol: "EUR\u0000USD" }).symbol).toBeUndefined();
    // Legitimate broker contract suffixes must still work.
    expect(parseTradeFilters({ symbol: "eurusd.pro" }).symbol).toBe("EURUSD.PRO");
    expect(parseTradeFilters({ symbol: "XAUUSD_i" }).symbol).toBe("XAUUSD_I");
  });

  it("rejects a well-formed date that is not a real day", () => {
    expect(parseTradeFilters({ from: "2026-02-31" }).from).toBeUndefined();
    expect(parseTradeFilters({ from: "2026-02-28" }).from).toBe("2026-02-28");
  });
});

describe("tradeFiltersToQuery", () => {
  it("omits page 1 so the canonical URL stays clean", () => {
    expect(tradeFiltersToQuery({ page: 1 })).toBe("");
    expect(tradeFiltersToQuery({ page: 2 })).toBe("page=2");
  });

  it("omits absent filters rather than writing empty parameters", () => {
    expect(tradeFiltersToQuery({ page: 1, symbol: "EURUSD" })).toBe("symbol=EURUSD");
  });

  it("round-trips through parsing unchanged", () => {
    // The property that makes a shared link show the same rows: serialising
    // filters and parsing them back must be an identity.
    const filters = {
      account: UUID,
      symbol: "XAUUSD",
      direction: "sell" as const,
      from: "2026-04-01",
      to: "2026-04-30",
      page: 4,
    };

    const query = Object.fromEntries(new URLSearchParams(tradeFiltersToQuery(filters)));
    expect(parseTradeFilters(query)).toEqual(filters);
  });
});
