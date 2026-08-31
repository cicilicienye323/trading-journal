/**
 * The CSV contract, tested — spec §6.4's two tables, plus the duplicate-header
 * trap that §6.2 warns about.
 *
 * `fixtures/edge-cases.csv` is read here rather than inlined. It is hand-made
 * for exactly this purpose: all 180 rows of the big fixture are valid and every
 * one has a stop loss, so the entire rejection path and the entire "no stop →
 * no R" path are invisible to it (§6.4). A separate small file keeps the two
 * concerns apart — big fixture for the happy path, small file for the edges.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MAX_FILE_BYTES, MT5_HEADER, parseCsv, validateRow } from "./mt5-csv";

const HEADER = MT5_HEADER.join(",");
const ROW =
  "2025.12.04 21:49:23,50000000,XAUUSD,buy,0.16,2114.92,2112.62,2120.27,2025.12.07 22:09:23,2112.80,-1.12,0.21,-33.92";

const file = (...lines: string[]) => [HEADER, ...lines].join("\n");
const fields = (row: string) => row.split(",");

/** Replaces one positional field, so each test names only what it changes. */
function withField(index: number, value: string): string[] {
  const next = fields(ROW);
  next[index] = value;
  return next;
}

describe("parseCsv — file-level rules", () => {
  it("accepts the real MT5 header", () => {
    const result = parseCsv(file(ROW));
    expect(result.ok).toBe(true);
  });

  it("refuses the whole file when the header does not match", () => {
    // Not "skip the bad rows": a wrong header means this is not the format at
    // all, and importing part of it would put arbitrary columns into money
    // fields. §6.3 draws this line explicitly.
    const result = parseCsv(["Ticket,Open Time,Symbol", "1,2,3"].join("\n"));
    expect(result).toEqual({
      ok: false,
      error: "unexpected CSV header — expected an MT5 history export",
    });
  });

  it("refuses a header whose columns are merely reordered", () => {
    // Positional parsing means order *is* the contract, so the header check
    // has to compare cell by cell rather than as a set.
    //
    // Note what this cannot catch, since it is the honest limit of the
    // approach: a file with the two `Time` columns swapped, or the two `Price`
    // columns, has a byte-identical header and no check on the header alone
    // can tell the difference. That is why §6.1 pins the contract to a real
    // export rather than to a description of one, and why the golden-number
    // test parses the actual fixture — an open/close swap moves every figure
    // in that table.
    const swapped = [...MT5_HEADER];
    [swapped[4], swapped[5]] = [swapped[5], swapped[4]];
    expect(parseCsv([swapped.join(","), ROW].join("\n")).ok).toBe(false);
  });

  it("requires the spaces in `S / L` and `T / P`", () => {
    // Easy to normalise away by accident, and part of what identifies the
    // format. "S/L" is a different file.
    const tightened = HEADER.replace("S / L", "S/L");
    expect(parseCsv([tightened, ROW].join("\n")).ok).toBe(false);
  });

  it("tolerates a byte-order mark and CRLF line endings", () => {
    // What a file that has been opened in Excel on Windows looks like. Neither
    // is format sniffing: it is the same format, written by a different editor.
    const result = parseCsv(`﻿${HEADER}\r\n${ROW}\r\n`);
    expect(result.ok && result.rows).toHaveLength(1);
  });

  it("reports an empty file as having no data rows", () => {
    expect(parseCsv("")).toEqual({ ok: false, error: "no data rows found" });
  });

  it("reports a header with no rows under it as having no data rows", () => {
    expect(parseCsv(HEADER)).toEqual({ ok: false, error: "no data rows found" });
  });

  it("refuses a file over the size limit, and says how big it was", () => {
    expect(parseCsv(file(ROW), { byteSize: 13_000_000 })).toEqual({
      ok: false,
      error: "file too large: 12.4 MB (limit 5 MB)",
    });
    // The boundary itself is allowed, not refused.
    expect(parseCsv(file(ROW), { byteSize: MAX_FILE_BYTES }).ok).toBe(true);
  });

  it("refuses a file over the row limit", () => {
    const many = Array.from({ length: 10_001 }, (_, index) =>
      withField(1, String(60_000_000 + index)).join(","),
    );
    expect(parseCsv(file(...many))).toEqual({
      ok: false,
      error: "file too large: 10,001 rows (limit 10,000 rows)",
    });
  });

  it("ignores blank lines instead of reporting them as malformed rows", () => {
    // A trailing newline is how text files end. Reporting it as "expected 13
    // columns, got 1" on every well-formed file would teach users to ignore
    // the error list, which is where the real errors are.
    const result = parseCsv(`${file(ROW)}\n\n`);
    expect(result.ok && result.totalRows).toBe(1);
    expect(result.ok && result.rejected).toEqual([]);
  });
});

describe("parseCsv — reading fields by position", () => {
  it("does not let the duplicate header names collide", () => {
    // The §6.2 trap, as an assertion. `Time` appears at index 0 and 8 and
    // `Price` at 5 and 9, so a name-keyed map would make close_price equal
    // open_price — no error, every trade breakeven, every R null.
    const result = parseCsv(file(ROW));
    expect(result.ok && result.rows[0]).toMatchObject({
      openedAt: "2025.12.04 21:49:23",
      closedAt: "2025.12.07 22:09:23",
      openPrice: "2114.92",
      closePrice: "2112.80",
    });
  });

  it("keeps prices as written, trailing zeros and all", () => {
    // "2112.80" must not become "2112.8". The digit count is the instrument's
    // precision, and normalising it away loses information about the symbol.
    const result = parseCsv(file(ROW));
    expect(result.ok && result.rows[0].closePrice).toBe("2112.80");
  });

  it("numbers rows by their line in the file, so an error can be found", () => {
    const result = parseCsv(file(ROW, withField(1, "50000001").join(",")));
    expect(result.ok && result.rows.map((row) => row.line)).toEqual([2, 3]);
  });

  it("uppercases and trims the symbol", () => {
    const result = parseCsv(file(withField(2, " eurusd ").join(",")));
    expect(result.ok && result.rows[0].symbol).toBe("EURUSD");
  });

  it("accepts either case for the direction", () => {
    const result = parseCsv(file(withField(3, "SELL").join(",")));
    expect(result.ok && result.rows[0].direction).toBe("sell");
  });
});

describe("validateRow — the §6.4 row rules", () => {
  const reject = (row: string[]) => {
    const result = validateRow(row, 2);
    if (result.ok) throw new Error("expected the row to be rejected");
    return result.errors;
  };

  it("reports the wrong field count on its own", () => {
    // Alone, deliberately: with the columns misaligned every other check is
    // reading the wrong field, so its errors would describe the misalignment
    // rather than the file's actual problem.
    expect(reject(fields(ROW).slice(0, 11))).toEqual(["expected 13 columns, got 11"]);
  });

  it("names a missing required value by column and meaning", () => {
    expect(reject(withField(9, ""))).toContain("missing value in column 9 (close price)");
  });

  it("rejects a number it cannot parse, quoting what it saw", () => {
    // Scientific notation is the realistic case — a spreadsheet writes 0.1 as
    // "1e-1" — and `Number()` would accept it while `numeric` would not.
    expect(reject(withField(4, "1e-1"))).toContain('invalid number in Volume: "1e-1"');
  });

  it("rejects a price with more decimals than the column stores", () => {
    // Postgres would round it silently and the journal would stop matching the
    // broker statement in the last digit.
    expect(reject(withField(5, "2114.923456"))).toContain('invalid number in Price: "2114.923456"');
  });

  it("rejects a non-positive volume or price", () => {
    expect(reject(withField(4, "0.00"))).toEqual(["volume must be greater than 0"]);
    expect(reject(withField(5, "0.00000"))).toEqual(["open price must be greater than 0"]);
    expect(reject(withField(9, "-1.00000"))).toEqual(["close price must be greater than 0"]);
  });

  it("does not pile a range error on top of a parse error", () => {
    // One cause, one message. "invalid number" and "must be greater than 0"
    // for the same field describes the same problem twice.
    expect(reject(withField(4, "abc"))).toEqual(['invalid number in Volume: "abc"']);
  });

  it("rejects an operation type that is not a closed position", () => {
    // MT5 also exports `buy limit`, `balance` and similar. §6.1 refuses rather
    // than guessing at what they mean.
    expect(reject(withField(3, "b"))).toContain('unknown type: "b"');
    expect(reject(withField(3, "buy limit"))).toContain('unknown type: "buy limit"');
  });

  it("rejects a date format it was not promised", () => {
    expect(reject(withField(0, "04/12/2025 21:49"))).toContain(
      'invalid datetime: "04/12/2025 21:49"',
    );
  });

  it("rejects a close time before the open time", () => {
    expect(reject(withField(8, "2025.12.01 10:00:00"))).toEqual(["close time is before open time"]);
  });

  it("collects every problem in a row rather than stopping at the first", () => {
    // A user fixing a hand-edited file wants the whole list for a line, not
    // one error per re-upload.
    const row = fields(ROW);
    row[3] = "b";
    row[4] = "abc";
    expect(reject(row)).toHaveLength(2);
  });

  it("treats a stop loss of 0 as no stop, not as a stop at zero", () => {
    // The distinction the nullable column exists for. A stop of 0 would mean
    // risking the instrument's entire price; NULL means there was no stop, and
    // §5.2 says that trade has no R.
    const result = validateRow(withField(6, "0"), 2);
    expect(result.ok && result.row.stopLoss).toBeNull();

    const zeroed = validateRow(withField(6, "0.00000"), 2);
    expect(zeroed.ok && zeroed.row.stopLoss).toBeNull();
  });

  it("rejects a negative stop loss, which is neither a price nor 'unset'", () => {
    expect(reject(withField(6, "-1.00000"))).toContain("stop loss must not be negative");
  });
});

describe("the hand-made edge-case fixture", () => {
  const result = parseCsv(readFileSync("fixtures/edge-cases.csv", "utf8"));
  if (!result.ok) throw new Error(result.error);

  it("accepts the rows that are unusual but legitimate", () => {
    // A trade with no stop, a trade that closed exactly where it opened, a
    // trade reporting no profit, and a trade in the DST gap. None of these is
    // an error; each is a row the big fixture cannot produce.
    expect(result.rows.map((row) => row.ticket)).toEqual([
      "90000001",
      "90000002",
      "90000003",
      "90000009",
    ]);
    expect(result.rows[0].stopLoss).toBeNull();
  });

  it("rejects each malformed row for its own reason", () => {
    expect(result.rejected.map((row) => [row.line, row.ticket, row.errors.join("; ")])).toEqual([
      [5, null, "expected 13 columns, got 11"],
      [6, "90000005", "close time is before open time"],
      [7, "90000001", "duplicate position within file: 90000001"],
      [8, "90000006", 'unknown type: "b"'],
      [9, "90000007", 'invalid number in Volume: "1e-1"'],
      [10, "90000008", "volume must be greater than 0"],
    ]);
  });

  it("counts every data row, accepted or not", () => {
    // `import_batches.row_count` is "rows in the file" (§4.4), so the total
    // has to include the ones that were skipped.
    expect(result.totalRows).toBe(result.rows.length + result.rejected.length);
    expect(result.totalRows).toBe(10);
  });
});
