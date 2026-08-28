/**
 * Generators for realistic-looking demo data.
 *
 * Scope note: this module produces *raw broker-shaped input* — the kind of file
 * a trader would export from MT5 and drop into the app. It deliberately does
 * NOT contain the journal's own analytics (win rate, R multiples, profit
 * factor, equity curve). Those belong to the app and are written by hand.
 *
 * The one number computed here is the per-trade profit in the export, because a
 * broker statement whose Profit column disagrees with its own prices is not a
 * useful fixture to test a parser against.
 */
import { getInstrument, roundToDigits, type Instrument } from "./instruments";
import { createRng, normal, pick, randomInt } from "./random";

export type Direction = "buy" | "sell";

export type GeneratedTrade = {
  ticket: number;
  symbol: string;
  direction: Direction;
  /** Lots. */
  volume: number;
  openTime: Date;
  closeTime: Date;
  openPrice: number;
  closePrice: number;
  stopLoss: number;
  takeProfit: number;
  commission: number;
  swap: number;
  /** Gross profit in account currency (USD), excluding commission and swap. */
  profit: number;
};

const MINUTES = 60 * 1000;

/**
 * The FX market runs from Sunday 22:00 UTC to Friday 22:00 UTC. Generating a
 * trade opened on a Saturday is the kind of detail that makes demo data look
 * fake to anyone who actually trades.
 */
export function isMarketOpen(date: Date): boolean {
  const day = date.getUTCDay();
  const hour = date.getUTCHours();

  if (day === 6) return false; // Saturday
  if (day === 0) return hour >= 22; // Sunday opens 22:00 UTC
  if (day === 5) return hour < 22; // Friday closes 22:00 UTC
  return true;
}

/** Advances a timestamp until it lands inside market hours. */
function nextOpenTime(date: Date): Date {
  const cursor = new Date(date);
  // Step in 30-minute increments; the longest closed stretch is the ~48h
  // weekend, so this terminates well within the guard.
  for (let i = 0; i < 200; i += 1) {
    if (isMarketOpen(cursor)) return cursor;
    cursor.setTime(cursor.getTime() + 30 * MINUTES);
  }
  throw new Error("Could not find an open market slot — check isMarketOpen()");
}

/**
 * Converts a price move into USD profit.
 *
 * Three cases, and they are genuinely different:
 * - Quote currency is USD (EURUSD, XAUUSD): move * contract * volume.
 * - Base currency is USD (USDJPY, USDCHF): the same move is worth less as the
 *   rate rises, so divide by the close price.
 * - Cross pairs (EURJPY, GBPJPY): strictly you need a third rate to convert
 *   JPY into USD. We approximate using the USDJPY reference rate, which is
 *   fine for fixtures and wrong for real accounting.
 */
function profitInUsd(
  instrument: Instrument,
  direction: Direction,
  volume: number,
  openPrice: number,
  closePrice: number,
): number {
  const move = (closePrice - openPrice) * (direction === "buy" ? 1 : -1);
  const notional = move * instrument.contractSize * volume;

  if (instrument.quoteCurrency === "USD") {
    return notional;
  }

  if (instrument.symbol.startsWith("USD")) {
    return notional / closePrice;
  }

  const usdJpy = getInstrument("USDJPY").referencePrice;
  if (instrument.quoteCurrency === "JPY") {
    return notional / usdJpy;
  }

  return notional;
}

export type GenerateTradesOptions = {
  /** Same seed produces the same trades. */
  seed?: number;
  count?: number;
  /** Newest trade closes at this instant, working backwards. */
  endDate?: Date;
  /** How far back the first trade opens. */
  daysOfHistory?: number;
  symbols?: readonly string[];
};

/**
 * Produces a run of trades with a mild positive edge — roughly 55% winners with
 * losers cut shorter than winners. A perfectly random set makes for a boring
 * demo (a flat equity curve and a 1.0 profit factor); a wildly profitable one
 * looks fabricated.
 */
export function generateTrades(options: GenerateTradesOptions = {}): GeneratedTrade[] {
  const {
    seed = 42,
    count = 120,
    endDate = new Date("2026-08-01T00:00:00Z"),
    daysOfHistory = 180,
    symbols = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "AUDUSD", "GBPJPY"],
  } = options;

  const rng = createRng(seed);
  const trades: GeneratedTrade[] = [];
  const startMs = endDate.getTime() - daysOfHistory * 24 * 60 * MINUTES;
  const spacingMs = (endDate.getTime() - startMs) / count;

  for (let i = 0; i < count; i += 1) {
    const symbol = pick(rng, symbols);
    const instrument = getInstrument(symbol);
    const direction: Direction = rng() < 0.5 ? "buy" : "sell";

    // Jitter each trade within its slot so they aren't evenly spaced.
    const openTime = nextOpenTime(new Date(startMs + i * spacingMs + rng() * spacingMs * 0.8));
    const holdMinutes = randomInt(rng, 20, 3 * 24 * 60);
    // A position can't close while the market is shut. One that would land in
    // the weekend gap stays open until Sunday's re-open, which is exactly what
    // happens on a real account.
    const closeTime = nextOpenTime(new Date(openTime.getTime() + holdMinutes * MINUTES));

    // Drift the entry away from the reference price so the series doesn't sit
    // on one number for six months.
    const drift = normal(rng) * instrument.referencePrice * instrument.annualVolatility * 0.3;
    const openPrice = roundToDigits(instrument.referencePrice + drift, instrument.digits);

    // Risk 10-60 pips, target 1.2-3.0R. Losers hit the stop, winners take a
    // partial slice of the target — traders rarely get the full run.
    const stopPips = randomInt(rng, 10, 60);
    const rMultiple = 1.2 + rng() * 1.8;
    const isWinner = rng() < 0.55;

    const stopDistance = stopPips * instrument.pipSize;
    const targetDistance = stopDistance * rMultiple;
    const sign = direction === "buy" ? 1 : -1;

    const stopLoss = roundToDigits(openPrice - sign * stopDistance, instrument.digits);
    const takeProfit = roundToDigits(openPrice + sign * targetDistance, instrument.digits);

    const realised = isWinner
      ? targetDistance * (0.55 + rng() * 0.45)
      : -stopDistance * (0.85 + rng() * 0.15);
    const closePrice = roundToDigits(openPrice + sign * realised, instrument.digits);

    const volume = Math.round((0.05 + rng() * 0.45) * 100) / 100;
    const profit = profitInUsd(instrument, direction, volume, openPrice, closePrice);

    // Brokers charge per side, and swap only applies to overnight positions.
    const commission = -Math.round(volume * 7 * 100) / 100;
    const heldMinutes = (closeTime.getTime() - openTime.getTime()) / MINUTES;
    const heldOvernight = heldMinutes > 12 * 60;
    const swap = heldOvernight ? Math.round((rng() * 6 - 4) * volume * 100) / 100 : 0;

    trades.push({
      ticket: 50_000_000 + i,
      symbol,
      direction,
      volume,
      openTime,
      closeTime,
      openPrice,
      closePrice,
      stopLoss,
      takeProfit,
      commission,
      swap,
      profit: Math.round(profit * 100) / 100,
    });
  }

  return trades.sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
}

/** MT5 renders timestamps as "YYYY.MM.DD HH:MM:SS" in the server's timezone. */
function formatMt5Time(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/**
 * Renders trades as an MT5 "History" CSV export.
 *
 * Column names and order follow the real MT5 export so the import feature is
 * built against the actual shape, not a convenient invented one. Prices are
 * padded to the symbol's digit count because MT5 emits trailing zeros and a
 * naive parser that trims them will disagree with the broker's own file.
 */
export function toMt5Csv(trades: readonly GeneratedTrade[]): string {
  const header = [
    "Time",
    "Position",
    "Symbol",
    "Type",
    "Volume",
    "Price",
    "S / L",
    "T / P",
    "Time",
    "Price",
    "Commission",
    "Swap",
    "Profit",
  ].join(",");

  const rows = trades.map((trade) => {
    const { digits } = getInstrument(trade.symbol);
    const price = (value: number) => value.toFixed(digits);

    return [
      formatMt5Time(trade.openTime),
      trade.ticket,
      trade.symbol,
      trade.direction,
      trade.volume.toFixed(2),
      price(trade.openPrice),
      price(trade.stopLoss),
      price(trade.takeProfit),
      formatMt5Time(trade.closeTime),
      price(trade.closePrice),
      trade.commission.toFixed(2),
      trade.swap.toFixed(2),
      trade.profit.toFixed(2),
    ].join(",");
  });

  return [header, ...rows].join("\n") + "\n";
}
