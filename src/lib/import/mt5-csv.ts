/**
 * The MT5 "History" CSV contract — spec §6.2, §6.4.
 *
 * Pure: text in, rows and errors out. No database, no `File`, no request. That
 * is what lets the golden-number test in `golden-numbers.test.ts` check 12
 * published figures without a Postgres anywhere near it.
 *
 * ── The one thing that must not be done, and why it is tempting ──
 * The header contains **duplicate names**: `Time` at index 0 and 8, `Price` at
 * index 5 and 9. The reflex is
 *
 *     const byName = Object.fromEntries(header.map((h, i) => [h, fields[i]]))
 *
 * and it compiles, runs, and imports 180 rows without a single error — with
 * `close_price` silently holding the *open* price, because the second `Price`
 * overwrote the first. Every trade then looks like it closed exactly where it
 * opened, every R comes out NULL, and the bug surfaces two slices later as
 * "the statistics look wrong".
 *
 * So: validate the header once, positionally, then read fields **by index**.
 * The `COLUMNS` table below is the single description of that layout, and it is
 * indexed rather than keyed for exactly this reason.
 *
 * ── Scope, held deliberately ──
 * One format. No second format, no delimiter sniffing, no custom column
 * mapping (spec §6.1 and §10 — that flexibility is what turns a six-hour
 * importer into a fifteen-hour one). A file that does not match is refused
 * whole, with a message that says what was expected.
 */
import { fitsDecimalColumn, isPositiveDecimal, toDecimal, decimalSign } from "@/lib/money";
import { normalizeSymbol, SYMBOL_PATTERN } from "@/lib/trades/normalize";
import { isMt5DateTime } from "@/lib/import/time";
import type { TradeDirection } from "@/db/schema";

/** File-level limits from §6.4. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_DATA_ROWS = 10_000;

/**
 * The header, exactly as MT5 writes it — including the spaces around the
 * slashes in `S / L` and `T / P`, which are easy to normalise away by accident
 * and are part of what identifies the format.
 */
export const MT5_HEADER = [
  "Time",
  "Position",
  "Symbol",
  "Type",
  "Volume",
  "Price",
  "S / L",
  "T / P",
  "Time",
  "Price",
  "Commission",
  "Swap",
  "Profit",
] as const;

/**
 * Column index → the words that go in an error message.
 *
 * `header` is what the file calls it (used by "invalid number in Volume"),
 * `label` is what a human calls it (used by "missing value in column 9 (close
 * price)"). Both appear in §6.4's message table, and the numbering in those
 * messages is the §6.2 column index so a user can look the column up.
 */
const COLUMNS = [
  { header: "Time", label: "open time" },
  { header: "Position", label: "position" },
  { header: "Symbol", label: "symbol" },
  { header: "Type", label: "type" },
  { header: "Volume", label: "volume" },
  { header: "Price", label: "open price" },
  { header: "S / L", label: "stop loss" },
  { header: "T / P", label: "take profit" },
  { header: "Time", label: "close time" },
  { header: "Price", label: "close price" },
  { header: "Commission", label: "commission" },
  { header: "Swap", label: "swap" },
  { header: "Profit", label: "profit" },
] as const;

const OPEN_TIME = 0;
const POSITION = 1;
const SYMBOL = 2;
const TYPE = 3;
const VOLUME = 4;
const OPEN_PRICE = 5;
const STOP_LOSS = 6;
const TAKE_PROFIT = 7;
const CLOSE_TIME = 8;
const CLOSE_PRICE = 9;
const COMMISSION = 10;
const SWAP = 11;
const PROFIT = 12;

/**
 * Columns that may not be blank. `S / L` and `T / P` are absent from the list:
 * MT5 writes `0` there rather than leaving them empty, but an empty cell means
 * the same thing and rejecting the row over it would help nobody.
 */
const REQUIRED = [
  OPEN_TIME,
  POSITION,
  SYMBOL,
  TYPE,
  VOLUME,
  OPEN_PRICE,
  CLOSE_TIME,
  CLOSE_PRICE,
  COMMISSION,
  SWAP,
  PROFIT,
] as const;

/**
 * One accepted row, with every decimal still a **string**.
 *
 * Nothing here has been through a `number`: prices carry the trailing zeros the
 * broker wrote (`2112.80`, `0.64531`), which is the digit count of the
 * instrument and therefore information. See `lib/money.ts`.
 *
 * Times are still naive broker wall-clock. Converting them needs the account's
 * zone, which is a fact about the destination rather than about the file, so it
 * happens one layer up in `toWriteValues` — this keeps `parseCsv` testable
 * without inventing a timezone for it.
 */
export type ImportRow = {
  /** 1-based line number in the file, header included — what the user sees. */
  line: number;
  ticket: string;
  symbol: string;
  direction: TradeDirection;
  volume: string;
  openedAt: string;
  closedAt: string;
  openPrice: string;
  closePrice: string;
  /** `null` when the file said `0` — no stop was set. */
  stopLoss: string | null;
  takeProfit: string | null;
  grossProfit: string;
  commission: string;
  swap: string;
};

/** A row that was skipped, reported with enough context to fix the file. */
export type RowRejection = {
  line: number;
  /** `null` when the position field itself was unreadable. */
  ticket: string | null;
  errors: string[];
};

export type ParseResult =
  /** File-level refusal (§6.4): nothing was parsed, nothing may be imported. */
  | { ok: false; error: string }
  | { ok: true; totalRows: number; rows: ImportRow[]; rejected: RowRejection[] };

/**
 * @param text      The decoded file contents.
 * @param byteSize  The upload's real size in bytes. Defaults to the string
 *                  length, which is the same for an ASCII CSV; the action
 *                  passes `file.size` so a multi-byte file is measured as the
 *                  user's disk measures it.
 */
export function parseCsv(text: string, { byteSize }: { byteSize?: number } = {}): ParseResult {
  const bytes = byteSize ?? text.length;
  if (bytes > MAX_FILE_BYTES) {
    return { ok: false, error: `file too large: ${megabytes(bytes)} (limit 5 MB)` };
  }

  // A leading BOM is normal in files that have been through Excel, and it would
  // otherwise make the first header cell "﻿Time" and fail the header
  // check with a message that looks like a lie. Stripping one code point is
  // Unicode hygiene, not the format sniffing §6.1 rules out.
  const body = text.replace(/^﻿/, "");

  // Checked before the header, because an empty file has no header either and
  // "unexpected CSV header" would send the user looking for a formatting
  // problem in a file that has nothing in it.
  if (body.trim() === "") return { ok: false, error: "no data rows found" };

  const lines = body.split(/\r?\n/);

  // Blank lines are dropped rather than reported: a trailing newline is how
  // text files end, and "expected 13 columns, got 1" on the last line of every
  // well-formed file would train users to ignore the error list.
  const dataLines: { line: number; text: string }[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() !== "") dataLines.push({ line: index + 1, text: lines[index] });
  }

  if (!isMt5Header(splitRow(lines[0]))) {
    return { ok: false, error: "unexpected CSV header — expected an MT5 history export" };
  }

  if (dataLines.length === 0) return { ok: false, error: "no data rows found" };
  if (dataLines.length > MAX_DATA_ROWS) {
    return {
      ok: false,
      error: `file too large: ${count(dataLines.length)} rows (limit ${count(MAX_DATA_ROWS)} rows)`,
    };
  }

  const rows: ImportRow[] = [];
  const rejected: RowRejection[] = [];
  const seenTickets = new Set<string>();

  for (const { line, text: rowText } of dataLines) {
    const result = validateRow(splitRow(rowText), line);
    if (!result.ok) {
      rejected.push({ line, ticket: result.ticket, errors: result.errors });
      continue;
    }

    // Uniqueness is a property of the file, not of the row, so it is checked
    // here rather than inside `validateRow`. The database's partial unique
    // index would refuse the second copy anyway — but silently, via ON CONFLICT
    // DO NOTHING, where the user would see it as an unexplained "1 duplicate"
    // for a ticket they have never imported.
    if (seenTickets.has(result.row.ticket)) {
      rejected.push({
        line,
        ticket: result.row.ticket,
        errors: [`duplicate position within file: ${result.row.ticket}`],
      });
      continue;
    }

    seenTickets.add(result.row.ticket);
    rows.push(result.row);
  }

  return { ok: true, totalRows: dataLines.length, rows, rejected };
}

export type RowResult =
  { ok: true; row: ImportRow } | { ok: false; ticket: string | null; errors: string[] };

/**
 * Validates one row's 13 fields — spec §6.4's row-level table.
 *
 * **All** failures are collected rather than returning at the first: a user
 * fixing a hand-edited file wants the whole list for a row, not one error per
 * re-upload.
 *
 * A failing row is skipped and the rest of the import proceeds (§6.3). That
 * asymmetry with the header check is deliberate and worth stating: a bad row
 * means dirty data in a file of the right kind, while a bad header means the
 * file is not this format at all, and importing half of it would be worse than
 * importing none.
 */
export function validateRow(fields: string[], line: number): RowResult {
  const errors: string[] = [];
  const at = (index: number) => (fields[index] ?? "").trim();

  if (fields.length !== MT5_HEADER.length) {
    // Field count is reported alone. With the wrong number of columns every
    // subsequent check is reading the wrong column, so the errors it produced
    // would describe a misalignment rather than the file's actual problem.
    return {
      ok: false,
      ticket: null,
      errors: [`expected ${MT5_HEADER.length} columns, got ${fields.length}`],
    };
  }

  for (const index of REQUIRED) {
    if (at(index) === "") {
      errors.push(`missing value in column ${index} (${COLUMNS[index].label})`);
    }
  }

  const ticket = at(POSITION);
  // `varchar(40)`, and §6.2 says integer. Checked as digits rather than parsed:
  // ticket numbers are identifiers, and a 20-digit one must survive as written.
  if (ticket !== "" && !/^\d{1,40}$/.test(ticket)) {
    errors.push(`invalid number in Position: ${JSON.stringify(ticket)}`);
  }

  const symbol = normalizeSymbol(at(SYMBOL));
  if (symbol !== "" && (symbol.length > 20 || !SYMBOL_PATTERN.test(symbol))) {
    errors.push(`invalid symbol: ${JSON.stringify(at(SYMBOL))}`);
  }

  const rawType = at(TYPE);
  const direction = rawType.toLowerCase();
  // Case-insensitive, but only these two. MT5 also exports `buy limit`,
  // `balance` and other operation types; those are not closed positions and
  // §6.1 refuses rather than guesses at them.
  if (rawType !== "" && direction !== "buy" && direction !== "sell") {
    errors.push(`unknown type: ${JSON.stringify(rawType)}`);
  }

  const volume = decimalField(at(VOLUME), VOLUME, 12, 2, errors);
  const openPrice = decimalField(at(OPEN_PRICE), OPEN_PRICE, 18, 5, errors);
  const closePrice = decimalField(at(CLOSE_PRICE), CLOSE_PRICE, 18, 5, errors);
  const stopLoss = optionalPriceField(at(STOP_LOSS), STOP_LOSS, errors);
  const takeProfit = optionalPriceField(at(TAKE_PROFIT), TAKE_PROFIT, errors);
  const grossProfit = decimalField(at(PROFIT), PROFIT, 18, 2, errors);
  const commission = decimalField(at(COMMISSION), COMMISSION, 18, 2, errors);
  const swap = decimalField(at(SWAP), SWAP, 18, 2, errors);

  // Positivity is checked only on values that parsed — otherwise a row with
  // `Volume` of "abc" would collect both "invalid number" and "must be greater
  // than 0", the second of which is noise.
  if (volume !== null && !isPositiveDecimal(volume)) errors.push("volume must be greater than 0");
  if (openPrice !== null && !isPositiveDecimal(openPrice)) {
    errors.push("open price must be greater than 0");
  }
  if (closePrice !== null && !isPositiveDecimal(closePrice)) {
    errors.push("close price must be greater than 0");
  }

  const openedAt = at(OPEN_TIME);
  const closedAt = at(CLOSE_TIME);
  if (openedAt !== "" && !isMt5DateTime(openedAt)) {
    errors.push(`invalid datetime: ${JSON.stringify(openedAt)}`);
  }
  if (closedAt !== "" && !isMt5DateTime(closedAt)) {
    errors.push(`invalid datetime: ${JSON.stringify(closedAt)}`);
  }
  // `YYYY.MM.DD HH:MM:SS` is fixed-width and big-endian, so a plain string
  // comparison orders it correctly — no Date needed, and no zone either: both
  // sides are the same broker clock, and a conversion cannot change their
  // order. The database repeats the rule as a CHECK constraint.
  if (isMt5DateTime(openedAt) && isMt5DateTime(closedAt) && closedAt < openedAt) {
    errors.push("close time is before open time");
  }

  if (errors.length > 0) return { ok: false, ticket: ticket === "" ? null : ticket, errors };

  return {
    ok: true,
    row: {
      line,
      ticket,
      symbol,
      direction: direction as TradeDirection,
      volume: volume!,
      openedAt,
      closedAt,
      openPrice: openPrice!,
      closePrice: closePrice!,
      stopLoss,
      takeProfit,
      grossProfit: grossProfit!,
      commission: commission!,
      swap: swap!,
    },
  };
}

/**
 * Splits on commas with no quote handling, and that is a decision.
 *
 * The MT5 history export has no quoted fields — every column is a number, a
 * ticket, a symbol or a timestamp, none of which can contain a comma. Adding a
 * quoted-field state machine would be code with no input to exercise it, and
 * the §6.1 scope gate is explicit that the importer accepts one real format
 * rather than growing toward a general CSV reader. A file that does use quoting
 * fails the column-count check with a message that names the problem.
 */
function splitRow(line: string): string[] {
  return line.split(",");
}

/** The header must match cell for cell, in order — §6.2. */
function isMt5Header(fields: string[]): boolean {
  return (
    fields.length === MT5_HEADER.length &&
    MT5_HEADER.every((expected, index) => fields[index].trim() === expected)
  );
}

/**
 * A decimal that must fit its `numeric(precision, scale)` column.
 *
 * The scale check is the one that earns its place. Postgres **rounds** an
 * over-long fraction rather than erroring, so a price with six decimals would
 * be accepted, stored as five, and quietly differ from the broker's statement.
 * Refusing it here means the number in the journal is the number in the file.
 *
 * Returns the string unchanged — `""` maps to `null` and is reported by the
 * required-field check instead, so an empty cell produces one error rather
 * than two.
 */
function decimalField(
  value: string,
  index: number,
  precision: number,
  scale: number,
  errors: string[],
): string | null {
  if (value === "") return null;
  if (!fitsDecimalColumn(value, precision, scale)) {
    errors.push(`invalid number in ${COLUMNS[index].header}: ${JSON.stringify(value)}`);
    return null;
  }
  return value;
}

/**
 * `S / L` and `T / P`: a price, or `0` meaning "not set".
 *
 * The zero is mapped to `null` here rather than stored, because the column is
 * nullable precisely so that "no stop was set" and "the stop was at price zero"
 * stay different facts — the same distinction §4.2 draws for the prop-firm
 * limits. Slice 3's R-multiple depends on it: a NULL stop means no R, while a
 * stop of 0 would mean risking the entire price of the instrument.
 *
 * A negative value is neither, so it is refused.
 */
function optionalPriceField(value: string, index: number, errors: string[]): string | null {
  if (value === "") return null;

  const parsed = decimalField(value, index, 18, 5, errors);
  if (parsed === null) return null;

  if (decimalSign(toDecimal(parsed)) === 0) return null;
  if (!isPositiveDecimal(parsed)) {
    errors.push(`${COLUMNS[index].label} must not be negative`);
    return null;
  }
  return parsed;
}

/** `12.4 MB` — display formatting of a byte count, not of money. */
function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** `10,000` — thousands separators, so the limit is readable at a glance. */
function count(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
