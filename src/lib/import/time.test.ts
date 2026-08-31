/**
 * The four timezone cases spec §6.5 names, plus the calendar guard and the two
 * DST resolutions this slice had to decide.
 *
 * These test `toUtc` directly, so they need no fixture and no database — which
 * is the point of §6.5 listing them as a table of inputs and expected instants.
 * The fixture-level version of the same property lives in
 * `timezone-invariant.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { isMt5DateTime, toUtc } from "./time";

const ATHENS = "Europe/Athens";

describe("toUtc", () => {
  // The §6.5 table, verbatim.
  it("applies the winter offset for an EET broker (GMT+2)", () => {
    expect(toUtc("2026.01.15 10:00:00", ATHENS).toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });

  it("applies the summer offset for the same broker (GMT+3)", () => {
    // Same wall-clock time, same zone, one hour different in UTC. A parser
    // that reads a single offset for the whole export fails exactly here.
    expect(toUtc("2026.07.15 10:00:00", ATHENS).toISOString()).toBe("2026-07-15T07:00:00.000Z");
  });

  it("does not move a late-night trade onto the wrong day", () => {
    expect(toUtc("2026.03.06 23:47:00", ATHENS).toISOString()).toBe("2026-03-06T21:47:00.000Z");
  });

  it("is the identity for a GMT+0 broker", () => {
    expect(toUtc("2026.01.15 10:00:00", "UTC").toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });

  it("keeps the seconds MT5 writes", () => {
    // A conversion that goes via a `datetime-local`-shaped string without
    // seconds would truncate to :00 and silently reorder trades closed in the
    // same minute.
    expect(toUtc("2025.12.04 21:49:23", "UTC").toISOString()).toBe("2025-12-04T21:49:23.000Z");
  });

  it("resolves a nonexistent local time rather than rejecting the row", () => {
    // Athens jumps 03:00 → 04:00 on 2026-03-29, so 03:30 never happened.
    // Measured behaviour of the shared conversion (pinned in more detail in
    // `lib/trades/time.test.ts`): the post-transition offset is applied,
    // landing on 02:30 local — just before the gap. Asserted here too because
    // this is the file that decided *not* to reject such a row, and a change
    // in the library must fail the importer's own test, not only its
    // dependency's.
    expect(toUtc("2026.03.29 03:30:00", ATHENS).toISOString()).toBe("2026-03-29T00:30:00.000Z");
  });

  it("resolves an ambiguous local time to the second reading", () => {
    // 2026-10-25: 03:30 happens twice, once at +03 and once at +02. The later,
    // standard-time reading wins.
    expect(toUtc("2026.10.25 03:30:00", ATHENS).toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });

  it("throws on a string that is not an MT5 datetime", () => {
    // Reaching here means `validateRow` and this module disagree about the
    // format, which is a bug worth seeing rather than a row worth skipping.
    expect(() => toUtc("2026-03-29T03:30", ATHENS)).toThrow();
  });
});

describe("isMt5DateTime", () => {
  it("accepts the exact shape MT5 writes", () => {
    expect(isMt5DateTime("2025.12.04 21:49:23")).toBe(true);
  });

  it("rejects other date formats rather than guessing", () => {
    for (const value of [
      "04/12/2025 21:49",
      "2025-12-04 21:49:23",
      "2025.12.04T21:49:23",
      "2025.1.4 9:5:3",
      "2025.12.04 21:49",
      "",
    ]) {
      expect(isMt5DateTime(value)).toBe(false);
    }
  });

  it("rejects a well-shaped string that is not a real moment", () => {
    // The regex alone accepts all of these. Without the calendar check they
    // would roll over silently — Feb 30 becomes Mar 2, hour 25 becomes the
    // next day — and land in the journal on a date the broker never wrote.
    for (const value of [
      "2025.02.30 12:00:00",
      "2025.13.01 12:00:00",
      "2025.12.04 25:00:00",
      "2025.12.04 12:61:00",
      "2025.00.10 12:00:00",
    ]) {
      expect(isMt5DateTime(value)).toBe(false);
    }
  });

  it("accepts a real leap day and rejects a fake one", () => {
    expect(isMt5DateTime("2024.02.29 12:00:00")).toBe(true);
    expect(isMt5DateTime("2025.02.29 12:00:00")).toBe(false);
  });
});
