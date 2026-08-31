"use client";

/**
 * Upload → preview → confirm (spec §6.3, stories I1–I4).
 *
 * ── Why the selected file lives in React state ──
 * Confirming re-sends the same file to the server (see `actions/import.ts` for
 * why it is re-parsed rather than remembered). A `File` cannot be put in a
 * hidden input, and React resets an uncontrolled form after a form action
 * completes — so the native file input is empty by the time the Confirm button
 * appears. Holding the `File` here is what makes the second step possible at
 * all, and it is also why the chosen filename is rendered from state rather
 * than left to the input to display.
 *
 * ── Why confirm dispatches by hand ──
 * `useActionState`'s dispatch takes a payload directly, so the confirm step
 * builds its own `FormData` with `step=confirm`. One action and one piece of
 * state for both steps means the page cannot show a stale preview next to a
 * fresh result.
 */
import { startTransition, useActionState, useState } from "react";
import Link from "next/link";

import { importCsvAction } from "@/actions/import";
import { emptyImportState, type ImportResult } from "@/actions/import-state";
import { Field, FormError, Select, SubmitButton } from "@/components/ui/field";
import type { TradingAccount } from "@/db/schema";
import { SAMPLE_SIZE, type ImportPreview } from "@/lib/import/preview";
import { formatDecimal } from "@/lib/money";

type AccountOption = Pick<TradingAccount, "id" | "name" | "serverTimezone">;

export function ImportForm({ accounts }: { accounts: AccountOption[] }) {
  const [state, dispatch, pending] = useActionState(importCsvAction, emptyImportState);
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");

  const errors = state.fieldErrors ?? {};
  const account = accounts.find((option) => option.id === accountId);

  function confirm() {
    if (!file) return;
    const payload = new FormData();
    payload.set("tradingAccountId", accountId);
    payload.set("file", file);
    payload.set("step", "confirm");
    startTransition(() => dispatch(payload));
  }

  return (
    <div className="flex flex-col gap-8">
      <form action={dispatch} className="flex max-w-xl flex-col gap-4">
        <Field
          name="tradingAccountId"
          label="Import into"
          hint={
            account
              ? `Times in the file are read as ${account.serverTimezone} — the account's server timezone.`
              : undefined
          }
          errors={errors.tradingAccountId}
        >
          <Select
            name="tradingAccountId"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            required
            errors={errors.tradingAccountId}
          >
            {accounts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          name="file"
          label="MT5 history export (CSV)"
          hint="The History tab of MT5, exported as CSV. Other formats are not accepted."
          errors={errors.file}
        >
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            aria-invalid={errors.file?.length ? true : undefined}
            aria-describedby={errors.file?.length ? "file-error" : undefined}
            className="text-sm"
          />
        </Field>

        {/* Rendered from state because the input itself is cleared when the
            action completes — without this the page would look like the file
            had been forgotten just as it asks for confirmation. */}
        {file && <p className="text-xs text-gray-500">Selected: {file.name}</p>}

        <FormError message={state.error} />

        <div>
          <SubmitButton pending={pending}>Preview import</SubmitButton>
        </div>
      </form>

      {state.preview && !state.result && (
        <Preview preview={state.preview} pending={pending} onConfirm={confirm} />
      )}

      {state.result && <Result result={state.result} />}
    </div>
  );
}

function Preview({
  preview,
  pending,
  onConfirm,
}: {
  preview: ImportPreview;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Preview</h2>
        <p className="mt-1 text-sm text-gray-500">
          Nothing has been saved yet. {preview.filename} → {preview.accountName} (
          {preview.serverTimezone}).
        </p>
      </div>

      <dl className="flex flex-wrap gap-6 text-sm">
        <Stat label="Rows in file" value={preview.totalRows} />
        <Stat label="Ready to import" value={preview.importable} />
        <Stat label="Already imported" value={preview.duplicateTickets.length} />
        <Stat label="Rejected" value={preview.rejected.length} />
      </dl>

      {preview.rejected.length > 0 && (
        <details className="rounded border border-amber-300 p-4 text-sm dark:border-amber-800">
          {/* Every rejected row is listed with its line number. A file from the
              real world is allowed to be dirty (§6.3), but the user has to be
              able to find what was dropped. */}
          <summary className="cursor-pointer font-medium">
            {preview.rejected.length} rows will be skipped
          </summary>
          <ul className="mt-3 flex flex-col gap-1">
            {preview.rejected.map((row) => (
              <li key={row.line} className="text-gray-600 dark:text-gray-400">
                Line {row.line}
                {row.ticket ? ` (position ${row.ticket})` : ""}: {row.errors.join("; ")}
              </li>
            ))}
          </ul>
        </details>
      )}

      {preview.sample.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            First {Math.min(SAMPLE_SIZE, preview.sample.length)} trades, as they will be saved
          </h3>
          {/* Times are shown in the account's zone, converted — not echoed from
              the file. A wrong server_timezone is the failure this preview
              exists to catch, and it is only visible after conversion. */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="py-1 pr-4 font-normal">Position</th>
                  <th className="py-1 pr-4 font-normal">Symbol</th>
                  <th className="py-1 pr-4 font-normal">Opened</th>
                  <th className="py-1 pr-4 font-normal">Closed</th>
                  <th className="py-1 pr-4 font-normal">Net</th>
                  <th className="py-1 font-normal">R</th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((row) => (
                  <tr key={row.ticket} className="border-t border-gray-200 dark:border-gray-800">
                    <td className="py-1 pr-4">{row.ticket}</td>
                    <td className="py-1 pr-4">
                      {row.symbol} {row.direction} {row.volume}
                    </td>
                    <td className="py-1 pr-4 tabular-nums">{row.openedAt}</td>
                    <td className="py-1 pr-4 tabular-nums">{row.closedAt}</td>
                    <td className="py-1 pr-4 tabular-nums">{formatDecimal(row.netProfit)}</td>
                    {/* "—" rather than 0: a trade with no stop loss has no R,
                        which is a different fact from an R of zero (§5.2). */}
                    <td className="py-1 tabular-nums">{row.rMultiple ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-gray-900"
        >
          {pending ? "Importing…" : `Import ${preview.importable} trades`}
        </button>
        <span className="text-sm text-gray-500">
          Or choose a different file above — nothing is saved until you confirm.
        </span>
      </div>
    </section>
  );
}

function Result({ result }: { result: ImportResult }) {
  return (
    <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-800">
      <h2 className="text-lg font-medium">Import finished</h2>
      {/* The §6.3 summary sentence. Re-importing the same file lands here with
          "0 imported, 180 duplicates skipped" — which is how a user confirms
          the importer is idempotent without having to trust that it is. */}
      <p className="text-sm">
        {result.inserted} imported, {result.duplicates} duplicates skipped, {result.rejected} rows
        rejected — into {result.accountName}.
      </p>
      <p className="text-sm">
        <Link href="/trades" className="underline">
          View the trades
        </Link>
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
