/**
 * `/trades/new` — manual trade entry (spec §8.1, story T1).
 *
 * Server Component: it loads the user's accounts so the form's account
 * dropdown only offers accounts they own. That is a usability measure, not the
 * security boundary — `createTradeAction` re-resolves the submitted account id
 * through an owner-scoped query, because a `<select>` in a browser is only a
 * suggestion about what will be posted.
 */
import Link from "next/link";

import { requireSession } from "@/lib/auth-guard";
import { listTradingAccounts } from "@/lib/trading-accounts/queries";
import { TradeForm } from "@/components/trades/trade-form";

export const metadata = { title: "New trade" };

export default async function NewTradePage() {
  const { user } = await requireSession();
  const accounts = await listTradingAccounts(user.id);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Record a trade</h1>
        <p className="mt-2 text-sm text-gray-500">
          Times are in your broker&apos;s server timezone, matching what your terminal shows.
        </p>
      </header>

      {/* A trade cannot exist without an account, so this dead end gets a way
          out rather than an empty dropdown that fails on submit. */}
      {accounts.length === 0 ? (
        <p className="text-sm text-gray-500">
          You need a trading account first.{" "}
          <Link href="/accounts" className="underline">
            Add one
          </Link>
          , then come back.
        </p>
      ) : (
        <TradeForm accounts={accounts} />
      )}
    </div>
  );
}
