import { describe, expect, it } from "vitest";

import { generateTrades, isMarketOpen, toMt5Csv } from "./generate";
import { getInstrument, INSTRUMENTS } from "./instruments";
import { createRng } from "./random";

describe("createRng", () => {
  it("is deterministic for a given seed", () => {
    const a = Array.from({ length: 5 }, createRng(7));
    const b = Array.from({ length: 5 }, createRng(7));
    expect(a).toEqual(b);
  });

  it("produces different streams for different seeds", () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
  });

  it("stays within [0, 1)", () => {
    const rng = createRng(123);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("instruments", () => {
  it("uses a 0.01 pip for JPY-quoted pairs", () => {
    for (const instrument of INSTRUMENTS.filter((i) => i.quoteCurrency === "JPY")) {
      expect(instrument.pipSize).toBe(0.01);
      expect(instrument.digits).toBe(3);
    }
  });

  it("throws on an unknown symbol rather than returning undefined", () => {
    expect(() => getInstrument("NOTAPAIR")).toThrow(/Unknown instrument/);
  });
});

describe("isMarketOpen", () => {
  it("is closed all day Saturday", () => {
    expect(isMarketOpen(new Date("2026-08-01T12:00:00Z"))).toBe(false);
  });

  it("opens Sunday at 22:00 UTC", () => {
    expect(isMarketOpen(new Date("2026-08-02T21:59:00Z"))).toBe(false);
    expect(isMarketOpen(new Date("2026-08-02T22:00:00Z"))).toBe(true);
  });

  it("closes Friday at 22:00 UTC", () => {
    expect(isMarketOpen(new Date("2026-07-31T21:59:00Z"))).toBe(true);
    expect(isMarketOpen(new Date("2026-07-31T22:00:00Z"))).toBe(false);
  });

  it("is open midweek", () => {
    expect(isMarketOpen(new Date("2026-07-29T09:00:00Z"))).toBe(true);
  });
});

describe("generateTrades", () => {
  it("is reproducible for a given seed", () => {
    expect(generateTrades({ seed: 99, count: 20 })).toEqual(
      generateTrades({ seed: 99, count: 20 }),
    );
  });

  it("never opens a trade while the market is closed", () => {
    for (const trade of generateTrades({ count: 200 })) {
      expect(isMarketOpen(trade.openTime)).toBe(true);
    }
  });

  it("always closes after it opens", () => {
    for (const trade of generateTrades({ count: 100 })) {
      expect(trade.closeTime.getTime()).toBeGreaterThan(trade.openTime.getTime());
    }
  });

  it("never closes a trade while the market is closed", () => {
    for (const trade of generateTrades({ count: 200 })) {
      expect(isMarketOpen(trade.closeTime)).toBe(true);
    }
  });

  it("puts the stop on the losing side of entry", () => {
    for (const trade of generateTrades({ count: 100 })) {
      if (trade.direction === "buy") {
        expect(trade.stopLoss).toBeLessThan(trade.openPrice);
        expect(trade.takeProfit).toBeGreaterThan(trade.openPrice);
      } else {
        expect(trade.stopLoss).toBeGreaterThan(trade.openPrice);
        expect(trade.takeProfit).toBeLessThan(trade.openPrice);
      }
    }
  });

  it("keeps the sign of profit consistent with the price move", () => {
    for (const trade of generateTrades({ count: 200 })) {
      const move = (trade.closePrice - trade.openPrice) * (trade.direction === "buy" ? 1 : -1);
      if (move > 0) expect(trade.profit).toBeGreaterThan(0);
      if (move < 0) expect(trade.profit).toBeLessThan(0);
    }
  });

  it("returns trades ordered by open time", () => {
    const trades = generateTrades({ count: 50 });
    const times = trades.map((t) => t.openTime.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("charges swap only on positions held overnight", () => {
    for (const trade of generateTrades({ count: 200 })) {
      const heldMinutes = (trade.closeTime.getTime() - trade.openTime.getTime()) / 60000;
      if (heldMinutes <= 12 * 60) expect(trade.swap).toBe(0);
    }
  });
});

describe("toMt5Csv", () => {
  it("emits a header plus one row per trade", () => {
    const trades = generateTrades({ count: 10 });
    const lines = toMt5Csv(trades).trim().split("\n");
    expect(lines).toHaveLength(11);
    expect(lines[0]).toContain("Symbol");
  });

  it("pads prices to the symbol's quoted precision", () => {
    const trades = generateTrades({ count: 60 });
    const rows = toMt5Csv(trades).trim().split("\n").slice(1);

    for (const row of rows) {
      const cells = row.split(",");
      const { digits } = getInstrument(cells[2]!);
      // Column 5 is the open price.
      expect(cells[5]!.split(".")[1]).toHaveLength(digits);
    }
  });
});
