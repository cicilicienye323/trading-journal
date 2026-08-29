/**
 * Decimal values that must never become a JavaScript `number`.
 *
 * ── The problem this file exists to prevent ──
 * The schema stores money and prices as Postgres `numeric`, which is exact.
 * That guarantee is only as strong as its weakest link, and the weakest link is
 * almost never the schema — it is the *validation layer*, where this looks
 * completely reasonable:
 *
 *     grossProfit: z.coerce.number()          // ← the leak
 *
 * `z.coerce.number()` calls `Number(value)`. The string "0.1" becomes the
 * double closest to 0.1, which is 0.1000000000000000055511151231257827. Zod
 * hands that to Drizzle, Drizzle stringifies it, and Postgres stores whatever
 * came out. Every guarantee `numeric` was chosen for is gone, silently, and the
 * schema still looks perfect in code review. Sum a few thousand of those and
 * the P&L disagrees with the broker statement by a cent — in a trading journal,
 * that one cent is the whole product.
 *
 * ── The rule ──
 * A decimal value stays a **string** for its entire life: HTML input → Zod →
 * Drizzle → Postgres → back out. It is never parsed, never added, never
 * compared numerically in TypeScript. Arithmetic on it happens in Postgres,
 * where `numeric` is exact — which is exactly why `net_profit` is a generated
 * column in the database rather than a sum written in an action.
 *
 * So the schemas below validate the *shape* of the string and pass the original
 * through untouched. There is deliberately no `parseFloat`, no `Number()`, and
 * no `z.coerce.number()` anywhere in this file or in anything that stores money.
 *
 * ── "Then why not a decimal library?" ──
 * A fair interview follow-up. `decimal.js` or `big.js` would let us do exact
 * arithmetic in TypeScript. We don't need it in v1: every calculation that
 * matters happens in SQL, so adding one would be a dependency, a bundle cost,
 * and a second numeric representation to keep in sync — with nothing asking for
 * it yet. If Slice 3's statistics ever need exact arithmetic *outside* the
 * database, that is the moment to add one, and this is the file it would go in.
 */
import { z } from "zod";

/**
 * Is this decimal string strictly greater than zero?
 *
 * Done on the digits, not by parsing — the whole point of this module is that
 * these strings never become numbers. A value is positive when it has no
 * leading "-" and contains at least one non-zero digit, which correctly makes
 * "0", "0.00" and "-0.00" all non-positive.
 *
 * Assumes an already-validated string (see `decimalString`).
 */
export function isPositiveDecimal(value: string): boolean {
  if (value.startsWith("-")) return false;
  return /[1-9]/.test(value);
}

/**
 * Three-way comparison of two decimal strings: -1, 0, or 1.
 *
 * Exists because the obvious `Number.parseFloat(a) <= 100` is precisely the
 * leak this module forbids — and "it's only a bounds check, not a stored value"
 * is how the rule erodes. A comparison that goes through a float can disagree
 * with Postgres about a value near the boundary, and then the Zod check and the
 * database CHECK constraint enforce subtly different rules. Comparing digits
 * keeps the two in agreement by construction.
 *
 * Assumes both sides already match `decimalPattern` (validated upstream).
 */
export function compareDecimals(a: string, b: string): -1 | 0 | 1 {
  const negA = a.startsWith("-");
  const negB = b.startsWith("-");

  const magA = negA ? a.slice(1) : a;
  const magB = negB ? b.slice(1) : b;

  // Signs are compared *after* zero is ruled out, because "-0.00" and "0" carry
  // different signs but are the same value. Deciding on the sign first would
  // report -0.00 < 0, which Postgres does not agree with.
  if (negA !== negB) {
    if (!isNonZero(magA) && !isNonZero(magB)) return 0;
    return negA ? -1 : 1;
  }

  const magnitude = compareMagnitudes(magA, magB);
  // Among negatives the ordering flips: -5 is less than -2 even though 5 > 2.
  return negA ? ((-magnitude || 0) as -1 | 0 | 1) : magnitude;
}

/** Any non-zero digit means the magnitude is not zero. */
function isNonZero(magnitude: string): boolean {
  return /[1-9]/.test(magnitude);
}

/** Compares two unsigned decimal strings by digits alone. */
function compareMagnitudes(a: string, b: string): -1 | 0 | 1 {
  const [wholeA, fracA = ""] = a.split(".");
  const [wholeB, fracB = ""] = b.split(".");

  // Left-pad the integer parts so a plain string compare is a numeric compare:
  // "99" vs "100" compares wrong lexically, "099" vs "100" compares right.
  const wholeWidth = Math.max(wholeA.length, wholeB.length);
  const leftWhole = wholeA.padStart(wholeWidth, "0");
  const rightWhole = wholeB.padStart(wholeWidth, "0");
  if (leftWhole !== rightWhole) return leftWhole < rightWhole ? -1 : 1;

  // Right-pad the fractions for the same reason: ".5" is ".50", not less
  // than ".49" because it is shorter.
  const fracWidth = Math.max(fracA.length, fracB.length);
  const leftFrac = fracA.padEnd(fracWidth, "0");
  const rightFrac = fracB.padEnd(fracWidth, "0");
  if (leftFrac !== rightFrac) return leftFrac < rightFrac ? -1 : 1;

  return 0;
}

/**
 * Builds the regex for a decimal with at most `scale` fractional digits and at
 * most `precision - scale` integer digits — mirroring Postgres `numeric(p, s)`,
 * so a value this accepts is a value the column accepts.
 *
 * Checking the integer-digit budget here matters: Postgres *rounds* an
 * over-long fraction silently, but it *errors* on an over-long integer part
 * ("numeric field overflow"). Catching it in Zod turns a 500 into a field-level
 * form error next to the input.
 */
function decimalPattern(precision: number, scale: number): RegExp {
  const integerDigits = precision - scale;
  return new RegExp(`^-?\\d{1,${integerDigits}}(\\.\\d{1,${scale}})?$`);
}

type DecimalOptions = {
  /** Total digits, matching the column's `numeric(precision, scale)`. */
  precision: number;
  /** Fractional digits, matching the column. */
  scale: number;
  /** Reject negatives and zero — for volume and prices, which have CHECK > 0. */
  positiveOnly?: boolean;
  /** Field name used in the error message the user reads. */
  label: string;
};

/**
 * A `numeric` column's validator: a string in, the **same string** out.
 *
 * Note the return type is `ZodType<string>` and there is no `.transform(Number)`
 * — that absence is the feature. Read `.trim()` as the only normalization we
 * allow ourselves, because a stray space is a typing artifact rather than data.
 */
export function decimalString({ precision, scale, positiveOnly, label }: DecimalOptions) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine(
      (value) => decimalPattern(precision, scale).test(value),
      `${label} must be a number with at most ${precision - scale} digits before the decimal point and ${scale} after`,
    )
    .refine(
      (value) => !positiveOnly || isPositiveDecimal(value),
      `${label} must be greater than zero`,
    );
}

/**
 * Same, but an empty input means "not provided" rather than "invalid".
 *
 * An untouched `<input>` submits `""`, and for a nullable column that is a
 * legitimate answer — a trade genuinely may have no stop loss. Mapping it to
 * `null` here keeps that distinction intact all the way to the database, where
 * NULL means "unknown" and 0 would mean "zero", which are different facts (the
 * same distinction the nullable prop-firm limits rest on in `schema.ts`).
 */
export function optionalDecimalString(options: DecimalOptions) {
  return z
    .union([z.literal(""), decimalString(options)])
    .transform((value) => (value === "" ? null : value));
}

/**
 * Renders a stored decimal string for display.
 *
 * Still no parsing: `Intl.NumberFormat` would need a `number`, so instead the
 * digit groups are inserted textually. The value shown is therefore always
 * character-for-character what the database holds.
 */
export function formatDecimal(value: string): string {
  const negative = value.startsWith("-");
  const [whole, fraction] = (negative ? value.slice(1) : value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}
