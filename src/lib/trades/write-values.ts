/**
 * Maps validated form input to the columns of a `trades` row.
 *
 * Pure — no database, no request — so the one genuinely error-prone step in
 * trade entry is unit-testable: turning two naive wall-clock strings into UTC
 * instants using the broker's zone. That conversion is where a trading journal
 * quietly goes wrong, and it should not require a running Postgres to test.
 *
 * Keeping it out of the server action is also what keeps the action thin
 * (spec §8.2): the action validates, calls this, and writes.
 */
import type { trades } from "@/db/schema";
import type { TradeInput } from "@/lib/schemas/trade";
import { deriveRisk } from "@/lib/trades/risk";
import { zonedInputToUtc } from "@/lib/trades/time";

/**
 * The insertable columns, minus the ones the caller must not supply.
 *
 * `netProfit` is not in `$inferInsert` at all — it is a generated column, so
 * Drizzle removes it and the compiler refuses any attempt to set it. P&L is
 * computed by Postgres, and application code structurally cannot compute it.
 */
export type TradeWriteValues = Omit<
  typeof trades.$inferInsert,
  "id" | "userId" | "createdAt" | "updatedAt"
>;

/**
 * @param input      Already validated by `tradeInput`.
 * @param timeZone   The **account's** `server_timezone`, resolved by the caller
 *                   from a row it has confirmed the user owns. Passing it in
 *                   rather than defaulting is deliberate: there is no sensible
 *                   default, and a wrong zone here is a silent data error, not
 *                   a crash.
 */
export function toTradeWriteValues(input: TradeInput, timeZone: string): TradeWriteValues {
  return {
    tradingAccountId: input.tradingAccountId,
    symbol: input.symbol,
    direction: input.direction,
    volume: input.volume,

    // The only interesting line in this file. The form submits broker
    // wall-clock time with no zone attached; this converts it explicitly rather
    // than letting `new Date(string)` apply whatever zone the server runs in.
    openedAt: zonedInputToUtc(input.openedAt, timeZone),
    closedAt: zonedInputToUtc(input.closedAt, timeZone),

    openPrice: input.openPrice,
    closePrice: input.closePrice,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,

    // Strings, straight through, untouched — see lib/money.ts.
    grossProfit: input.grossProfit,
    commission: input.commission,
    swap: input.swap,

    setupTag: input.setupTag,
    notes: input.notes,

    // Derived on every write, including edits — spec §4.3 makes these
    // application-computed columns. Recomputing rather than preserving matters
    // on update: correcting a stop loss that was typed wrong must move the R
    // with it, and a stale r_multiple is worse than none because it still
    // averages into Slice 3's statistics looking like a real measurement.
    //
    // Added in Slice 2 alongside the importer. Filling these for imported
    // trades but not for typed ones would leave the same journal with two kinds
    // of trade — one with R, one without — and the coverage figure the
    // dashboard shows would measure how the data arrived rather than how much
    // of it had a stop.
    ...deriveRisk(input),

    // Typed here rather than imported from a form field: this action is the
    // manual-entry path by definition. The CSV importer sets "import" in Slice
    // 2. Letting the client choose would let it forge provenance.
    source: "manual",
  };
}
