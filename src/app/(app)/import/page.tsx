/**
 * `/import` — upload an MT5 history export (spec §8.1, stories I1–I4).
 *
 * A Server Component that does nothing but fetch the user's accounts and hand
 * them to the form. The interesting work is in `lib/import/`, which is pure and
 * tested, and in `actions/import.ts`, which is the only part that writes.
 *
 * Batch history (`I5`) is not here. Spec §10 cut it from this slice explicitly,
 * along with a second file format, delimiter auto-detection and custom column
 * mapping — the four things that turn a six-hour importer into a fifteen-hour
 * one. `import_batches` rows are still written, so the audit trail exists for a
 * later slice to render.
 */
import Link from "next/link";

import { ImportForm } from "@/components/import/import-form";
import { requireSession } from "@/lib/auth-guard";
import { listTradingAccounts } from "@/lib/trading-accounts/queries";

export const metadata = { title: "Import trades" };

export default async function ImportPage() {
  // Checked here as well as in the layout: a page must not rely on a parent
  // having done it, and this is where the user id comes from anyway.
  const { user } = await requireSession();
  const accounts = await listTradingAccounts(user.id);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Import trades</h1>
        <p className="mt-2 max-w-2xl text-sm text-gray-500">
          One format: the CSV export of the MT5 <em>History</em> tab. The file is checked and shown
          to you before anything is saved, and importing the same file twice adds nothing —
          positions already in the account are skipped.
        </p>
      </header>

      {accounts.length === 0 ? (
        // The one dead end this page can reach: times in the file are read in
        // the destination account's zone, so there is nothing sensible to
        // import into until an account exists.
        <p className="text-sm text-gray-500">
          You need a trading account first — its server timezone is what the times in the file are
          read as.{" "}
          <Link href="/accounts" className="underline">
            Add an account
          </Link>
          .
        </p>
      ) : (
        <ImportForm accounts={accounts} />
      )}
    </div>
  );
}
