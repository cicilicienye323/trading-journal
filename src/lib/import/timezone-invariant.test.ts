/**
 * The two-fixture invariant — spec §6.5's "most valuable test in the import
 * feature", and the reason `npm run fixtures` writes two files.
 *
 * ── The property ──
 * `mt5-history.csv` and `mt5-history-eet.csv` describe the **same 180 trades**,
 * written by two brokers whose servers run in different zones. Import the first
 * into an account on `UTC` and the second into an account on `Europe/Athens`,
 * and the instants stored in `opened_at`/`closed_at` must be identical, row for
 * row. If a single second differs, the conversion is wrong.
 *
 * ── Why it catches what unit tests cannot ──
 * The EET file crosses a DST transition *inside itself*, at ticket 50000086 on
 * 29 March 2026, with nothing in the file marking it. A parser that reads one
 * offset for the whole export — the natural implementation, and the one that
 * looks correct in review — converts every row after that point one hour wrong
 * and raises no error at all. Nothing about the imported data looks unusual:
 * the trades are simply in the wrong hour, forever.
 *
 * The spec's author ran this and reported 0 differences out of 360 timestamps,
 * so a red result here means our code, not the fixture.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseCsv } from "./mt5-csv";
import { toImportWriteValues } from "./write-values";

function importInto(filename: string, serverTimezone: string) {
  const parsed = parseCsv(readFileSync(`fixtures/${filename}`, "utf8"));
  if (!parsed.ok) throw new Error(`${filename} did not parse: ${parsed.error}`);
  expect(parsed.rejected).toEqual([]);

  return parsed.rows.map((row) =>
    toImportWriteValues(row, { id: "00000000-0000-0000-0000-000000000000", serverTimezone }),
  );
}

const fromUtcBroker = importInto("mt5-history.csv", "UTC");
const fromEetBroker = importInto("mt5-history-eet.csv", "Europe/Athens");

describe("the same trades exported by brokers in two zones", () => {
  it("are the same trades, in the same order", () => {
    // Stated separately so a fixture regeneration that reorders rows fails
    // here, with that message, instead of showing up as 360 timestamp
    // mismatches that look like a timezone bug.
    expect(fromEetBroker).toHaveLength(fromUtcBroker.length);
    expect(fromEetBroker.map((row) => row.externalTicket)).toEqual(
      fromUtcBroker.map((row) => row.externalTicket),
    );
  });

  it("land on identical instants — all 360 timestamps", () => {
    const differences = fromUtcBroker.flatMap((utc, index) => {
      const eet = fromEetBroker[index];
      return [
        ["opened_at", utc.externalTicket, utc.openedAt, eet.openedAt] as const,
        ["closed_at", utc.externalTicket, utc.closedAt, eet.closedAt] as const,
      ].filter(([, , a, b]) => a!.getTime() !== b!.getTime());
    });

    // Reported as a list rather than as a count, so a failure names the first
    // ticket that drifted — which is what tells you whether the bug is one
    // fixed offset for the file (everything after 50000086) or something else.
    expect(differences.map(([field, ticket, a, b]) => `${ticket} ${field}: ${a} vs ${b}`)).toEqual(
      [],
    );
  });

  it("really do disagree about the wall clock, either side of the DST switch", () => {
    // Without this, the test above would still pass if `toUtc` ignored the
    // zone entirely *and* the two fixtures happened to hold the same text.
    // These assertions prove the two files genuinely differ, and differ by a
    // different amount before and after 29 March 2026 — so the invariant above
    // is evidence about the conversion rather than about identical inputs.
    const utcText = readFileSync("fixtures/mt5-history.csv", "utf8").trim().split("\n").slice(1);
    const eetText = readFileSync("fixtures/mt5-history-eet.csv", "utf8")
      .trim()
      .split("\n")
      .slice(1);

    const offsetHours = (line: string, other: string, column: number) => {
      const hour = (row: string) => Number(row.split(",")[column].slice(11, 13));
      // Modulo 24 so a row whose local time crossed midnight still reports the
      // offset rather than -22.
      return (hour(other) - hour(line) + 24) % 24;
    };

    const winter = utcText.findIndex((line) => line.startsWith("2026.01"));
    const summer = utcText.findIndex((line) => line.startsWith("2026.07"));
    expect(winter).toBeGreaterThan(-1);
    expect(summer).toBeGreaterThan(-1);

    expect(offsetHours(utcText[winter], eetText[winter], 0)).toBe(2);
    expect(offsetHours(utcText[summer], eetText[summer], 0)).toBe(3);
  });

  it("moves 72 open dates and 41 close dates onto a different calendar day", () => {
    // §6.5's concrete answer to "why does this matter". These are the trades
    // that a naive importer files under the wrong day — the "Friday night trade
    // recorded on Saturday" case — and the reason §5.3 groups daily metrics by
    // the account's server date rather than by UTC.
    const dates = (text: string, column: number) =>
      text
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => line.split(",")[column].slice(0, 10));

    const utcText = readFileSync("fixtures/mt5-history.csv", "utf8");
    const eetText = readFileSync("fixtures/mt5-history-eet.csv", "utf8");

    const shifted = (column: number) =>
      dates(utcText, column).filter((day, index) => day !== dates(eetText, column)[index]).length;

    expect(shifted(0)).toBe(72);
    expect(shifted(8)).toBe(41);
  });
});
