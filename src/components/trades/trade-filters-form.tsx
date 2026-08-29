/**
 * The filter bar on `/trades`.
 *
 * ── This is a plain `<form method="get">`, and that is the whole point ──
 * There is no `useState`, no `onChange`, no `router.push`, and no `"use client"`
 * — submitting the form *is* the navigation. The browser serialises the fields
 * into the query string and requests `/trades?symbol=EURUSD&direction=buy`, the
 * Server Component reads `searchParams`, and the filtered rows arrive in the
 * first response.
 *
 * That gives us, for free and with no JavaScript at all:
 *   - a shareable, bookmarkable URL for any filtered view;
 *   - a working back button (each filter change is a history entry);
 *   - filters that survive a reload;
 *   - no hydration flash of unfiltered data, because there is no client-side
 *     fetch to wait for.
 *
 * `defaultValue` — not `value` — because these are uncontrolled inputs. React
 * is not managing this state; the URL is. Using `value` without an `onChange`
 * would make the fields read-only, which is the usual symptom of trying to
 * control state that does not belong to the component.
 *
 * The `page` parameter is deliberately *not* a field here: submitting a changed
 * filter should return to page 1, and omitting it does exactly that.
 */
import Link from "next/link";

import type { TradingAccount } from "@/db/schema";
import type { TradeFilters } from "@/lib/schemas/trade-filters";
import { Field, Select, TextInput } from "@/components/ui/field";

export function TradeFiltersForm({
  filters,
  accounts,
  symbols,
}: {
  filters: TradeFilters;
  accounts: Pick<TradingAccount, "id" | "name">[];
  symbols: string[];
}) {
  return (
    <form
      method="get"
      className="flex flex-col gap-4 rounded border border-gray-200 p-4 dark:border-gray-800"
    >
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Field name="account" label="Account">
          <Select name="account" defaultValue={filters.account ?? ""}>
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>

        {/* Only offers symbols the user has actually traded, so no selection
            can produce an empty table for a reason the user can't see. */}
        <Field name="symbol" label="Symbol">
          <Select name="symbol" defaultValue={filters.symbol ?? ""}>
            <option value="">All symbols</option>
            {symbols.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </Select>
        </Field>

        <Field name="direction" label="Direction">
          <Select name="direction" defaultValue={filters.direction ?? ""}>
            <option value="">Both</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </Select>
        </Field>

        <Field name="from" label="Closed from">
          <TextInput name="from" type="date" defaultValue={filters.from ?? ""} />
        </Field>

        <Field name="to" label="Closed to">
          <TextInput name="to" type="date" defaultValue={filters.to ?? ""} />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-gray-900"
        >
          Apply filters
        </button>
        {/* A link, not a reset button: clearing filters means navigating to the
            unfiltered URL, so the address bar and the table stay in agreement. */}
        <Link href="/trades" className="text-sm text-gray-500 underline">
          Clear
        </Link>
      </div>
    </form>
  );
}
