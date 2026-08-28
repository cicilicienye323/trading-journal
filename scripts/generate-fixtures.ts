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

// The simple case: a broker whose server runs on UTC. Timestamps in this file
// are already the instant they look like.
const utcPath = join(outputDir, "mt5-history.csv");
writeFileSync(utcPath, toMt5Csv(trades), "utf8");

// The realistic case, and the one worth building against. Most retail MT4/MT5
// brokers run their servers on EET/EEST, and the export carries no offset — so
// the same wall-clock string is +02:00 in February and +03:00 in April, with
// nothing in the file marking where it changed.
//
// The same trades render to both files, so importing each into an account with
// the matching server timezone must produce identical stored instants. That is
// the property a timezone conversion has to satisfy, and it cannot be checked
// with a UTC-only fixture.
const eetPath = join(outputDir, "mt5-history-eet.csv");
writeFileSync(eetPath, toMt5Csv(trades, { serverTimezone: "Europe/Athens" }), "utf8");

const wins = trades.filter((t) => t.profit > 0).length;
console.log(`Wrote ${trades.length} trades`);
console.log(`  ${utcPath}   (server timezone: UTC)`);
console.log(`  ${eetPath}   (server timezone: Europe/Athens — crosses a DST boundary)`);
console.log(`  win rate: ${((wins / trades.length) * 100).toFixed(1)}%`);
console.log(`  symbols:  ${[...new Set(trades.map((t) => t.symbol))].join(", ")}`);
