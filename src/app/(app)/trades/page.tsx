/**
 * `/trades` — the trade list, filtered from the URL (spec §8.1, story T2).
 *
 * ── Filters live in `searchParams`, never in React state ──
 * `lib/schemas/trade-filters.ts` has the full argument; the short version is
 * that a filtered view should be shareable, bookmarkable, survive a reload, and
 * work with the back button — and a Server Component can read the URL directly,
 * so the correct rows are in the first response with no hydration round trip.
 *
 * ── The URL is untrusted input ──
 * Anyone can type anything into the address bar. `parseTradeFilters` parses
 * every parameter with a fallback rather than an assertion, so `?page=abc`,
 * `?from=not-a-date` and `?symbol[]=1` all render an ordinary page instead of a
 * 500. That behaviour has unit tests, because it is a feature rather than an
 * accident.
 */
import Link from "next/link";

import { requireSession } from "@/lib/auth-guard";
import { formatDecimal } from "@/lib/money";
import {
  parseTradeFilters,
  TRADES_PAGE_SIZE,
  tradeFiltersToQuery,
  type TradeFilters,
} from "@/lib/schemas/trade-filters";
import { listTradedSymbols, listTrades } from "@/lib/trades/queries";
import { formatInAccountZone } from "@/lib/trades/time";
import { listTradingAccounts } from "@/lib/trading-accounts/queries";
import { TradeFiltersForm } from "@/components/trades/trade-filters-form";

export const metadata = { title: "Trades" };

export default async function TradesPage(props: PageProps<"/trades">) {
  const { user } = await requireSession();

  // `searchParams` is a promise in this version of Next — see
  // node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md
  const filters = parseTradeFilters(await props.searchParams);

  const [accounts, symbols] = await Promise.all([
    listTradingAccounts(user.id),
    listTradedSymbols(user.id),
  ]);

  /**
   * Which clock the date filters mean.
   *
   * "Closed from 6 April" is a *broker* calendar day, and brokers differ, so
   * the boundary depends on which account is being looked at. With an account
   * selected we use its zone; otherwise the first account's, which is right for
   * the overwhelmingly common single-account case and predictable otherwise.
   * `accounts` is already owner-scoped, so this cannot read a stranger's zone.
   */
  const filterZone =
    accounts.find((account) => account.id === filters.account)?.serverTimezone ??
    accounts[0]?.serverTimezone ??
    "UTC";

  const { rows, total } = await listTrades(user.id, filters, filterZone);
  const lastPage = Math.max(1, Math.ceil(total / TRADES_PAGE_SIZE));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trades</h1>
          <p className="mt-1 text-sm text-gray-500">
            {total} {total === 1 ? "trade" : "trades"} matching these filters
          </p>
        </div>
        <Link
          href="/trades/new"
          className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-gray-900"
        >
          Record a trade
        </Link>
      </header>

      <TradeFiltersForm filters={filters} accounts={accounts} symbols={symbols} />

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          No trades match.{" "}
          {total === 0 && accounts.length === 0 && "Add an account to get started."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-500 dark:border-gray-800">
              <tr>
                <th className="py-2 pr-4 font-medium">Closed</th>
                <th className="py-2 pr-4 font-medium">Symbol</th>
                <th className="py-2 pr-4 font-medium">Side</th>
                <th className="py-2 pr-4 text-right font-medium">Volume</th>
                <th className="py-2 pr-4 text-right font-medium">Net</th>
                <th className="py-2 pr-4 font-medium">Setup</th>
                <th className="py-2 font-medium">Account</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ trade, account }) => (
                <tr key={trade.id} className="border-b border-gray-100 dark:border-gray-900">
                  <td className="py-2 pr-4">
                    <Link href={`/trades/${trade.id}`} className="underline">
                      {/* Rendered in the broker's zone, not the server's — the
                          same clock the trader's terminal shows. */}
                      {formatInAccountZone(trade.closedAt, account.serverTimezone)}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 font-medium">{trade.symbol}</td>
                  <td className="py-2 pr-4 capitalize">{trade.direction}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatDecimal(trade.volume)}
                  </td>
                  {/* Sign tested on the string, not by parsing — a leading "-"
                      is all "is this a loss?" needs. */}
                  <td
                    className={`py-2 pr-4 text-right tabular-nums ${
                      trade.netProfit.startsWith("-")
                        ? "text-red-600 dark:text-red-400"
                        : "text-green-700 dark:text-green-400"
                    }`}
                  >
                    {formatDecimal(trade.netProfit)}
                  </td>
                  <td className="py-2 pr-4 text-gray-500">{trade.setupTag ?? "—"}</td>
                  <td className="py-2 text-gray-500">{account.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination filters={filters} lastPage={lastPage} />
    </div>
  );
}

/**
 * Previous / next links.
 *
 * Links rather than buttons, because paging is navigation: it changes the URL,
 * so it must be shareable and undoable with the back button like every other
 * filter. Each href carries the current filters forward — dropping them is the
 * classic bug where page 2 silently shows the unfiltered list.
 */
function Pagination({ filters, lastPage }: { filters: TradeFilters; lastPage: number }) {
  if (lastPage <= 1) return null;

  const hrefFor = (page: number) => {
    const query = tradeFiltersToQuery({ ...filters, page });
    return query ? `/trades?${query}` : "/trades";
  };

  return (
    <nav className="flex items-center gap-4 text-sm" aria-label="Pagination">
      {filters.page > 1 ? (
        <Link href={hrefFor(filters.page - 1)} className="underline">
          Previous
        </Link>
      ) : (
        <span className="text-gray-400">Previous</span>
      )}

      <span className="text-gray-500">
        Page {filters.page} of {lastPage}
      </span>

      {filters.page < lastPage ? (
        <Link href={hrefFor(filters.page + 1)} className="underline">
          Next
        </Link>
      ) : (
        <span className="text-gray-400">Next</span>
      )}
    </nav>
  );
}
