/**
 * Converting between what the user types and what the database stores.
 *
 * ── The bug this file exists to prevent ──
 * An `<input type="datetime-local">` submits a **naive** wall-clock string:
 * `"2026-03-30T02:30"`. No offset, no zone, nothing that says which 02:30 on
 * Earth is meant. The obvious next line is the wrong one:
 *
 *     new Date("2026-03-30T02:30")     // ← interprets it in the *browser's*
 *                                      //   zone on the client, and in the
 *                                      //   *server's* zone in a server action
 *
 * That is a silent dependency on where the code happens to run. The same form
 * submission produces a different instant on a laptop in Jakarta and in a
 * Vercel function in Washington, and nothing in the code says so. In this app
 * it is worse than a generic bug, because the entire domain premise is that
 * broker server time is not the user's time.
 *
 * ── The rule ──
 * Every naive string is converted with an **explicit zone**, and the zone comes
 * from `trading_accounts.server_timezone` — the broker's clock, stored per
 * account as an IANA name so DST rules are applied by date rather than assumed.
 *
 * That is also the right *domain* answer, not merely the safe one: the times a
 * trader reads off their MT5 terminal are broker server time. Typing "14:30"
 * after seeing 14:30 in the terminal should record the instant the broker
 * called 14:30 — which in `Europe/Athens` is 12:30 UTC in January and 11:30 UTC
 * in July. Storing what the trader saw is what makes the journal reconcile
 * against the statement, and it means Slice 2's CSV importer converts times the
 * same way as manual entry rather than inventing a second rule.
 */
import { fromZonedTime } from "date-fns-tz";

/**
 * Splits an instant into its wall-clock parts in `timeZone`, via `Intl`.
 *
 * ── Why not `date-fns-tz`'s `formatInTimeZone` ──
 * Because it is measurably wrong at the edge this app exists to handle. In
 * `date-fns-tz@3.2.0`, instants in the hour immediately *before* a spring-
 * forward transition render one hour ahead:
 *
 *   2026-03-29T00:30:00Z in Europe/Athens
 *     formatInTimeZone → "03:30 +02:00"   ← self-contradictory: 00:30Z at
 *                                            +02:00 is 02:30, not 03:30
 *     Intl            → "02:30 EET"       ← correct
 *
 * A trade closed at 02:30 broker time on the DST changeover day would have been
 * displayed as 03:30. `time.test.ts` sweeps both 2026 transition days at
 * 15-minute steps and asserts our output matches `Intl` everywhere, so this
 * stays fixed if the dependency changes.
 *
 * `Intl` is the platform's own binding to the IANA database — the same source
 * Postgres uses — so it is the right authority for display. `fromZonedTime` is
 * still used for the *inbound* direction, where it is correct (the same test
 * verifies that by round-tripping through `Intl`).
 *
 * `hourCycle: "h23"` rather than `hour12: false`: the latter can render
 * midnight as "24" in some engines, which would produce "2026-03-29T24:00".
 */
function zonedParts(instant: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);

  const out: Record<string, string> = {};
  for (const part of parts) out[part.type] = part.value;
  return out;
}

/**
 * Naive wall-clock string in `timeZone` → the UTC instant it denotes.
 *
 * ── Two edge cases, and what happens at each ──
 * DST makes this mapping non-total, in both directions:
 *
 *  - **Spring forward (nonexistent time).** `Europe/Athens` jumps 03:00 → 04:00
 *    on the last Sunday of March, so "2026-03-29T03:30" names a moment that
 *    never happened. `fromZonedTime` resolves it by applying the *post*-
 *    transition offset (+03), landing on 00:30 UTC = 02:30 local — just before
 *    the gap. It does not throw.
 *  - **Fall back (ambiguous time).** In late October, 03:30 local happens twice.
 *    `fromZonedTime` picks the second, standard-time reading (+02).
 *
 * Both directions are *measured*, not reasoned about — `time.test.ts` asserts
 * them, and an earlier version of this comment described the opposite for both.
 * A library's behaviour in the two hours a year where the mapping is not a
 * function is exactly the thing to pin with a test rather than a paragraph.
 *
 * Both are documented rather than rejected because for *manual entry* a
 * defined, deterministic answer beats an error the user cannot act on — they
 * are transcribing a time their terminal displayed, and a nonexistent one means
 * a typo, which the resolved value makes visible on the detail page.
 *
 * The CSV importer needed a decision here rather than an inheritance, because a
 * file can contain thousands of rows (spec §6.5). Slice 2 made it: `lib/import/
 * time.ts` keeps this resolution instead of rejecting the row, and explains
 * why. The tests below are what that decision was built on.
 */
export function zonedInputToUtc(naive: string, timeZone: string): Date {
  return fromZonedTime(naive, timeZone);
}

/**
 * UTC instant → the naive string to put back in a `datetime-local` input.
 *
 * The exact inverse of the above, so opening the edit form shows the same
 * broker-clock time that was typed in, rather than the same instant rendered in
 * whatever zone the server happens to run in.
 */
export function utcToZonedInput(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * A stored instant, rendered for reading in the broker's zone.
 *
 * Every timestamp shown in the UI goes through here with the account's zone, so
 * the app displays one consistent clock — the one the trader's platform shows —
 * instead of mixing server time and broker time on the same screen.
 */
export function formatInAccountZone(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/**
 * Is this string a valid IANA zone name?
 *
 * Validated by asking the platform's own timezone database rather than checking
 * against a hand-written list, which would go stale — zones are added and
 * renamed as governments change their minds. `Intl` throws a `RangeError` for
 * an unknown zone, and that throw is the check.
 *
 * Worth guarding: a bad zone stored on an account would make every subsequent
 * date conversion for that account throw, long after the typo was made.
 */
export function isValidTimeZone(value: string): boolean {
  try {
    // The constructor is the validation; the instance is discarded.
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * A calendar day boundary in the broker's zone, as a UTC instant.
 *
 * Date filters read "trades closed on 2026-04-06", and that day starts and ends
 * at the broker's midnight, not UTC midnight — in EET those differ by two or
 * three hours, so a UTC-based range silently moves trades between days. Spec §9
 * makes this concrete: the daily-loss calculation groups by *server* date, and
 * grouping by UTC date gives a different set of days.
 *
 * `end: true` returns the start of the following day, so callers filter with a
 * half-open range `[start, end)` — the boundary style that has no gap and no
 * overlap, and no need to reason about whether 23:59:59.999 is inclusive.
 */
export function zonedDayBoundary(day: string, timeZone: string, end = false): Date {
  return fromZonedTime(`${end ? nextCalendarDay(day) : day}T00:00:00`, timeZone);
}

/**
 * `"2026-03-31"` → `"2026-04-01"`, purely as calendar arithmetic.
 *
 * Deliberately done on the date string before any zone is involved, rather than
 * by adding 86 400 000 ms to an instant. A local day containing a DST switch is
 * 23 or 25 hours long, so adding a fixed day's worth of milliseconds lands an
 * hour off twice a year — the exact bug this module exists to avoid.
 *
 * `Date.UTC` is used only as a calendar (it handles month and year rollover,
 * including leap years); UTC is safe here precisely because no zone conversion
 * has happened yet and none happens until `fromZonedTime` above.
 */
function nextCalendarDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}
