/**
 * Every database access for `trading_accounts`, in one file.
 *
 * ── Why the queries are collected here ──
 * Spec §8.3 says every read and write is scoped to the signed-in user. A rule
 * like that is only as good as the audit you can run against it, so the queries
 * live in one small module where `grep -n "eq(tradingAccounts.userId" ` returns
 * a line for every one of them. Scattered inline queries in pages and actions
 * would make the same rule unverifiable.
 *
 * ── Why `userId` is the first parameter of every function ──
 * Not a convenience. It means there is no way to *call* these functions without
 * having decided whose data you want — the scoping cannot be forgotten, because
 * it is required to compile. Combined with the predicate being inside `where`,
 * the "unscoped query" mistake has nowhere to happen.
 *
 * These are the exception to the "everything in `lib/` is pure" rule, in the
 * same way spec §8.2 carves out `lib/stats/queries.ts` — the pure helpers next
 * door in `lib/trades/` are the ones with unit tests.
 */
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { tradingAccounts } from "@/db/schema";
import type { TradingAccount } from "@/db/schema";
import type { TradingAccountInput } from "@/lib/schemas/trading-account";

/** All of this user's accounts, oldest first so the list order is stable. */
export function listTradingAccounts(userId: string): Promise<TradingAccount[]> {
  return db
    .select()
    .from(tradingAccounts)
    .where(eq(tradingAccounts.userId, userId))
    .orderBy(asc(tradingAccounts.createdAt));
}

/**
 * One account, **or `undefined`** — which is also the answer when the row
 * exists but belongs to someone else.
 *
 * That equivalence is the entire authorization design. The ownership predicate
 * is `and`-ed into the `where`, so another user's account is *not found* rather
 * than found-and-then-rejected. There is no moment where the row is in memory
 * and a forgotten `if` is all that stands between it and the response.
 */
export function getTradingAccount(userId: string, id: string): Promise<TradingAccount | undefined> {
  return db
    .select()
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.id, id)))
    .limit(1)
    .then((rows) => rows[0]);
}

/**
 * Creates an account owned by `userId`.
 *
 * The owner comes from the session, never from the submitted form — a hidden
 * `userId` field would let anyone create rows under another account by editing
 * the DOM.
 */
export function insertTradingAccount(
  userId: string,
  input: TradingAccountInput,
): Promise<TradingAccount | undefined> {
  return db
    .insert(tradingAccounts)
    .values({ ...input, userId })
    .returning()
    .then((rows) => rows[0]);
}

/**
 * Updates an account in place, scoped by owner.
 *
 * The scoping is in the `where` of the `UPDATE` itself, not a check performed
 * beforehand. A read-then-write would leave a window in which the row could
 * change owner between the two statements, and — more prosaically — it is the
 * shape where someone eventually forgets the check. Here, an id belonging to
 * another user updates zero rows and returns `undefined`.
 */
export function updateTradingAccount(
  userId: string,
  id: string,
  input: TradingAccountInput,
): Promise<TradingAccount | undefined> {
  return db
    .update(tradingAccounts)
    .set(input)
    .where(and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.id, id)))
    .returning()
    .then((rows) => rows[0]);
}

/**
 * Deletes an account, scoped by owner. Returns `false` when nothing matched,
 * which covers both "no such account" and "not yours" — deliberately
 * indistinguishable to the caller.
 *
 * The account's trades go with it via `ON DELETE CASCADE`. That is the intended
 * behaviour and worth stating out loud, because it is destructive: deleting an
 * account the user has been journalling into removes that history. The UI asks
 * for confirmation and says so.
 */
export function deleteTradingAccount(userId: string, id: string): Promise<boolean> {
  return db
    .delete(tradingAccounts)
    .where(and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.id, id)))
    .returning({ id: tradingAccounts.id })
    .then((rows) => rows.length > 0);
}
