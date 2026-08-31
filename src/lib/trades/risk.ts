/**
 * Risk amount and R-multiple — spec §5.1 and §5.2.
 *
 * ── Why these are computed here and not in SQL ──
 * `net_profit` is a generated column: Postgres computes it, and application
 * code structurally cannot (see `write-values.ts`). `risk_amount` and
 * `r_multiple` are the opposite — spec §4.3 marks both "computed by the
 * application" — because the formula needs a value that is not in any column:
 * how much money one unit of price movement is worth for this trade.
 *
 * ── The idea worth explaining in an interview ──
 * The naive way to get money-per-price-point is a reference table of contract
 * sizes and pip values per instrument. That table goes stale, and any symbol
 * missing from it fails. Instead we read it off the trade itself: the trade
 * already reports both its realised P&L and the distance price travelled, and
 * the ratio between them *is* money per price point at that volume.
 *
 *     signedMove          = buy ? close - open : open - close
 *     moneyPerPricePoint  = gross_profit / signedMove
 *     risk_amount         = |open - stop_loss| * moneyPerPricePoint
 *     r_multiple          = net_profit / risk_amount
 *
 * No reference data, works for XAUUSD and GBPJPY alike — the two instruments
 * that most often blow up hand-rolled pip maths.
 *
 * ── The limitation, stated rather than hidden ──
 * Deriving from `gross_profit` assumes P&L is linear in price, which holds for
 * FX and CFDs at fixed volume. Commission is a fixed cost that does not scale
 * with the move, yet `net_profit` is the numerator of R. Very small trades are
 * therefore slightly pessimistic. That is a deliberate trade-off: no reference
 * data beats perfect accuracy on micro trades, and it is written in the README.
 *
 * Every number here goes through `lib/money.ts`'s exact decimal arithmetic. In
 * doubles this file would return 80.99999999999774 for a risk of 81.00 — and
 * `no-float-money` in `eslint.config.mjs` was extended to this directory
 * specifically in anticipation of this function.
 */
import {
  absDecimal,
  decimalToString,
  divideDecimals,
  multiplyDecimals,
  subtractDecimals,
  toDecimal,
  addDecimals,
  decimalSign,
  type Decimal,
} from "@/lib/money";
import type { TradeDirection } from "@/db/schema";

/** Scale of `trades.risk_amount` — `numeric(18,2)`. */
const RISK_SCALE = 2;
/** Scale of `trades.r_multiple` — `numeric(10,3)`, so §5.2's "round to 3". */
const R_SCALE = 3;

export type RiskInput = {
  direction: TradeDirection;
  openPrice: string;
  closePrice: string;
  stopLoss: string | null;
  grossProfit: string;
  commission: string;
  swap: string;
};

/**
 * Both fields or neither. Modelling them as a pair rather than two independent
 * nullable strings makes the §5.2 rule "r_multiple is NULL whenever
 * risk_amount is NULL" impossible to violate by forgetting one of them.
 */
export type DerivedRisk =
  { riskAmount: string; rMultiple: string } | { riskAmount: null; rMultiple: null };

const NO_RISK: DerivedRisk = { riskAmount: null, rMultiple: null };

/**
 * Net profit — spec §5.1, and the one formula people get wrong on their first
 * MT statement.
 *
 * MT4/MT5 report commission as a **negative** number because it is a cost. The
 * instinct is to subtract it, which double-counts it and understates every
 * result. It is added.
 *
 * Postgres computes the stored `net_profit` from the same expression as a
 * generated column. This exists for the paths that need the value *before* the
 * row exists — the import preview, and `deriveRisk` below.
 */
export function netProfit(input: Pick<RiskInput, "grossProfit" | "commission" | "swap">): string {
  return decimalToString(netProfitDecimal(input));
}

function netProfitDecimal(input: Pick<RiskInput, "grossProfit" | "commission" | "swap">): Decimal {
  return addDecimals(
    addDecimals(toDecimal(input.grossProfit), toDecimal(input.commission)),
    toDecimal(input.swap),
  );
}

/**
 * The §5.2 edge-case table, in order. Each `null` return is a case where the
 * honest answer is "cannot be derived" rather than a number:
 *
 *  - no stop loss          → there was no defined risk to be a multiple of
 *  - close price == open   → signedMove is 0, and money-per-point is a division
 *                            by it
 *  - gross_profit == 0     → the ratio would be 0 money per point, which would
 *                            make every risk 0. A row that moved in price but
 *                            reports no P&L is inconsistent data; guessing at
 *                            it would put a fabricated R into the statistics
 *  - stop_loss == open     → zero risk is not a meaningful denominator
 *  - risk not positive     → either it rounded away to 0.00, which the column
 *                            cannot express and Slice 3 would divide by, or it
 *                            came out negative, which means `gross_profit` and
 *                            the price move disagree about which way the trade
 *                            went. Same category as the case above: the row
 *                            contradicts itself, so we record no risk rather
 *                            than a number derived from the contradiction
 */
export function deriveRisk(input: RiskInput): DerivedRisk {
  if (input.stopLoss === null) return NO_RISK;

  const open = toDecimal(input.openPrice);
  const close = toDecimal(input.closePrice);
  const stop = toDecimal(input.stopLoss);

  const signedMove =
    input.direction === "buy" ? subtractDecimals(close, open) : subtractDecimals(open, close);
  if (decimalSign(signedMove) === 0) return NO_RISK;

  const gross = toDecimal(input.grossProfit);
  if (decimalSign(gross) === 0) return NO_RISK;

  const stopDistance = absDecimal(subtractDecimals(open, stop));
  if (decimalSign(stopDistance) === 0) return NO_RISK;

  // `|open - stop| * gross / signedMove` as one division rather than computing
  // moneyPerPricePoint first: rounding once at the end instead of twice keeps
  // the result exact to the cent. Written as two steps it drifts by a cent on
  // XAUUSD, which is precisely the kind of error `numeric` was chosen to avoid.
  const risk = divideDecimals(multiplyDecimals(stopDistance, gross), signedMove, RISK_SCALE);
  if (risk === null || decimalSign(risk) !== 1) return NO_RISK;

  // R is computed from the *rounded* risk — the value the column stores — so
  // the R shown next to a risk amount is the one that number produces. Using
  // the unrounded intermediate would make the two disagree in the last digit
  // and leave no way for a reader to check the arithmetic by hand.
  const r = divideDecimals(netProfitDecimal(input), risk, R_SCALE);
  if (r === null) return NO_RISK;

  return { riskAmount: decimalToString(risk), rMultiple: decimalToString(r) };
}
