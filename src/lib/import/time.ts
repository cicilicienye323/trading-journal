/**
 * Broker wall-clock time in a CSV → the UTC instant to store. Spec §6.5.
 *
 * ── The bug, stated plainly ──
 * MT5 writes `2025.12.04 21:49:23` and says nothing about the offset. Most MT
 * servers run on EET, which is GMT+2 in winter and GMT+3 in summer, so the
 * correct offset **depends on the date of the trade**. A parser that reads one
 * offset for the whole export is wrong for every row after the March
 * changeover — and wrong by exactly one hour, silently, with no error and no
 * row that looks obviously out of place.
 *
 * `fixtures/mt5-history-eet.csv` crosses that transition inside a single file,
 * at ticket 50000086. It exists so this failure is a red test rather than a
 * story about a failure.
 *
 * ── Why this is a thin wrapper and not a conversion ──
 * The conversion itself is `zonedInputToUtc` in `lib/trades/time.ts`, which
 * manual trade entry already uses. Spec §6.5 says "use a real timezone library,
 * do not add or subtract hours by hand"; the stronger version of that rule is
 * that the app should have **one** naive-string-to-UTC function, not one per
 * entry path. A trade typed into the form and the same trade imported from a
 * file must land on the same instant, and the only way to guarantee that is for
 * both to run the same code. So all this file does is translate MT5's dotted
 * date into the ISO shape that function takes.
 *
 * ── DST edge cases, which `lib/trades/time.ts` deferred to this slice ──
 * Two naive times have no single answer:
 *
 *  - **Nonexistent** (spring forward): `Europe/Athens` jumps 03:00 → 04:00, so
 *    `2026.03.29 03:30` names a moment that did not happen.
 *  - **Ambiguous** (fall back): in late October, 03:30 occurs twice.
 *
 * The importer resolves both deterministically — the measured behaviour is the
 * post-transition offset and the second reading, pinned by the tests — rather
 * than rejecting the row. That is the right call *for an import* specifically: a broker's own export cannot contain a time its own
 * server never showed, so a row landing here means either a clock artefact or a
 * zone configured wrongly on the account. Rejecting individual rows would turn
 * a misconfigured account into a scatter of unexplained per-row errors an hour
 * apart, which tells the user nothing; importing them puts every trade in the
 * journal off by at most one hour in the one hour of the year where the wall
 * clock is genuinely ambiguous, which is visible and fixable by correcting the
 * account's timezone and re-importing. `time.test.ts` pins both behaviours.
 */
import { zonedInputToUtc } from "@/lib/trades/time";

/**
 * `YYYY.MM.DD HH:MM:SS` — dots, one space, seconds always present.
 *
 * Anchored and fixed-width on purpose. A looser pattern would accept
 * `2025.1.4 9:5:3`, which MT5 does not emit, and accepting shapes the format
 * does not produce is how a parser starts quietly guessing (spec §6.1: one
 * format, refused firmly when it does not match).
 */
const MT5_DATETIME = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * Does this string name a real moment on the calendar?
 *
 * The regex alone is not enough: `2025.02.30 25:61:00` matches it. The check
 * builds the date in UTC and asks whether every component survived — a rollover
 * (Feb 30 → Mar 2, hour 25 → next day 01) changes at least one of them.
 *
 * UTC is safe here even though the value is not a UTC time: no zone conversion
 * happens, `Date.UTC` is being used purely as a calendar that knows about month
 * lengths and leap years.
 */
export function isMt5DateTime(value: string): boolean {
  const match = MT5_DATETIME.exec(value);
  if (!match) return false;

  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day &&
    probe.getUTCHours() === hour &&
    probe.getUTCMinutes() === minute &&
    probe.getUTCSeconds() === second
  );
}

/**
 * @param naive     `YYYY.MM.DD HH:MM:SS` exactly as it appears in the file.
 * @param timeZone  The destination account's `server_timezone`, an IANA name.
 *                  Required, with no default: there is no sensible guess, and a
 *                  wrong zone here shifts every row by hours without failing.
 *
 * Throws on a string that is not a real MT5 datetime. Callers reach this only
 * for rows `validateRow` already accepted, so a throw means the two disagree
 * about the format — a bug to see, not a row to skip.
 */
export function toUtc(naive: string, timeZone: string): Date {
  if (!isMt5DateTime(naive)) throw new Error(`not an MT5 datetime: ${JSON.stringify(naive)}`);

  // `2025.12.04 21:49:23` → `2025-12-04T21:49:23`, the shape manual entry
  // submits. From here the two paths are literally the same function.
  const [date, time] = naive.split(" ");
  return zonedInputToUtc(`${date.replaceAll(".", "-")}T${time}`, timeZone);
}
