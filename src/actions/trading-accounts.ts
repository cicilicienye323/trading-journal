"use server";

/**
 * Server actions for `/accounts`.
 *
 * ── Every action calls `requireSession()` itself ──
 * Not because the `(app)` layout's check is wrong, but because it does not run
 * for these. A server action is a POST *to* a route, not a render *of* it, so
 * no layout above it executes. An action that trusted the layout would be
 * callable by anyone who can construct the request — and Next's own docs make
 * this same point about relying on middleware or layouts for authorization.
 *
 * ── Actions stay thin (spec §8.2) ──
 * Validate with Zod → call a scoped query → revalidate. No business logic here:
 * anything worth testing lives in `lib/`, where it can be tested without a
 * database or a request.
 */
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth-guard";
import {
  tradingAccountIdInput,
  tradingAccountInput,
  tradingAccountUpdateInput,
} from "@/lib/schemas/trading-account";
import {
  deleteTradingAccount,
  insertTradingAccount,
  updateTradingAccount,
} from "@/lib/trading-accounts/queries";

import { formDataToObject, toFormState, type FormState } from "./form-state";

export async function createTradingAccountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { user } = await requireSession();

  const parsed = tradingAccountInput.safeParse(formDataToObject(formData));
  if (!parsed.success) return toFormState(parsed.error);

  // The owner comes from the session, never from the form.
  await insertTradingAccount(user.id, parsed.data);

  revalidatePath("/accounts");
  return {};
}

export async function updateTradingAccountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { user } = await requireSession();

  const parsed = tradingAccountUpdateInput.safeParse(formDataToObject(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const { id, ...values } = parsed.data;

  // Scoped in the UPDATE's own WHERE — someone else's id updates zero rows and
  // comes back undefined, rather than being fetched and then checked.
  const updated = await updateTradingAccount(user.id, id, values);
  if (!updated) return { error: "That account no longer exists." };

  revalidatePath("/accounts");
  return {};
}

export async function deleteTradingAccountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { user } = await requireSession();

  const parsed = tradingAccountIdInput.safeParse(formDataToObject(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const removed = await deleteTradingAccount(user.id, parsed.data.id);
  if (!removed) return { error: "That account no longer exists." };

  // The account's trades cascade away with it, so the trade list is stale too.
  revalidatePath("/accounts");
  revalidatePath("/trades");
  return {};
}
