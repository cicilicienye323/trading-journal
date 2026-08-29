/**
 * Pure helpers for trade data. No database, no framework — so they unit-test in
 * milliseconds and the rules stay readable without knowing any Next.js.
 */

/**
 * Canonical form of an instrument symbol: trimmed and uppercased.
 *
 * Normalizing on the way *in* rather than on the way out is the decision worth
 * defending. `eurusd`, `EURUSD ` and `EurUsd` are the same instrument to a
 * trader, and if all three reach the database as written, then the per-symbol
 * breakdown in §5.3 shows three rows for one pair, and the symbol filter misses
 * two thirds of the matches.
 *
 * The alternative — storing raw and comparing with `lower(symbol) = lower(?)` —
 * works, but it makes every symbol query unable to use `trades_user_symbol_idx`
 * unless a matching expression index is added too. One cheap normalization at
 * the boundary removes that whole class of problem.
 *
 * Broker suffixes (`EURUSD.pro`, `XAUUSD_i`) are deliberately left alone: they
 * genuinely denote different contracts with different spreads, and collapsing
 * them would merge instruments the trader considers separate. Slice 2 revisits
 * this if the fixture demands it.
 */
export function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Collapses an optional free-text field to `null` when it carries no content.
 *
 * `""` and `"   "` from an untouched input are not data. Storing them means
 * `setup_tag` has three ways to say "no tag" (NULL, "", "  "), and every filter
 * and grouping afterwards has to handle all three. One representation of
 * absence, decided at the boundary.
 */
export function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Rejects text Postgres physically cannot store.
 *
 * A NUL byte (U+0000) is legal in a JavaScript string and illegal in a Postgres
 * `text` value: the server answers `22021 invalid byte sequence for encoding
 * "UTF8"` and the request 500s.
 *
 * The important part, and the reason this is a named function with a comment
 * rather than an inline check: **parameterised queries do not protect against
 * this.** Binding a value keeps it from being interpreted as SQL, which stops
 * injection — but the byte still has to be encodable, and NUL is not. So the
 * usual "we use bind parameters, we're fine" reasoning is true about injection
 * and false about availability.
 *
 * Found by hitting `/trades?symbol=%00%01`, which returned a 500 while every
 * other malformed query parameter degraded gracefully. Anything user-supplied
 * that reaches a text column goes through here.
 */
export function isStorableText(value: string): boolean {
  return !value.includes("\u0000");
}

/**
 * The characters a symbol may contain.
 *
 * Letters and digits, plus `.`, `_` and `-` for broker contract suffixes like
 * `EURUSD.pro`, `XAUUSD_i` or `US30-cash`. An allowlist rather than a
 * denylist: it is a closed, well-understood set, so listing what is permitted
 * is both shorter and safer than trying to enumerate what is not.
 */
export const SYMBOL_PATTERN = /^[A-Z0-9._-]+$/;
