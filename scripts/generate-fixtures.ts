/**
 * Writes a demo MT5 history export to fixtures/.
 *
 * Run with `npm run fixtures`. The output is committed so tests and demos have
 * a stable file, and regenerating it with the same seed produces no diff.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { generateTrades, toMt5Csv } from "../src/lib/fx/generate";

const outputDir = join(process.cwd(), "fixtures");
mkdirSync(outputDir, { recursive: true });

const trades = generateTrades({ seed: 42, count: 180, daysOfHistory: 240 });
const outputPath = join(outputDir, "mt5-history.csv");

writeFileSync(outputPath, toMt5Csv(trades), "utf8");

const wins = trades.filter((t) => t.profit > 0).length;
console.log(`Wrote ${trades.length} trades to ${outputPath}`);
console.log(`  win rate: ${((wins / trades.length) * 100).toFixed(1)}%`);
console.log(`  symbols:  ${[...new Set(trades.map((t) => t.symbol))].join(", ")}`);
