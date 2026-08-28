/**
 * Integrity tests for the *committed* fixture files.
 *
 * These are deliberately separate from generate.test.ts, which exercises the
 * generator against synthetic input. The distinction matters:
 *
 * CI's fixture gate regenerates and diffs, which proves the committed files
 * match the current generator. It does NOT prove they still carry the
 * properties the spec depends on. Move the generator's date range so it no
 * longer spans a DST boundary, regenerate, commit — the gate stays green while
 * the EET fixture quietly stops being a DST fixture at all, and the tests that
 * use hardcoded dates keep passing because they never read these files.
 *
 * So: assert the properties on the artifacts themselves.
 *
 * Properties are asserted, not exact counts. The current values are recorded in
 * comments and in docs/SETUP.md; pinning them here would make every deliberate
 * generator change look like a failure.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const OPEN_TIME = 0;
const CLOSE_TIME = 8;

function readFixture(name: string): string[][] {
  const raw = readFileSync(join(process.cwd(), "fixtures", name), "utf8");
  return raw
    .trim()
    .split("\n")
    .slice(1) // drop header
    .map((line) => line.split(","));
}

const utc = readFixture("mt5-history.csv");
const eet = readFixture("mt5-history-eet.csv");

/** "2026.03.29 14:00:00" -> "2026.03.29" */
const dayOf = (cell: string) => cell.split(" ")[0]!;

/** Hour difference between the two renderings of the same instant. */
function offsetHours(utcCell: string, eetCell: string): number {
  const parse = (s: string) => {
    const [d, t] = s.split(" ");
    return new Date(`${d!.replace(/\./g, "-")}T${t}Z`).getTime();
  };
  return Math.round((parse(eetCell) - parse(utcCell)) / 3_600_000);
}

describe("committed fixtures", () => {
  it("contain the same trades in the same order", () => {
    expect(eet).toHaveLength(utc.length);
    expect(utc.length).toBeGreaterThan(100);

    for (let i = 0; i < utc.length; i += 1) {
      // Ticket through take-profit: everything except the two time columns.
      expect(eet[i]!.slice(1, 8)).toEqual(utc[i]!.slice(1, 8));
      // Close price, commission, swap, profit.
      expect(eet[i]!.slice(9)).toEqual(utc[i]!.slice(9));
    }
  });

  // The reason the EET file exists. If this fails, the fixture no longer spans
  // a DST transition and is no longer testing what it was built to test.
  // Currently flips +2 -> +3 at ticket 50000086 (2026-03-29).
  it("span a DST transition, so the offset is not constant", () => {
    const offsets = new Set(utc.map((row, i) => offsetHours(row[OPEN_TIME]!, eet[i]![OPEN_TIME]!)));

    expect(offsets).toEqual(new Set([2, 3]));
  });

  // The finding that makes this fixture pair worth having: the same 180 trades
  // group into a different number of calendar days depending on which timezone
  // the date is taken in. Nothing errors when this is done wrong — the daily
  // loss limit is simply computed over the wrong buckets.
  // Currently: 130 UTC close-days vs 119 EET, with 41/180 rows changing date.
  it("group into different calendar days under each timezone", () => {
    const utcDays = new Set(utc.map((r) => dayOf(r[CLOSE_TIME]!)));
    const eetDays = new Set(eet.map((r) => dayOf(r[CLOSE_TIME]!)));

    expect(utcDays.size).not.toBe(eetDays.size);

    const shifted = utc.filter(
      (row, i) => dayOf(row[CLOSE_TIME]!) !== dayOf(eet[i]![CLOSE_TIME]!),
    ).length;

    // Enough rows to make a wrong grouping visible rather than a rounding
    // curiosity — a handful would be easy to dismiss as noise.
    expect(shifted / utc.length).toBeGreaterThan(0.1);
  });
});
