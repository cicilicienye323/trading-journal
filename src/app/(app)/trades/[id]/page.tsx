/**
 * `/trades/[id]` — detail, edit and delete (spec §8.1, story T3).
 *
 * ── The authorization shape to notice here ──
 * `getTrade(user.id, id)` scopes by owner *inside the WHERE clause*, so a trade
 * belonging to someone else comes back `undefined` and this page calls
 * `notFound()`. There is no branch that reads the row and then decides — the
 * row is never fetched in the first place.
 *
 * That matters beyond tidiness: "not found" and "not yours" are deliberately
 * the same response. Answering 403 for someone else's id would confirm the
 * trade exists, which is an information leak even when the data stays hidden.
 *
 * ── Why the id is shape-checked before it reaches the query ──
 * `trades.id` is a `uuid` column, so comparing it against `"abc"` makes
 * Postgres raise "invalid input syntax for type uuid" — a 500, from a URL any
 * visitor can type. The parameterised query keeps that safe from injection, but
 * safe is not the same as graceful. Validating the shape first turns
 * `/trades/abc` into an ordinary 404, which is what it should have been: this
 * is the same "the URL is untrusted input" rule the filters on `/trades`
 * follow.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { deleteTradeAction } from "@/actions/trades";
import { requireSession } from "@/lib/auth-guard";
import { formatDecimal } from "@/lib/money";
import { getTrade } from "@/lib/trades/queries";
import { formatInAccountZone } from "@/lib/trades/time";
import { listTradingAccounts } from "@/lib/trading-accounts/queries";
import { TradeForm } from "@/components/trades/trade-form";
import { DeleteButton } from "@/components/ui/delete-button";

export const metadata = { title: "Trade" };

export default async function TradeDetailPage(props: PageProps<"/trades/[id]">) {
  const { user } = await requireSession();
  const { id } = await props.params;

  // A non-UUID id can never match a row, so answer 404 without troubling the
  // database — and without letting Postgres turn a typo into a 500.
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) notFound();

  const result = await getTrade(user.id, parsedId.data);
  // Covers "no such trade" and "not this user's trade" identically.
  if (!result) notFound();

  const { trade, account } = result;
  const accounts = await listTradingAccounts(user.id);

  const zone = account.serverTimezone;
  const isLoss = trade.netProfit.startsWith("-");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {trade.symbol} <span className="text-gray-500 capitalize">{trade.direction}</span>
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {account.name} · {formatInAccountZone(trade.closedAt, zone)} ({zone})
          </p>
        </div>
        <Link href="/trades" className="text-sm underline">
          Back to trades
        </Link>
      </header>

      {/* A `dl`, not a `section` — `dt`/`dd` are only valid inside one, and the
          content genuinely is a list of label/value pairs. */}
      <dl className="grid gap-4 rounded border border-gray-200 p-4 text-sm sm:grid-cols-3 dark:border-gray-800">
        <Detail label="Opened">{formatInAccountZone(trade.openedAt, zone)}</Detail>
        <Detail label="Closed">{formatInAccountZone(trade.closedAt, zone)}</Detail>
        <Detail label="Volume">{formatDecimal(trade.volume)} lots</Detail>

        <Detail label="Open price">{formatDecimal(trade.openPrice)}</Detail>
        <Detail label="Close price">{formatDecimal(trade.closePrice)}</Detail>
        <Detail label="Stop loss">
          {trade.stopLoss ? formatDecimal(trade.stopLoss) : "Not set"}
        </Detail>

        <Detail label="Gross profit">{formatDecimal(trade.grossProfit)}</Detail>
        <Detail label="Commission">{formatDecimal(trade.commission)}</Detail>
        <Detail label="Swap">{formatDecimal(trade.swap)}</Detail>

        {/* Read straight from the generated column. Nothing in TypeScript adds
            these three numbers up — Postgres does, exactly. */}
        <Detail label="Net profit">
          <span
            className={
              isLoss ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"
            }
          >
            {formatDecimal(trade.netProfit)} {account.currency}
          </span>
        </Detail>
        <Detail label="Setup">{trade.setupTag ?? "—"}</Detail>
        <Detail label="Source" className="capitalize">
          {trade.source}
        </Detail>
      </dl>

      {trade.notes && (
        <section>
          <h2 className="text-lg font-medium">Notes</h2>
          {/* `whitespace-pre-wrap` keeps the user's line breaks; rendering as
              text (never dangerouslySetInnerHTML) is what keeps notes from
              becoming a stored-XSS vector. */}
          <p className="mt-2 text-sm whitespace-pre-wrap text-gray-600 dark:text-gray-400">
            {trade.notes}
          </p>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Edit</h2>
        <TradeForm accounts={accounts} trade={trade} timeZone={zone} />
      </section>

      <section className="flex flex-col gap-2 border-t border-gray-200 pt-6 dark:border-gray-800">
        <h2 className="text-lg font-medium">Danger zone</h2>
        <div>
          <DeleteButton
            action={deleteTradeAction}
            id={trade.id}
            label="Delete trade"
            confirmMessage={`Delete this ${trade.symbol} trade? This cannot be undone.`}
          />
        </div>
      </section>
    </div>
  );
}

function Detail({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className={`tabular-nums ${className}`}>{children}</dd>
    </div>
  );
}
