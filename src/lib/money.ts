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

/**
 * Exposes the `numeric(p, s)` shape check to code outside Zod.
 *
 * The CSV importer has to answer the same question the form schemas ask —
 * "will this string fit the column?" — but about a field in a file rather than
 * a form input, so it needs a predicate rather than a `ZodType`. Sharing the
 * pattern is the point: two hand-written regexes for the same column is how the
 * importer ends up accepting a price the form rejects (or worse, one Postgres
 * silently rounds).
 */
export function fitsDecimalColumn(value: string, precision: number, scale: number): boolean {
  return decimalPattern(precision, scale).test(value);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Exact decimal arithmetic
 *
 * The header of this file says a decimal stays a string and arithmetic happens
 * in Postgres, and that "if Slice 3's statistics ever need exact arithmetic
 * *outside* the database, that is the moment to add one, and this is the file
 * it would go in". Slice 2 is that moment, one slice early.
 *
 * ── What forced it ──
 * `trades.risk_amount` and `trades.r_multiple` are computed by the application,
 * not by the database (spec §4.3), because the formula in §5.2 derives money
 * per price point from the trade itself:
 *
 *     risk_amount = |open_price - stop_loss| * gross_profit / signedMove
 *
 * That is a division and a multiplication on prices, and it happens *before*
 * the INSERT — there is no column to let Postgres compute. Done in doubles on
 * ordinary FX values it produces 80.99999999999774 instead of 81.00 and an
 * r_multiple of 1.000000000000028, so a trade that lost exactly its stop does
 * not compare equal to −1R. Slice 3 then groups and averages those.
 *
 * ── Why BigInt rather than decimal.js or big.js ──
 * The whole requirement is fixed-point add/subtract/multiply/divide with a
 * chosen scale and one rounding rule. `BigInt` is in the language, weighs
 * nothing in the bundle, and cannot silently fall back to a float the way a
 * library's `toNumber()` can. A dependency would also have to be kept in sync
 * with the rounding Postgres actually applies, which is the one behaviour that
 * matters here — so we implement that rule directly and test it.
 *
 * ── The rounding rule ──
 * Half away from zero, which is what Postgres `numeric` does: 0.125 → 0.13 and
 * −0.125 → −0.13. Banker's rounding (JavaScript's `toFixed` is neither) would
 * disagree with the database on exactly the values that land on a boundary, and
 * a journal that disagrees with its own stored numbers is worse than one that
 * is uniformly slightly off.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A fixed-point decimal. The value is `units / 10 ** scale`.
 *
 * Keeping `scale` alongside the digits rather than normalising to a single
 * global scale is what lets "1.50" stay two decimal places through an addition:
 * trailing zeros are information in a price, and the column scales differ
 * (prices are `numeric(18,5)`, money is `numeric(18,2)`).
 */
export type Decimal = { readonly units: bigint; readonly scale: number };

const DECIMAL_SHAPE = /^-?\d+(\.\d+)?$/;

/**
 * Parses a decimal string into exact digits.
 *
 * Throws rather than returning null on malformed input: every caller in this
 * app validates the string first (`decimalString`, `fitsDecimalColumn`, or the
 * CSV row validator), so reaching here with garbage is a programming error, and
 * a silent `null` would propagate as a missing value instead of a stack trace.
 */
export function toDecimal(value: string): Decimal {
  const text = value.trim();
  if (!DECIMAL_SHAPE.test(text)) throw new Error(`not a decimal string: ${JSON.stringify(value)}`);

  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const units = BigInt(whole + fraction);

  // `-0.00` parses to units 0n, which is the same value as `0` — there is no
  // negative zero here, and `decimalToString` therefore never emits one.
  return { units: negative ? -units : units, scale: fraction.length };
}

/** Renders exact digits back to the string form a `numeric` column stores. */
export function decimalToString(value: Decimal): string {
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units).toString().padStart(value.scale + 1, "0");
  const cut = digits.length - value.scale;
  const fraction = value.scale > 0 ? `.${digits.slice(cut)}` : "";
  return `${negative ? "-" : ""}${digits.slice(0, cut)}${fraction}`;
}

/** `0` at the given scale — the starting point for a sum. */
export function zeroDecimal(scale = 0): Decimal {
  return { units: 0n, scale };
}

/** −1, 0 or 1. Used to classify a trade as loss, breakeven or win (§5.3). */
export function decimalSign(value: Decimal): -1 | 0 | 1 {
  if (value.units === 0n) return 0;
  return value.units < 0n ? -1 : 1;
}

export function absDecimal(value: Decimal): Decimal {
  return value.units < 0n ? { units: -value.units, scale: value.scale } : value;
}

export function negateDecimal(value: Decimal): Decimal {
  return { units: -value.units, scale: value.scale };
}

/** Brings both operands to a common scale so their digits line up. */
function align(a: Decimal, b: Decimal): { left: bigint; right: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale);
  return {
    left: a.units * 10n ** BigInt(scale - a.scale),
    right: b.units * 10n ** BigInt(scale - b.scale),
    scale,
  };
}

/** Exact — the result's scale is the wider of the two inputs. */
export function addDecimals(a: Decimal, b: Decimal): Decimal {
  const { left, right, scale } = align(a, b);
  return { units: left + right, scale };
}

/** Exact. */
export function subtractDecimals(a: Decimal, b: Decimal): Decimal {
  const { left, right, scale } = align(a, b);
  return { units: left - right, scale };
}

/** Exact — scales add, as they do on paper. No rounding happens here. */
export function multiplyDecimals(a: Decimal, b: Decimal): Decimal {
  return { units: a.units * b.units, scale: a.scale + b.scale };
}

/** Three-way comparison of two `Decimal`s. */
export function compareDecimalValues(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const { left, right } = align(a, b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** The larger of two values — the running peak of an equity curve (§5.3). */
export function maxDecimal(a: Decimal, b: Decimal): Decimal {
  return compareDecimalValues(a, b) >= 0 ? a : b;
}

/**
 * Division, rounded to `scale`. Returns `null` when the divisor is zero.
 *
 * `null` rather than a thrown error or `Infinity`, because every divisor in
 * this app can legitimately be zero and each case has a defined answer in the
 * spec: a breakeven trade has no R (§5.2), and a set with no losing trades has
 * an undefined profit factor that §5.3 says to render as "—" and explicitly
 * says not to return as 0. A nullable return makes the caller decide, which is
 * what those rules require.
 */
export function divideDecimals(a: Decimal, b: Decimal, scale: number): Decimal | null {
  if (b.units === 0n) return null;

  // a / b at the target scale is (a.units * 10^(scale + b.scale - a.scale)) / b.units.
  // When that exponent is negative the shift belongs on the divisor instead —
  // BigInt has no fractional powers, and moving it keeps everything integral.
  const shift = scale + b.scale - a.scale;
  const numerator = shift >= 0 ? a.units * 10n ** BigInt(shift) : a.units;
  const denominator = shift >= 0 ? b.units : b.units * 10n ** BigInt(-shift);

  return { units: roundedQuotient(numerator, denominator), scale };
}

/** Changes a value's scale, rounding half away from zero when narrowing. */
export function rescaleDecimal(value: Decimal, scale: number): Decimal {
  if (scale === value.scale) return value;
  if (scale > value.scale) {
    return { units: value.units * 10n ** BigInt(scale - value.scale), scale };
  }
  return { units: roundedQuotient(value.units, 10n ** BigInt(value.scale - scale)), scale };
}

/**
 * Integer division rounding half **away from zero**, matching Postgres.
 *
 * Signs are stripped first so there is one rule instead of two: with negatives
 * left in place, `-5n / 2n` truncates toward zero to `-2n` while `5n / 2n`
 * gives `2n`, and "add one if the remainder is at least half" then rounds
 * −2.5 to −2 and 2.5 to 3 — asymmetric, and wrong on exactly the boundary
 * values this function exists to get right.
 */
function roundedQuotient(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;

  const quotient = n / d;
  const rounded = (n % d) * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}
