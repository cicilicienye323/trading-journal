/**
 * The money rules, tested.
 *
 * These are worth testing not because the functions are clever, but because the
 * property they protect is invisible: nothing about a `numeric` column shows up
 * as broken until a total is a cent off. A test that a decimal survives
 * unchanged is a test that no float crept into the path.
 */
import { describe, expect, it } from "vitest";

import { compareDecimals, decimalString, formatDecimal, isPositiveDecimal } from "./money";

const money = decimalString({ precision: 18, scale: 2, label: "Amount" });
const price = decimalString({ precision: 18, scale: 5, positiveOnly: true, label: "Price" });

describe("decimalString", () => {
  it("returns the exact string it was given", () => {
    // The point of the whole module: what the user typed is what Postgres gets.
    expect(money.parse("100.00")).toBe("100.00");
    expect(money.parse("-3.50")).toBe("-3.50");
    // Trailing zeros are meaningful to a numeric column's scale and must not be
    // normalised away — a float round trip would turn this into "1.5".
    expect(money.parse("1.50")).toBe("1.50");
  });

  it("does not lose precision the way a float would", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. Here the value never becomes
    // a number, so a long decimal survives character for character.
    const exact = "12345678901234.99";
    expect(money.parse(exact)).toBe(exact);
    // Proof the naive path would have failed: this is what coercion would do.
    expect(String(Number("0.1") + Number("0.2"))).not.toBe("0.3");
  });

  it("trims surrounding whitespace but nothing else", () => {
    expect(money.parse("  42.10  ")).toBe("42.10");
  });

  it("rejects more fractional digits than the column holds", () => {
    // Postgres would silently *round* this; catching it here means the user is
    // told rather than quietly given a different number than they entered.
    expect(money.safeParse("1.234").success).toBe(false);
    expect(price.safeParse("1.084531").success).toBe(false);
    expect(price.safeParse("1.08453").success).toBe(true);
  });

  it("rejects an integer part too long for the column", () => {
    // numeric(18,2) allows 16 integer digits; 17 overflows. Postgres errors on
    // this rather than rounding, so it would otherwise be a 500.
    expect(money.safeParse("1".repeat(16) + ".00").success).toBe(true);
    expect(money.safeParse("1".repeat(17) + ".00").success).toBe(false);
  });

  it("rejects things that are not decimals", () => {
    for (const bad of ["", "abc", "1,000.00", "1e3", "0x10", "--1", "1.2.3", "+5", " "]) {
      expect(money.safeParse(bad).success, `${JSON.stringify(bad)} should be rejected`).toBe(false);
    }
  });

  it("enforces positivity where the column has a CHECK > 0", () => {
    expect(price.safeParse("0").success).toBe(false);
    expect(price.safeParse("0.00000").success).toBe(false);
    expect(price.safeParse("-1.5").success).toBe(false);
    expect(price.safeParse("0.00001").success).toBe(true);
  });

  it("allows negatives where the column is signed", () => {
    // A losing trade is a negative gross profit; commission is negative by
    // MetaTrader convention.
    expect(money.safeParse("-45.20").success).toBe(true);
  });
});

describe("isPositiveDecimal", () => {
  it("treats every spelling of zero as non-positive", () => {
    expect(isPositiveDecimal("0")).toBe(false);
    expect(isPositiveDecimal("0.00")).toBe(false);
    expect(isPositiveDecimal("-0.00")).toBe(false);
  });

  it("recognises small positive values", () => {
    expect(isPositiveDecimal("0.01")).toBe(true);
    expect(isPositiveDecimal("0.00001")).toBe(true);
  });
});

describe("compareDecimals", () => {
  it("compares by magnitude, not by string length", () => {
    // The bug a naive string compare would have: "99" > "100" lexically.
    expect(compareDecimals("99", "100")).toBe(-1);
    expect(compareDecimals("100", "99")).toBe(1);
  });

  it("pads fractions before comparing", () => {
    // ".5" is ".50", so it is greater than ".49" despite being shorter.
    expect(compareDecimals("0.5", "0.49")).toBe(1);
    expect(compareDecimals("0.5", "0.50")).toBe(0);
    expect(compareDecimals("1", "1.00")).toBe(0);
  });

  it("orders negatives the right way round", () => {
    expect(compareDecimals("-5", "-2")).toBe(-1);
    expect(compareDecimals("-1", "1")).toBe(-1);
    expect(compareDecimals("-0.00", "0")).toBe(0);
  });

  it("gets the 100% boundary exactly right", () => {
    // This is the case the prop-firm limit check depends on. A float compare
    // can disagree with Postgres here; digits cannot.
    expect(compareDecimals("100.00", "100")).toBe(0);
    expect(compareDecimals("100.01", "100")).toBe(1);
    expect(compareDecimals("99.99", "100")).toBe(-1);
  });
});

describe("formatDecimal", () => {
  it("groups thousands without parsing the value", () => {
    expect(formatDecimal("1234567.89")).toBe("1,234,567.89");
    expect(formatDecimal("-1234.50")).toBe("-1,234.50");
    expect(formatDecimal("999")).toBe("999");
    expect(formatDecimal("1000")).toBe("1,000");
  });

  it("preserves the stored scale exactly", () => {
    // Intl.NumberFormat would need a number and would drop this trailing zero.
    expect(formatDecimal("0.10")).toBe("0.10");
    expect(formatDecimal("12345678901234.99")).toBe("12,345,678,901,234.99");
  });
});
