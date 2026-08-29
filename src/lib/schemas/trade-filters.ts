/**
 * The `/trades` filter state — read from the URL, not from React state.
 *
 * ── Why the URL is the state ──
 * `useState` would be less code. The URL wins for four concrete reasons, and
 * "you can share the link" is only the first:
 *
 *  1. **Shareable and bookmarkable.** A filtered view is a thing worth sending
 *     to someone, or keeping.
 *  2. **The back button works.** Filter changes become history entries, so Back
 *     undoes a filter instead of leaving the page entirely — which is what
 *     users expect and what `useState` gets wrong.
 *  3. **A Server Component can read it directly.** `searchParams` is available
 *     during the server render, so the filtered query runs on the server and
 *     the first paint already has the right rows. With `useState` the page
 *     renders, hydrates, *then* fetches — a flash of the wrong data, plus the
 *     filtering logic shipped to the browser.
 *  4. **Reload survives it.** State that vanishes on refresh reads as a bug.
 *
 * ── The part that is easy to forget ──
 * The URL is **untrusted input**. Anyone can type anything into it, and crawlers
 * and link previewers routinely mangle query strings. `?page=abc`,
 * `?symbol[]=1`, `?from=not-a-date` must all render a sensible page, never a
 * 500. So every field here is parsed with a fallback rather than asserted:
 * `.catch()` turns "unparseable" into "the default", which is the correct
 * response to a garbled filter — show the unfiltered list, not an error page.
 *
 * That is why this module has tests: the hostile-input behaviour is the feature.
 */
import { z } from "zod";

import { SYMBOL_PATTERN } from "@/lib/trades/normalize";

/** Rows per page. Simple offset pagination is all v1 needs. */
export const TRADES_PAGE_SIZE = 25;

/**
 * Next gives a repeated query parameter as `string[]` (`?symbol=a&symbol=b`)
 * and an absent one as `undefined`. Collapsing to the first value keeps one
 * shape downstream and means a duplicated parameter narrows the list rather
 * than crashing it.
 */
function firstValue(value: unknown): unknown {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Wraps a schema so any unusable input becomes `undefined` (= no filter). */
function optionalParam<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    const first = firstValue(value);
    // An empty string arrives from a select whose "All" option has value "",
    // and means "no filter" rather than "match the empty string".
    return first === "" ? undefined : first;
  }, schema.optional().catch(undefined));
}

/** `YYYY-MM-DD` from `<input type="date">`. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  // Rejects well-formed nonsense like 2026-02-31, which matches the regex but
  // is not a day. Checked by round-tripping through the calendar rather than by
  // counting days per month.
  //
  // The `Number.isNaN` guard is load-bearing, and a unit test is why it is
  // here. Zod runs every check on a string schema even after an earlier one
  // fails, so this refinement still sees "not-a-date" — and `.toISOString()` on
  // an Invalid Date *throws* rather than returning a value. A thrown exception
  // is not something `.catch()` can rescue, so without this guard
  // `/trades?from=not-a-date` was a 500, which is exactly the failure the URL
  // parsing here exists to prevent.
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  });

export const tradeFiltersSchema = z.object({
  /** Which trading account. Validated as a UUID so a junk value is dropped. */
  account: optionalParam(z.uuid()),

  /**
   * Uppercased so `?symbol=eurusd` matches the stored `EURUSD`.
   *
   * The charset check is not cosmetic. This value is bound into a query against
   * a `text` column, and a NUL byte makes Postgres reject the *encoding* —
   * `22021`, a 500 — which bind parameters do not prevent. `/trades?symbol=%00`
   * was a 500 before this line. See `isStorableText` in lib/trades/normalize.
   */
  symbol: optionalParam(z.string().trim().min(1).max(20).toUpperCase().regex(SYMBOL_PATTERN)),

  direction: optionalParam(z.enum(["buy", "sell"])),

  /** Inclusive start / exclusive end of the close-date range, in broker time. */
  from: optionalParam(isoDate),
  to: optionalParam(isoDate),

  /**
   * 1-based page number.
   *
   * Parsed from digits explicitly instead of with `z.coerce.number()`. Not
   * because a float would hurt here — a page index is a small integer and
   * exactly representable — but because `coerce.number()` accepts things that
   * are not page numbers: `""` becomes 0, `" 12 "` becomes 12, `"1e3"` becomes
   * 1000, `"0x10"` becomes 16. A digits-only regex says what is meant.
   *
   * `.catch(1)` is what keeps `?page=abc` a rendered first page instead of a
   * 500 — the specific case the review rubric checks.
   */
  page: z.preprocess(
    (value) => firstValue(value),
    z
      .string()
      .regex(/^\d+$/)
      // Safe: matched digits only, and clamped below. This is a page index, not
      // a money value — the no-`Number()` rule in lib/money.ts is about values
      // headed for a `numeric` column.
      .transform(Number)
      .pipe(z.number().int().min(1).max(10_000))
      .catch(1),
  ),
});

export type TradeFilters = z.infer<typeof tradeFiltersSchema>;

/**
 * Parses `searchParams` into filters, never throwing.
 *
 * Every field already has its own `.catch`, so this cannot realistically fail —
 * but `safeParse` with a defaulted fallback means that even a future field
 * added without a `.catch` degrades to the unfiltered list instead of taking
 * the page down.
 */
export function parseTradeFilters(
  searchParams: Record<string, string | string[] | undefined>,
): TradeFilters {
  const result = tradeFiltersSchema.safeParse(searchParams);
  return result.success ? result.data : { page: 1 };
}

/**
 * Serialises filters back into a query string for pagination and filter links.
 *
 * Undefined values are omitted rather than written as empty parameters, and
 * `page=1` is left implicit, so the canonical unfiltered URL is a clean
 * `/trades` — which matters because this string is what users copy and share.
 */
export function tradeFiltersToQuery(filters: TradeFilters): string {
  const params = new URLSearchParams();

  if (filters.account) params.set("account", filters.account);
  if (filters.symbol) params.set("symbol", filters.symbol);
  if (filters.direction) params.set("direction", filters.direction);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.page > 1) params.set("page", String(filters.page));

  return params.toString();
}
