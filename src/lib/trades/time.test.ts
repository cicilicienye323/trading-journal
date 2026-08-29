/**
 * Timezone conversion, tested — including the two DST edges.
 *
 * These tests are the reason the conversion lives in a pure module instead of
 * inline in a server action: the interesting cases are all about *which* zone
 * rule applied on a given date, and none of them need a database or a request.
 *
 * They also pin the current behaviour of the nonexistent and ambiguous local
 * times, so Slice 2 (which has to make a real decision about them for bulk CSV
 * import, spec §6.5) starts from something known rather than a guess.
 */
import { describe, expect, it } from "vitest";

import {
  formatInAccountZone,
  isValidTimeZone,
  utcToZonedInput,
  zonedDayBoundary,
  zonedInputToUtc,
} from "./time";

const ATHENS = "Europe/Athens";

describe("zonedInputToUtc", () => {
  it("applies the winter offset (EET, UTC+2)", () => {
    // 14:30 on a broker clock in January is 12:30 UTC.
    expect(zonedInputToUtc("2026-01-15T14:30", ATHENS).toISOString()).toBe(
      "2026-01-15T12:30:00.000Z",
    );
  });

  it("applies the summer offset (EEST, UTC+3) for the same wall clock", () => {
    // The same typed time in July is 11:30 UTC — one hour earlier than winter.
    // This is the whole reason the zone is stored as an IANA name rather than
    // as a fixed offset.
    expect(zonedInputToUtc("2026-07-15T14:30", ATHENS).toISOString()).toBe(
      "2026-07-15T11:30:00.000Z",
    );
  });

  it("does not depend on the machine's own timezone", () => {
    // The failure this guards against: `new Date("2026-01-15T14:30")` would
    // give a different instant on a laptop in Jakarta than in a US-East
    // serverless function. An explicit zone makes the result the same
    // everywhere, which is what makes CI trustworthy here.
    const fromAthens = zonedInputToUtc("2026-01-15T14:30", ATHENS).toISOString();
    const fromUtc = zonedInputToUtc("2026-01-15T14:30", "UTC").toISOString();
    expect(fromAthens).toBe("2026-01-15T12:30:00.000Z");
    expect(fromUtc).toBe("2026-01-15T14:30:00.000Z");
  });

  it("resolves a nonexistent local time backwards rather than throwing", () => {
    // Athens jumps 03:00 -> 04:00 on 2026-03-29, so local 03:00-03:59 never
    // happens. Measured behaviour: the post-transition offset (+3) is applied,
    // giving 00:30 UTC — which is 02:30 local, i.e. just *before* the gap.
    //
    // Asserted rather than assumed. The first version of this test guessed the
    // opposite (that it would land after the gap, at 04:30) and was wrong; this
    // is the behaviour Slice 2 has to build its §6.5 import rule on top of.
    const resolved = zonedInputToUtc("2026-03-29T03:30", ATHENS);
    expect(resolved.toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(formatInAccountZone(resolved, ATHENS)).toBe("2026-03-29 02:30");
  });

  it("picks the second occurrence of an ambiguous local time", () => {
    // Athens falls back 04:00 -> 03:00 on 2026-10-25, so local 03:30 happens
    // twice: once as EEST (+3) at 00:30 UTC, once as EET (+2) at 01:30 UTC.
    // Measured behaviour: the later, standard-time reading wins.
    const resolved = zonedInputToUtc("2026-10-25T03:30", ATHENS);
    expect(resolved.toISOString()).toBe("2026-10-25T01:30:00.000Z");
    expect(formatInAccountZone(resolved, ATHENS)).toBe("2026-10-25 03:30");
  });
});

/**
 * Guards the display path against the `date-fns-tz` bug documented in
 * `zonedParts`: in 3.2.0, `formatInTimeZone` renders the hour before a
 * spring-forward transition one hour ahead of the true local time.
 *
 * `Intl` is the authority here — it is the platform's binding to the same IANA
 * database Postgres uses. Sweeping every 15 minutes across both 2026 transition
 * days is cheap and catches a regression if the implementation ever switches
 * back to a library formatter.
 */
describe("formatInAccountZone agrees with Intl across DST transitions", () => {
  const reference = new Intl.DateTimeFormat("en-GB", {
    timeZone: ATHENS,
    hourCycle: "h23",
    dateStyle: "short",
    timeStyle: "short",
  });

  for (const day of ["2026-03-28", "2026-03-29", "2026-03-30", "2026-10-24", "2026-10-25"]) {
    it(`matches on ${day}`, () => {
      for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
        const instant = new Date(`${day}T00:00:00Z`);
        instant.setUTCMinutes(minutes);

        const expected = reference.format(instant).split(", ")[1];
        expect(formatInAccountZone(instant, ATHENS).slice(11), instant.toISOString()).toBe(
          expected,
        );
      }
    });
  }
});

/**
 * The inbound direction: for every *valid* local time, converting to UTC and
 * asking `Intl` what that instant is locally must give back what we started
 * with. Skips the nonexistent hour, which has no round trip by definition.
 */
describe("zonedInputToUtc round-trips against Intl", () => {
  for (const day of ["2026-03-28", "2026-03-29", "2026-10-25", "2026-07-15"]) {
    it(`round-trips valid local times on ${day}`, () => {
      for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
        const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
        const mm = String(minutes % 60).padStart(2, "0");
        const naive = `${day}T${hh}:${mm}`;

        const instant = zonedInputToUtc(naive, ATHENS);
        const rendered = formatInAccountZone(instant, ATHENS).replace(" ", "T");

        // The skipped hour cannot round-trip; everything else must.
        if (day === "2026-03-29" && hh === "03") {
          expect(rendered).not.toBe(naive);
          continue;
        }
        expect(rendered).toBe(naive);
      }
    });
  }
});

describe("utcToZonedInput", () => {
  it("round-trips a typed time back to the same characters", () => {
    // What makes the edit form show the time that was originally entered,
    // rather than the same instant expressed in the server's zone.
    for (const naive of ["2026-01-15T14:30", "2026-07-15T14:30", "2026-12-31T23:59"]) {
      expect(utcToZonedInput(zonedInputToUtc(naive, ATHENS), ATHENS)).toBe(naive);
    }
  });
});

describe("zonedDayBoundary", () => {
  it("starts the day at the broker's midnight, not UTC midnight", () => {
    // In winter the broker's day starts at 22:00 UTC the previous evening.
    expect(zonedDayBoundary("2026-04-06", ATHENS).toISOString()).toBe("2026-04-05T21:00:00.000Z");
  });

  it("ends at the start of the next day, giving a half-open range", () => {
    const start = zonedDayBoundary("2026-04-06", ATHENS);
    const end = zonedDayBoundary("2026-04-06", ATHENS, true);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
    expect(end.toISOString()).toBe("2026-04-06T21:00:00.000Z");
  });

  it("rolls over month and year boundaries", () => {
    expect(zonedDayBoundary("2026-01-31", "UTC", true).toISOString()).toBe(
      "2026-02-01T00:00:00.000Z",
    );
    expect(zonedDayBoundary("2026-12-31", "UTC", true).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
    // Leap year, which is exactly what hand-rolled month arithmetic gets wrong.
    expect(zonedDayBoundary("2028-02-28", "UTC", true).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("spans 23 hours across the spring-forward day", () => {
    // The bug avoided by doing calendar arithmetic instead of adding 86 400 000
    // milliseconds: this local day is genuinely an hour short.
    const start = zonedDayBoundary("2026-03-29", ATHENS);
    const end = zonedDayBoundary("2026-03-29", ATHENS, true);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });

  it("spans 25 hours across the fall-back day", () => {
    const start = zonedDayBoundary("2026-10-25", ATHENS);
    const end = zonedDayBoundary("2026-10-25", ATHENS, true);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names", () => {
    expect(isValidTimeZone("Europe/Athens")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Asia/Jakarta")).toBe(true);
  });

  it("rejects offsets and nonsense", () => {
    // Rejecting "+02:00" is deliberate: an offset cannot express a DST rule,
    // which is the entire reason this column stores a zone name.
    expect(isValidTimeZone("+02:00")).toBe(false);
    expect(isValidTimeZone("EET-2")).toBe(false);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});
