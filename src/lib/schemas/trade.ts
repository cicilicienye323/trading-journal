/**
 * Validation for manual trade entry — spec §4.3, story T1.
 *
 * Every money and price field is a shape-validated **string**, never
 * `z.coerce.number()`. `lib/money.ts` explains why at length; the short version
 * is that coercion runs the value through a float and silently discards the
 * exactness `numeric` was chosen for.
 */
import { z } from "zod";

import { decimalString, optionalDecimalString } from "@/lib/money";
import {
  emptyToNull,
  isStorableText,
  normalizeSymbol,
  SYMBOL_PATTERN,
} from "@/lib/trades/normalize";

/**
 * The naive wall-clock string a `datetime-local` input submits.
 *
 * Validated as a *string shape* and deliberately **not** turned into a `Date`
 * here. A `Date` has no zone attached, so converting at this point would mean
 * guessing one — and the correct zone lives on the trading account, which this
 * schema cannot see. The action resolves the account first, then converts with
 * `zonedInputToUtc`. See `lib/trades/time.ts`.
 *
 * Seconds are optional because browsers submit `YYYY-MM-DDTHH:mm` when the
 * input has no `step` finer than a minute, and `YYYY-MM-DDTHH:mm:ss` when it
 * does.
 */
const datetimeLocal = (label: string) =>
  z
    .string()
    .trim()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
      `${label} must be a date and time, e.g. 2026-04-06T14:30`,
    );

export const tradeInput = z
  .object({
    tradingAccountId: z.uuid("Choose a trading account"),

    // Uppercased and trimmed on the way in so per-symbol grouping and the
    // symbol filter see one spelling — see `normalizeSymbol`.
    symbol: z
      .string()
      .trim()
      .min(1, "Symbol is required")
      .max(20, "Symbol must be 20 characters or fewer")
      .transform(normalizeSymbol)
      // Uppercase first, then check the charset, so the pattern only has to
      // describe uppercase. Rejects control characters — including NUL, which
      // Postgres cannot encode and which would otherwise 500 the action.
      .refine(
        (value) => SYMBOL_PATTERN.test(value),
        "Symbol may only contain letters, digits, and . _ -",
      ),

    direction: z.enum(["buy", "sell"], { message: "Choose buy or sell" }),

    volume: decimalString({ precision: 12, scale: 2, positiveOnly: true, label: "Volume" }),

    openedAt: datetimeLocal("Open time"),
    closedAt: datetimeLocal("Close time"),

    openPrice: decimalString({ precision: 18, scale: 5, positiveOnly: true, label: "Open price" }),
    closePrice: decimalString({
      precision: 18,
      scale: 5,
      positiveOnly: true,
      label: "Close price",
    }),

    stopLoss: optionalDecimalString({
      precision: 18,
      scale: 5,
      positiveOnly: true,
      label: "Stop loss",
    }),
    takeProfit: optionalDecimalString({
      precision: 18,
      scale: 5,
      positiveOnly: true,
      label: "Take profit",
    }),

    // Signed: a losing trade is a negative gross profit, so no `positiveOnly`.
    grossProfit: decimalString({ precision: 18, scale: 2, label: "Gross profit" }),

    // MetaTrader writes commission as a negative number (it is a cost) and swap
    // as either sign. Both default to "0" — the string, because a `numeric`
    // column is a string in Drizzle and `0` would be a type error.
    commission: decimalString({ precision: 18, scale: 2, label: "Commission" }).default("0"),
    swap: decimalString({ precision: 18, scale: 2, label: "Swap" }).default("0"),

    // Free text, so both need the NUL guard — see `isStorableText`. Postgres
    // cannot encode a NUL byte in a text column and answers 22021, which no
    // amount of parameterisation prevents.
    setupTag: z
      .string()
      .max(40, "Setup tag must be 40 characters or fewer")
      .refine(isStorableText, "Setup tag contains a character that cannot be stored")
      .transform(emptyToNull)
      .nullable(),

    notes: z
      .string()
      .refine(isStorableText, "Notes contain a character that cannot be stored")
      .transform(emptyToNull)
      .nullable(),
  })
  /**
   * Mirrors the `trades_closed_after_opened` CHECK constraint.
   *
   * Both copies earn their place. The database constraint is the one that is
   * *true* — it applies to the importer and to psql as well, so no writer can
   * bypass it. This one exists so the user gets "Close time cannot be before
   * open time" under the right field, instead of a 500 from a constraint
   * violation. Validation for the message; the constraint for the guarantee.
   *
   * String comparison is correct here without parsing: both sides are the same
   * fixed-width `YYYY-MM-DDTHH:mm` shape, which sorts lexicographically in
   * chronological order. And because both are wall-clock times in the *same*
   * account zone, comparing them before conversion gives the same answer as
   * comparing the instants afterwards.
   */
  .refine((value) => value.closedAt >= value.openedAt, {
    message: "Close time cannot be before open time",
    path: ["closedAt"],
  });

export type TradeInput = z.infer<typeof tradeInput>;

/**
 * Editing reuses the create schema and adds the row id.
 *
 * `.extend()` is unavailable on the effect returned by `.refine()`, so the id
 * is added by intersection instead — which keeps the cross-field rule above
 * applying to edits too, rather than quietly dropping it.
 */
export const tradeUpdateInput = z.intersection(
  tradeInput,
  z.object({ id: z.uuid("Not a valid trade id") }),
);

export type TradeUpdateInput = z.infer<typeof tradeUpdateInput>;

export const tradeIdInput = z.object({ id: z.uuid("Not a valid trade id") });
