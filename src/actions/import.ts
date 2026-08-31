"use server";

/**
 * The two steps of a CSV import — spec §6.3.
 *
 * ── Why the file is uploaded twice ──
 * Preview parses and writes nothing; confirm parses **the same file again** and
 * writes. The obvious alternative is to keep the parsed rows between the two
 * steps — in the form state, a session, or a temp table — and it is the wrong
 * one twice over:
 *
 *  - Rows round-tripped through the client are rows the client can edit. A
 *    user could preview a real statement and confirm a different set of trades.
 *    Re-parsing server-side means the only thing the client controls is which
 *    file to send, which is the authority they already have.
 *  - Server-side state between two requests is a lifetime to manage — expiry,
 *    cleanup, a second user's memory on the same instance. Parsing is
 *    deterministic and takes milliseconds for 10 000 rows, so re-doing it costs
 *    less than storing it.
 *
 * The user re-sends the file transparently: the browser still holds the `File`
 * from the first step (see `components/import/import-form.tsx`).
 */
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth-guard";
import { MAX_FILE_BYTES, parseCsv } from "@/lib/import/mt5-csv";
import { buildPreview } from "@/lib/import/preview";
import { findExistingTickets, runImport } from "@/lib/import/queries";
import { toImportWriteValues } from "@/lib/import/write-values";
import { getTradingAccount } from "@/lib/trading-accounts/queries";
import type { ImportState } from "./import-state";

/**
 * Handles both steps. `step=confirm` in the submission is what separates them —
 * a single action keeps one `useActionState` on the page, so the preview and
 * the result cannot both be on screen claiming different things.
 */
export async function importCsvAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const { user } = await requireSession();

  const tradingAccountId = String(formData.get("tradingAccountId") ?? "");
  const account = await getTradingAccount(user.id, tradingAccountId);
  // Scoped lookup, so an account id belonging to someone else is simply not
  // found — no ownership check to forget afterwards (§8.3).
  if (!account) {
    return { fieldErrors: { tradingAccountId: ["Choose one of your trading accounts."] } };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { fieldErrors: { file: ["Choose an MT5 history CSV to import."] } };
  }
  // Checked before `text()` so an oversized upload is refused rather than read
  // into memory first. `parseCsv` checks it again with the real byte count,
  // because the pure function has to be safe on its own terms too.
  if (file.size > MAX_FILE_BYTES) {
    return { error: `file too large: ${(file.size / 1024 / 1024).toFixed(1)} MB (limit 5 MB)` };
  }

  const parsed = parseCsv(await file.text(), { byteSize: file.size });
  // A file-level failure is refused whole and reported as one message. Nothing
  // is imported and nothing is previewed — §6.3, step 2.
  if (!parsed.ok) return { error: parsed.error };

  const target = { id: account.id, serverTimezone: account.serverTimezone };
  const existingTickets = await findExistingTickets(
    user.id,
    account.id,
    parsed.rows.map((row) => row.ticket),
  );

  if (formData.get("step") !== "confirm") {
    return {
      preview: buildPreview({
        filename: file.name,
        account: target,
        accountName: account.name,
        rows: parsed.rows,
        rejected: parsed.rejected,
        totalRows: parsed.totalRows,
        existingTickets,
      }),
    };
  }

  // Every valid row is sent, duplicates included, and the conflict clause
  // decides. Filtering out the tickets the preview already knew about would be
  // the obvious optimisation and it would break the summary: re-importing the
  // same file would send zero rows and report "0 imported, 0 duplicates
  // skipped" instead of "0 imported, 180 duplicates skipped". The count of
  // what was skipped is the thing the user is looking for on a re-import.
  const values = parsed.rows.map((row) => toImportWriteValues(row, target));

  const outcome = await runImport({
    userId: user.id,
    tradingAccountId: account.id,
    filename: file.name,
    rowCount: parsed.totalRows,
    values,
  });

  revalidatePath("/trades");
  revalidatePath("/dashboard");

  // §6.3 step 8 redirects to /trades with a flash message. We stay here and
  // show the summary instead: a redirect would need the counts carried in a
  // query string or a cookie, and the result of an import — how many rows were
  // skipped and why — is exactly the thing the user came to this page to find
  // out. The link to /trades is on the page, one click away.
  return {
    result: {
      inserted: outcome.inserted,
      duplicates: outcome.duplicates,
      rejected: parsed.rejected.length,
      accountName: account.name,
    },
  };
}
