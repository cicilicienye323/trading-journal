/**
 * `/accounts` — CRUD for trading accounts (spec §8.1, story A4).
 *
 * One page, deliberately: the whole feature is a short list plus a form, and
 * splitting it across `/accounts/new` and `/accounts/[id]/edit` would be three
 * routes to maintain for a page most users visit twice ever.
 *
 * A Server Component. It reads the session and queries directly — no API route,
 * no client-side fetch, no loading state. The only Client Components are the
 * two forms, which need `useActionState` to show field errors.
 */
import { requireSession } from "@/lib/auth-guard";
import { listTradingAccounts } from "@/lib/trading-accounts/queries";
import { deleteTradingAccountAction } from "@/actions/trading-accounts";
import { formatDecimal } from "@/lib/money";
import { AccountForm } from "@/components/accounts/account-form";
import { DeleteButton } from "@/components/ui/delete-button";

export const metadata = { title: "Trading accounts" };

export default async function AccountsPage() {
  // Called here as well as in the layout. A page must not depend on a parent
  // layout having done the check — that assumption is what breaks when the
  // route is later reached some other way. It also gives us the id below.
  const { user } = await requireSession();

  // Scoped by owner inside the query, not filtered afterwards — spec §8.3.
  const accounts = await listTradingAccounts(user.id);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Trading accounts</h1>
        <p className="mt-2 text-sm text-gray-500">
          Every trade belongs to an account. The account&apos;s server timezone decides how the
          times you enter are interpreted.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Add an account</h2>
        <AccountForm />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">
          Your accounts {accounts.length > 0 && `(${accounts.length})`}
        </h2>

        {accounts.length === 0 ? (
          <p className="text-sm text-gray-500">
            No accounts yet. Add one above, then record your first trade.
          </p>
        ) : (
          <ul className="flex flex-col gap-6">
            {accounts.map((account) => (
              <li
                key={account.id}
                className="flex flex-col gap-4 rounded border border-gray-200 p-4 dark:border-gray-800"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h3 className="font-medium">{account.name}</h3>
                    <p className="text-sm text-gray-500">
                      {[account.broker, account.accountNumber].filter(Boolean).join(" · ") ||
                        "No broker details"}
                    </p>
                  </div>
                  <p className="text-sm text-gray-500">
                    {formatDecimal(account.startingBalance)} {account.currency} ·{" "}
                    {account.serverTimezone}
                  </p>
                </div>

                <dl className="flex gap-6 text-sm">
                  <div>
                    <dt className="text-gray-500">Max drawdown</dt>
                    {/* NULL renders as "No limit set", never as 0% — the
                        difference between unknown and zero, per §4.2. */}
                    <dd>
                      {account.maxDrawdownLimitPct
                        ? `${account.maxDrawdownLimitPct}%`
                        : "No limit set"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Daily loss</dt>
                    <dd>
                      {account.dailyLossLimitPct ? `${account.dailyLossLimitPct}%` : "No limit set"}
                    </dd>
                  </div>
                </dl>

                <details>
                  <summary className="cursor-pointer text-sm font-medium">Edit</summary>
                  <div className="mt-4">
                    <AccountForm account={account} />
                  </div>
                </details>

                <div>
                  <DeleteButton
                    action={deleteTradingAccountAction}
                    id={account.id}
                    label="Delete account"
                    confirmMessage={`Delete "${account.name}"? Every trade recorded in it is deleted too. This cannot be undone.`}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
