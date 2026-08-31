/**
 * One parsed CSV row → the columns of a `trades` row.
 *
 * The counterpart of `lib/trades/write-values.ts`, which does the same job for
 * the manual entry form. Both exist so the two error-prone steps in getting a
 * trade into the database — converting broker wall-clock time with an explicit
 * zone, and deriving risk without floats — are pure functions with tests rather
 * than lines buried in a server action.
 *
 * Pure, and that matters more here than in the manual path: this is the
 * function the golden-number test runs over 180 fixture rows to check twelve
 * published figures, and the two-fixture invariant test runs over 360
 * timestamps. Neither needs a database.
 */
import { deriveRisk } from "@/lib/trades/risk";
import { toUtc } from "@/lib/import/time";
import type { ImportRow } from "@/lib/import/mt5-csv";
import type { TradeWriteValues } from "@/lib/trades/write-values";

export type ImportTarget = {
  id: string;
  /** IANA name — the zone every naive time in the file is read in (§6.5). */
  serverTimezone: string;
};

export function toImportWriteValues(row: ImportRow, account: ImportTarget): TradeWriteValues {
  const risk = deriveRisk(row);

  return {
    tradingAccountId: account.id,

    // The whole point of §6.5, in two lines. The account's zone is applied per
    // row, so a file that crosses a DST boundary — `mt5-history-eet.csv` does,
    // at ticket 50000086 — converts each side of the transition with its own
    // offset instead of one offset for the file.
    openedAt: toUtc(row.openedAt, account.serverTimezone),
    closedAt: toUtc(row.closedAt, account.serverTimezone),

    externalTicket: row.ticket,
    symbol: row.symbol,
    direction: row.direction,
    volume: row.volume,
    openPrice: row.openPrice,
    closePrice: row.closePrice,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,

    // Strings, straight through, exactly as the broker wrote them.
    grossProfit: row.grossProfit,
    commission: row.commission,
    swap: row.swap,

    // Computed here rather than left NULL for Slice 3 to backfill: §4.3 makes
    // these application-computed columns, and §6.6 publishes "Avg R +0.4552,
    // coverage 180/180" for this exact fixture. An import that left them NULL
    // would produce coverage 0/180 and no dashboard could recover it.
    riskAmount: risk.riskAmount,
    rMultiple: risk.rMultiple,

    // Provenance is set by the code path, never by the client — the same rule
    // the manual action follows in the opposite direction.
    source: "import",
  };
}
