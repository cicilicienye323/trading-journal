/**
 * Risk and R-multiple — the §5.2 edge-case table, one test per row.
 *
 * Each `null` case is a place where a plausible implementation would return a
 * number instead, and every one of those numbers would flow into Slice 3's
 * average as if it were a measurement. A wrong R is worse than a missing one,
 * because a missing one is visible in the coverage figure the dashboard shows.
 */
import { describe, expect, it } from "vitest";

import { deriveRisk, netProfit, type RiskInput } from "./risk";

/**
 * A clean winning EURUSD trade, used as the base for each variation.
 *
 * Chosen so the arithmetic is checkable by hand: price moved +0.00500 for a
 * gross of 250.00, so money per price point is 50 000, and a stop 0.00200 away
 * risks 100.00. Net is 250.00 − 4.00 = 246.00, so R is 2.460.
 */
const WINNER: RiskInput = {
  direction: "buy",
  openPrice: "1.08000",
  closePrice: "1.08500",
  stopLoss: "1.07800",
  grossProfit: "250.00",
  commission: "-4.00",
  swap: "0.00",
};

describe("netProfit", () => {
  it("adds commission rather than subtracting it", () => {
    // The single most common mistake when reading an MT statement: commission
    // arrives negative, so subtracting double-counts the cost. Here the wrong
    // implementation would give 254.00 instead of 246.00.
    expect(netProfit({ grossProfit: "250.00", commission: "-4.00", swap: "0.00" })).toBe("246.00");
  });

  it("keeps a positive swap positive", () => {
    expect(netProfit({ grossProfit: "-33.92", commission: "-1.12", swap: "0.21" })).toBe("-34.83");
  });
});

describe("deriveRisk", () => {
  it("derives risk from the trade itself, with no reference data", () => {
    expect(deriveRisk(WINNER)).toEqual({ riskAmount: "100.00", rMultiple: "2.460" });
  });

  it("gives a losing trade that hit its stop roughly -1R", () => {
    // The sanity check §5.2 offers: a loser stopped out lands just past -1R
    // once commission is counted. If R comes out in the hundreds the pip maths
    // is wrong; near zero and moneyPerPricePoint is inverted.
    expect(
      deriveRisk({
        direction: "buy",
        openPrice: "1.08000",
        closePrice: "1.07800",
        stopLoss: "1.07800",
        grossProfit: "-100.00",
        commission: "-4.00",
        swap: "0.00",
      }),
    ).toEqual({ riskAmount: "100.00", rMultiple: "-1.040" });
  });

  it("works for a sell, where the move is measured the other way", () => {
    // Sign handling: for a sell, price falling is the profitable direction, so
    // signedMove is open - close. Getting this backwards makes every short
    // trade's risk negative — which is why `deriveRisk` refuses a negative one.
    expect(
      deriveRisk({
        direction: "sell",
        openPrice: "1.08500",
        closePrice: "1.08000",
        stopLoss: "1.08700",
        grossProfit: "250.00",
        commission: "-4.00",
        swap: "0.00",
      }),
    ).toEqual({ riskAmount: "100.00", rMultiple: "2.460" });
  });

  it("handles a quote currency that is not USD (GBPJPY) and a metal (XAUUSD)", () => {
    // The two instruments §5.2 names as the ones that break hand-rolled pip
    // tables. Neither needs a contract size here: the ratio comes from the row.
    expect(
      deriveRisk({
        direction: "buy",
        openPrice: "188.500",
        closePrice: "188.900",
        stopLoss: "188.300",
        grossProfit: "260.00",
        commission: "-3.00",
        swap: "-1.20",
      }),
    ).toEqual({ riskAmount: "130.00", rMultiple: "1.968" });

    expect(
      deriveRisk({
        direction: "buy",
        openPrice: "2100.00",
        closePrice: "2110.00",
        stopLoss: "2095.00",
        grossProfit: "100.00",
        commission: "-0.70",
        swap: "0.00",
      }),
    ).toEqual({ riskAmount: "50.00", rMultiple: "1.986" });
  });

  const NOTHING = { riskAmount: null, rMultiple: null };

  it("returns nothing when there is no stop loss", () => {
    expect(deriveRisk({ ...WINNER, stopLoss: null })).toEqual(NOTHING);
  });

  it("returns nothing when the trade closed exactly where it opened", () => {
    expect(deriveRisk({ ...WINNER, closePrice: "1.08000", grossProfit: "0.00" })).toEqual(NOTHING);
  });

  it("returns nothing when the price moved but the profit is zero", () => {
    // Inconsistent data. Deriving from it would give 0 money per price point
    // and therefore a risk of 0 on every such row.
    expect(deriveRisk({ ...WINNER, grossProfit: "0.00" })).toEqual(NOTHING);
  });

  it("returns nothing when the stop is at the open price", () => {
    expect(deriveRisk({ ...WINNER, stopLoss: "1.08000" })).toEqual(NOTHING);
  });

  it("returns nothing when profit and price move disagree about direction", () => {
    // A buy that closed above its open cannot have lost money. Rather than
    // record a negative risk amount, the row is treated as self-contradictory.
    expect(deriveRisk({ ...WINNER, grossProfit: "-250.00" })).toEqual(NOTHING);
  });

  it("returns nothing when the risk would round away to zero", () => {
    // A stop one price tick away on an instrument worth almost nothing per
    // tick. The column holds two decimals; 0.00 there would be a divisor of
    // zero for R, and later for anything Slice 3 computes per unit of risk.
    expect(
      deriveRisk({
        direction: "buy",
        openPrice: "1.08000",
        closePrice: "1.09000",
        stopLoss: "1.07999",
        grossProfit: "0.02",
        commission: "0.00",
        swap: "0.00",
      }),
    ).toEqual(NOTHING);
  });

  it("computes R from the stored, rounded risk", () => {
    // Risk here is 33.333... which the column stores as 33.33. R is then
    // 100.00 / 33.33 = 3.000, not 100.00 / 33.3333 = 3.000 — the assertion
    // that matters is that a reader can divide the two displayed numbers and
    // get the displayed R.
    const result = deriveRisk({
      direction: "buy",
      openPrice: "3.00000",
      closePrice: "6.00000",
      stopLoss: "2.00000",
      grossProfit: "100.00",
      commission: "0.00",
      swap: "0.00",
    });
    expect(result).toEqual({ riskAmount: "33.33", rMultiple: "3.000" });
  });
});
