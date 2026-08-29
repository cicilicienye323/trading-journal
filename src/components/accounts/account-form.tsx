"use client";

/**
 * Create / edit form for a trading account.
 *
 * One component for both modes, because they differ only in which action they
 * call and whether an `id` is submitted — two files would drift, the same
 * reasoning as `components/auth/credentials-form.tsx`.
 *
 * A Client Component because it uses `useActionState` to render field errors
 * returned by the server. The action itself still runs on the server; only the
 * error rendering is client-side.
 */
import { useActionState } from "react";

import { createTradingAccountAction, updateTradingAccountAction } from "@/actions/trading-accounts";
import { emptyFormState } from "@/actions/form-state";
import type { TradingAccount } from "@/db/schema";
import { Field, FormError, SubmitButton, TextInput } from "@/components/ui/field";

export function AccountForm({ account }: { account?: TradingAccount }) {
  const editing = Boolean(account);

  const [state, formAction, pending] = useActionState(
    editing ? updateTradingAccountAction : createTradingAccountAction,
    emptyFormState,
  );

  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* The server re-checks that this id belongs to the session user; a
          hidden field is a hint, never a permission. */}
      {account && <input type="hidden" name="id" value={account.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Name" errors={errors.name}>
          <TextInput
            name="name"
            defaultValue={account?.name ?? ""}
            placeholder="FTMO Challenge 10K"
            required
            maxLength={80}
            errors={errors.name}
          />
        </Field>

        <Field name="broker" label="Broker" errors={errors.broker}>
          <TextInput
            name="broker"
            defaultValue={account?.broker ?? ""}
            placeholder="Optional"
            maxLength={80}
            errors={errors.broker}
          />
        </Field>

        <Field name="accountNumber" label="Account number" errors={errors.accountNumber}>
          <TextInput
            name="accountNumber"
            defaultValue={account?.accountNumber ?? ""}
            placeholder="Optional"
            maxLength={40}
            errors={errors.accountNumber}
          />
        </Field>

        <Field name="currency" label="Currency" errors={errors.currency}>
          <TextInput
            name="currency"
            defaultValue={account?.currency ?? "USD"}
            maxLength={3}
            required
            errors={errors.currency}
          />
        </Field>

        {/* Text, not number — see DecimalInput in components/ui/field.tsx. */}
        <Field name="startingBalance" label="Starting balance" errors={errors.startingBalance}>
          <TextInput
            name="startingBalance"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={account?.startingBalance ?? "0"}
            required
            errors={errors.startingBalance}
          />
        </Field>

        <Field
          name="serverTimezone"
          label="Broker server timezone"
          hint="IANA name. Most brokers run Europe/Athens (EET)."
          errors={errors.serverTimezone}
        >
          <TextInput
            name="serverTimezone"
            defaultValue={account?.serverTimezone ?? "Europe/Athens"}
            required
            errors={errors.serverTimezone}
          />
        </Field>

        {/* Blank means "no limit", which is stored as NULL — not 0. A zero
            limit would mark the account blown the moment it is created. */}
        <Field
          name="maxDrawdownLimitPct"
          label="Max drawdown limit (%)"
          hint="Leave blank if this is not a prop-firm challenge."
          errors={errors.maxDrawdownLimitPct}
        >
          <TextInput
            name="maxDrawdownLimitPct"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={account?.maxDrawdownLimitPct ?? ""}
            placeholder="10"
            errors={errors.maxDrawdownLimitPct}
          />
        </Field>

        <Field
          name="dailyLossLimitPct"
          label="Daily loss limit (%)"
          hint="Leave blank for no limit."
          errors={errors.dailyLossLimitPct}
        >
          <TextInput
            name="dailyLossLimitPct"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={account?.dailyLossLimitPct ?? ""}
            placeholder="5"
            errors={errors.dailyLossLimitPct}
          />
        </Field>
      </div>

      <FormError message={state.error} />

      <div>
        <SubmitButton pending={pending}>{editing ? "Save changes" : "Add account"}</SubmitButton>
      </div>
    </form>
  );
}
