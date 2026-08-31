/**
 * The shape the `/import` page renders — spec §6.3, step 5.
 *
 * Split out of the action so the action stays thin (§8.2) and so the preview
 * can be assembled by a pure function: given parsed rows and the set of tickets
 * the account already holds, this decides what the user is about to see.
 */
import { formatInAccountZone } from "@/lib/trades/time";
import { netProfit } from "@/lib/trades/risk";
import type { ImportRow, RowRejection } from "@/lib/import/mt5-csv";
import type { ImportTarget } from "@/lib/import/write-values";
import { toImportWriteValues } from "@/lib/import/write-values";

/** How many rows §6.3 shows before asking for a decision. */
export const SAMPLE_SIZE = 10;

export type PreviewRow = {
  ticket: string;
  symbol: string;
  direction: string;
  volume: string;
  /** Rendered in the destination account's zone — the point of the preview. */
  openedAt: string;
  closedAt: string;
  netProfit: string;
  rMultiple: string | null;
};

export type ImportPreview = {
  filename: string;
  accountName: string;
  serverTimezone: string;
  totalRows: number;
  /** Rows that parsed and are not already in the account. */
  importable: number;
  duplicateTickets: string[];
  rejected: RowRejection[];
  sample: PreviewRow[];
};

/**
 * @param existingTickets Tickets the account already holds, so they can be
 *                        named as duplicates *before* the user commits rather
 *                        than appearing as an unexplained skip afterwards.
 *
 * The sample deliberately shows converted times and derived values rather than
 * the file's raw text. A preview that echoed the file back would confirm the
 * upload worked; this one lets the user catch the failure that actually
 * matters — an account whose `server_timezone` is wrong, which shows up as
 * every trade sitting two or three hours off the terminal they remember.
 */
export function buildPreview({
  filename,
  account,
  accountName,
  rows,
  rejected,
  totalRows,
  existingTickets,
}: {
  filename: string;
  account: ImportTarget;
  accountName: string;
  rows: ImportRow[];
  rejected: RowRejection[];
  totalRows: number;
  existingTickets: Set<string>;
}): ImportPreview {
  const duplicateTickets = rows
    .map((row) => row.ticket)
    .filter((ticket) => existingTickets.has(ticket));

  const fresh = rows.filter((row) => !existingTickets.has(row.ticket));

  return {
    filename,
    accountName,
    serverTimezone: account.serverTimezone,
    totalRows,
    importable: fresh.length,
    duplicateTickets,
    rejected,
    sample: fresh.slice(0, SAMPLE_SIZE).map((row) => {
      const values = toImportWriteValues(row, account);
      return {
        ticket: row.ticket,
        symbol: row.symbol,
        direction: row.direction,
        volume: row.volume,
        openedAt: formatInAccountZone(values.openedAt as Date, account.serverTimezone),
        closedAt: formatInAccountZone(values.closedAt as Date, account.serverTimezone),
        netProfit: netProfit(row),
        rMultiple: values.rMultiple ?? null,
      };
    }),
  };
}
