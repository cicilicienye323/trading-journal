/**
 * Validation for `/accounts` — spec §4.2.
 *
 * Lives in `lib/schemas/` because the same schema is the contract in two
 * places: the server action validates against it, and the form's field
 * constraints are derived from it. One definition, so the two cannot disagree.
 */
import { z } from "zod";

import { compareDecimals, decimalString, optionalDecimalString } from "@/lib/money";
import { emptyToNull, isStorableText } from "@/lib/trades/normalize";
import { isValidTimeZone } from "@/lib/trades/time";

/**
 * Trims, then maps a blank input to `null` for a nullable column.
 *
 * The `isStorableText` check rejects NUL bytes, which Postgres cannot encode in
 * a `text` column — a 500 that bind parameters do not prevent. See the note on
 * that function.
 */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} must be ${max} characters or fewer`)
    .refine(isStorableText, `${label} contains a character that cannot be stored`)
    .transform(emptyToNull)
    .nullable();

/**
 * The upper half of the database's `0 < x <= 100` CHECK, as a form error.
 *
 * Compared as digits rather than via `parseFloat`, so this check and the
 * Postgres constraint can never disagree about a boundary value — see
 * `compareDecimals`. `null` passes: an absent limit is not an out-of-range one.
 */
const atMost100 = (value: string | null) => value === null || compareDecimals(value, "100") <= 0;

export const tradingAccountInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(80, "Name must be 80 characters or fewer")
    .refine(isStorableText, "Name contains a character that cannot be stored"),

  broker: optionalText(80, "Broker"),
  accountNumber: optionalText(40, "Account number"),

  // ISO 4217: exactly three letters, stored uppercase so "usd" and "USD" are
  // one currency rather than two. Not validated against the real code list —
  // that list is long, changes, and a wrong-but-well-formed code is a cosmetic
  // problem here, not a correctness one.
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code, e.g. USD"),

  // Money, so a shape-checked string — never `z.coerce.number()`. See lib/money.
  startingBalance: decimalString({
    precision: 18,
    scale: 2,
    label: "Starting balance",
  }),

  /**
   * Checked against the platform's own IANA database rather than a fixed list,
   * because this value decides how every timestamp on the account is
   * interpreted. An invalid zone here would not fail now — it would throw on
   * every date conversion later, far from the typo that caused it.
   */
  serverTimezone: z
    .string()
    .trim()
    .min(1, "Server timezone is required")
    .refine(isValidTimeZone, "Must be an IANA timezone name, e.g. Europe/Athens"),

  /**
   * Prop-firm limits: optional, and a blank field means "no limit" (NULL), not
   * zero. The database CHECK enforces the same 0 < x <= 100 range — this is the
   * copy that produces a readable field error instead of a constraint
   * violation, not the copy that makes the rule true.
   */
  maxDrawdownLimitPct: optionalDecimalString({
    precision: 5,
    scale: 2,
    positiveOnly: true,
    label: "Max drawdown limit",
  }).refine(atMost100, "Max drawdown limit cannot exceed 100%"),

  dailyLossLimitPct: optionalDecimalString({
    precision: 5,
    scale: 2,
    positiveOnly: true,
    label: "Daily loss limit",
  }).refine(atMost100, "Daily loss limit cannot exceed 100%"),
});

export type TradingAccountInput = z.infer<typeof tradingAccountInput>;

/** Editing takes the same fields plus which row to edit. */
export const tradingAccountUpdateInput = tradingAccountInput.extend({
  id: z.uuid("Not a valid account id"),
});

export const tradingAccountIdInput = z.object({
  id: z.uuid("Not a valid account id"),
});
