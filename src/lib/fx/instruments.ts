/**
 * Reference data for the instruments used across all three projects.
 *
 * This is deliberately static reference data, not a database table: it changes
 * roughly never, and hardcoding it keeps demos working without a seeded DB.
 */

export type Instrument = {
  symbol: string;
  /** Decimal places an MT4/MT5 broker quotes this symbol at. */
  digits: number;
  /** Price movement of one pip. Note this is NOT 10 ** -digits: brokers quote
   *  fractional pips, so a 5-digit EURUSD still has a 0.0001 pip. */
  pipSize: number;
  /** Units of base currency in one standard lot. */
  contractSize: number;
  /** Currency the profit is denominated in before conversion. */
  quoteCurrency: string;
  /** Rough annualised volatility, used only to make generated demo data look
   *  plausible. Not a trading input. */
  annualVolatility: number;
  /** Reference price used as the starting point for generated series. */
  referencePrice: number;
};

export const INSTRUMENTS: readonly Instrument[] = [
  {
    symbol: "EURUSD",
    digits: 5,
    pipSize: 0.0001,
    contractSize: 100_000,
    quoteCurrency: "USD",
    annualVolatility: 0.07,
    referencePrice: 1.085,
  },
  {
    symbol: "GBPUSD",
    digits: 5,
    pipSize: 0.0001,
    contractSize: 100_000,
    quoteCurrency: "USD",
    annualVolatility: 0.085,
    referencePrice: 1.27,
  },
  {
    symbol: "AUDUSD",
    digits: 5,
    pipSize: 0.0001,
    contractSize: 100_000,
    quoteCurrency: "USD",
    annualVolatility: 0.09,
    referencePrice: 0.658,
  },
  {
    symbol: "NZDUSD",
    digits: 5,
    pipSize: 0.0001,
    contractSize: 100_000,
    quoteCurrency: "USD",
    annualVolatility: 0.095,
    referencePrice: 0.61,
  },
  {
    // JPY pairs quote to 3 digits, so the pip is 0.01 rather than 0.0001.
    // Getting this wrong inflates every JPY pip count by 100x — the classic
    // bug in a first trading-journal implementation.
    symbol: "USDJPY",
    digits: 3,
    pipSize: 0.01,
    contractSize: 100_000,
    quoteCurrency: "JPY",
    annualVolatility: 0.09,
    referencePrice: 151.2,
  },
  {
    symbol: "EURJPY",
    digits: 3,
    pipSize: 0.01,
    contractSize: 100_000,
    quoteCurrency: "JPY",
    annualVolatility: 0.088,
    referencePrice: 164.0,
  },
  {
    symbol: "GBPJPY",
    digits: 3,
    pipSize: 0.01,
    contractSize: 100_000,
    quoteCurrency: "JPY",
    annualVolatility: 0.11,
    referencePrice: 192.0,
  },
  {
    symbol: "USDCHF",
    digits: 5,
    pipSize: 0.0001,
    contractSize: 100_000,
    quoteCurrency: "CHF",
    annualVolatility: 0.075,
    referencePrice: 0.882,
  },
  {
    symbol: "USDCAD",
    digits: 5,
    pipSize: 0.0001,
    contractSize: 100_000,
    quoteCurrency: "CAD",
    annualVolatility: 0.07,
    referencePrice: 1.36,
  },
  {
    // Gold is quoted to 2 digits with a 0.1 pip and a 100oz contract — none of
    // the FX defaults apply.
    symbol: "XAUUSD",
    digits: 2,
    pipSize: 0.1,
    contractSize: 100,
    quoteCurrency: "USD",
    annualVolatility: 0.16,
    referencePrice: 2320.0,
  },
];

const BY_SYMBOL = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));

export function getInstrument(symbol: string): Instrument {
  const instrument = BY_SYMBOL.get(symbol.toUpperCase());
  if (!instrument) {
    throw new Error(`Unknown instrument: ${symbol}`);
  }
  return instrument;
}

/** Rounds a price to the broker's quoted precision for that symbol. */
export function roundToDigits(price: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(price * factor) / factor;
}
