"use server";

/**
 * Server actions for trade entry, editing and deletion.
 *
 * Each one calls `requireSession()` itself. The `(app)` layout's session check
 * does not cover them: a server action is a POST *to* a route, not a render
 * *of* it, so no layout above it runs. See `actions/trading-accounts.ts` and
 * `lib/auth-guard.ts` for the same note.
 *
 * ── The authorization step that is specific to this file ──
 * A trade carries a `trading_account_id` that came from a `<select>` in the
 * browser, and a `<select>` is only a suggestion — the POST can name any UUID.
 * So before writing, every action here resolves the account through
 * `getTradingAccount(user.id, ...)`, which returns `undefined` for an account
 * the user does not own. That single lookup does double duty: it authorizes the
 * account *and* yields the `server_timezone` the submitted wall-clock times
 * must be interpreted in.
 *
 * Without it, `trades.user_id` would say one thing and `trades.trading_account_id`
 * would point somewhere else — a row filed into another user's account.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth-guard";
import { tradeIdInput, tradeInput, tradeUpdateInput } from "@/lib/schemas/trade";
import { deleteTrade, insertTrade, updateTrade } from "@/lib/trades/queries";
import { toTradeWriteValues } from "@/lib/trades/write-values";
import { getTradingAccount } from "@/lib/trading-accounts/queries";

import { formDataToObject, toFormState, type FormState } from "./form-state";

/** Shown when the submitted account id is not one of this user's. */
const UNKNOWN_ACCOUNT: FormState = {
  fieldErrors: { tradingAccountId: ["Choose one of your trading accounts."] },
};

export async function createTradeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user } = await requireSession();

  const parsed = tradeInput.safeParse(formDataToObject(formData));
  if (!parsed.success) return toFormState(parsed.error);

  // Authorizes the account and supplies its clock in one scoped query.
  const account = await getTradingAccount(user.id, parsed.data.tradingAccountId);
  if (!account) return UNKNOWN_ACCOUNT;

  const trade = await insertTrade(user.id, toTradeWriteValues(parsed.data, account.serverTimezone));
  if (!trade) return { error: "Could not save the trade. Please try again." };

  revalidatePath("/trades");
  // Revalidate before redirecting: `redirect` throws, so nothing after it runs.
  redirect(`/trades/${trade.id}`);
}

export async function updateTradeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user } = await requireSession();

  const parsed = tradeUpdateInput.safeParse(formDataToObject(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const account = await getTradingAccount(user.id, parsed.data.tradingAccountId);
  if (!account) return UNKNOWN_ACCOUNT;

  // Scoped in the UPDATE's own WHERE, so another user's trade matches no rows.
  const updated = await updateTrade(
    user.id,
    parsed.data.id,
    toTradeWriteValues(parsed.data, account.serverTimezone),
  );
  if (!updated) return { error: "That trade no longer exists." };

  revalidatePath("/trades");
  revalidatePath(`/trades/${parsed.data.id}`);
  return {};
}

export async function deleteTradeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user } = await requireSession();

  const parsed = tradeIdInput.safeParse(formDataToObject(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const removed = await deleteTrade(user.id, parsed.data.id);
  if (!removed) return { error: "That trade no longer exists." };

  revalidatePath("/trades");
  redirect("/trades");
}
