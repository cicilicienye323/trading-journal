/**
 * The only part of the importer that touches the database.
 *
 * Everything else in `lib/import/` is pure, which is what lets the golden-number
 * and two-fixture tests run in CI without a Postgres. This file is the seam:
 * rows in, counts out.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { importBatches, trades } from "@/db/schema";
import type { TradeWriteValues } from "@/lib/trades/write-values";

/**
 * Which of these tickets does the account already hold?
 *
 * Scoped by `user_id` as well as by account (spec §8.3) even though the account
 * id alone would be enough here — the rule is that every query carries the
 * owner in its predicate, and an exception "because this one is safe anyway" is
 * how the rule stops being checkable by reading.
 *
 * Read for the *preview* only. It is not what makes the import idempotent: two
 * confirmations racing would both see an empty set. The unique index and
 * `ON CONFLICT DO NOTHING` below are the actual guarantee; this query exists so
 * the user is told what will be skipped before deciding.
 */
export async function findExistingTickets(
  userId: string,
  tradingAccountId: string,
  tickets: string[],
): Promise<Set<string>> {
  if (tickets.length === 0) return new Set();

  const rows = await db
    .select({ ticket: trades.externalTicket })
    .from(trades)
    .where(
      and(
        eq(trades.userId, userId),
        eq(trades.tradingAccountId, tradingAccountId),
        inArray(trades.externalTicket, tickets),
      ),
    );

  return new Set(
    rows.map((row) => row.ticket).filter((ticket): ticket is string => ticket !== null),
  );
}

export type ImportOutcome = {
  batchId: string;
  inserted: number;
  /** Rows we tried to insert that the unique index already had. */
  duplicates: number;
};

/**
 * Inserts a batch and its trades in **one transaction** (spec §6.3, step 7).
 *
 * ── Why the transaction matters here specifically ──
 * Not for the usual reason. The trades are individually harmless; what must not
 * survive a failure is an `import_batches` row claiming an import that did not
 * finish, or a partial set of trades with no batch to explain where they came
 * from. The batch row is the audit trail (§4.4), and an audit trail that can
 * disagree with the data it describes is worse than none.
 *
 * ── Why `ON CONFLICT DO NOTHING` with no conflict target ──
 * The one unique constraint these rows can hit is
 * `trades_account_ticket_uniq`, which is **partial** —
 * `WHERE external_ticket IS NOT NULL`. Naming it as a target means repeating
 * that predicate in the statement so Postgres can infer the index, and every
 * row inserted here has a ticket by construction. A bare DO NOTHING is what
 * §6.3 asks for, and it stays correct if the index is ever changed.
 *
 * That clause is what makes re-importing the same file a no-op instead of 180
 * duplicated trades — and it is the reason the preview's duplicate list is
 * advisory rather than load-bearing.
 *
 * ── Why the insert is chunked ──
 * Postgres allows 65 535 bind parameters per statement. These rows have ~19
 * columns, so a single statement tops out around 3 400 rows while §6.4 permits
 * 10 000. Without chunking the importer would work on every file anyone tested
 * it with and fail on the large ones.
 */
export async function runImport({
  userId,
  tradingAccountId,
  filename,
  rowCount,
  values,
}: {
  userId: string;
  tradingAccountId: string;
  filename: string;
  /** Data rows in the file, including the ones that were rejected (§4.4). */
  rowCount: number;
  values: TradeWriteValues[];
}): Promise<ImportOutcome> {
  return db.transaction(async (tx) => {
    // Counts are written twice: placeholders now so the row satisfies its NOT
    // NULL columns, then the real figures once the inserts have reported back.
    // Both writes are inside the transaction, so no reader ever sees the
    // placeholder values.
    const [batch] = await tx
      .insert(importBatches)
      .values({ userId, tradingAccountId, filename, rowCount, insertedCount: 0, skippedCount: 0 })
      .returning({ id: importBatches.id });

    let inserted = 0;
    for (let start = 0; start < values.length; start += INSERT_CHUNK) {
      const chunk = values.slice(start, start + INSERT_CHUNK);
      const written = await tx
        .insert(trades)
        .values(chunk.map((row) => ({ ...row, userId, importBatchId: batch.id })))
        .onConflictDoNothing()
        // Returning ids is how we learn what the conflict clause actually did.
        // Counting the rows we *sent* would report duplicates as imported.
        .returning({ id: trades.id });
      inserted += written.length;
    }

    await tx
      .update(importBatches)
      .set({ insertedCount: inserted, skippedCount: rowCount - inserted })
      .where(eq(importBatches.id, batch.id));

    return { batchId: batch.id, inserted, duplicates: values.length - inserted };
  });
}

const INSERT_CHUNK = 500;
