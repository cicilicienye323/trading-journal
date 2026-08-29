"use client";

/**
 * Manual trade entry and editing (spec §2 T1, T3).
 *
 * ── What the times in this form mean ──
 * The two `datetime-local` inputs are **broker server time**, not the browser's
 * local time. That is stated in the field hint, because an unlabelled time
 * field in a trading app is genuinely ambiguous and getting it wrong shifts
 * every trade by two or three hours.
 *
 * The conversion happens on the server, in `lib/trades/write-values.ts`, using
 * the selected account's `server_timezone`. It deliberately does not happen
 * here: the browser knows its own zone, which is exactly the zone we do *not*
 * want, and a client-side conversion would also be trivially bypassable.
 *
 * ── Why the money inputs are text ──
 * See `DecimalInput` in `components/ui/field.tsx`. The short version: the exact
 * characters typed must reach the server as a string, because `numeric` columns
 * are exact and JavaScript numbers are not.
 */
import { useActionState } from "react";

import { createTradeAction, updateTradeAction } from "@/actions/trades";
import { emptyFormState } from "@/actions/form-state";
import type { Trade, TradingAccount } from "@/db/schema";
import {
  DecimalInput,
  Field,
  FormError,
  Select,
  SubmitButton,
  TextArea,
  TextInput,
} from "@/components/ui/field";
import { utcToZonedInput } from "@/lib/trades/time";

type AccountOption = Pick<TradingAccount, "id" | "name" | "serverTimezone">;

export function TradeForm({
  accounts,
  trade,
  timeZone,
}: {
  accounts: AccountOption[];
  /** Present when editing. */
  trade?: Trade;
  /** The zone `trade`'s timestamps should be shown in — its account's. */
  timeZone?: string;
}) {
  const editing = Boolean(trade);

  const [state, formAction, pending] = useActionState(
    editing ? updateTradeAction : createTradeAction,
    emptyFormState,
  );

  const errors = state.fieldErrors ?? {};

  // Stored instants are rendered back into the account's zone, so the edit form
  // shows the same broker clock time that was originally typed — not the same
  // instant re-expressed in whatever zone this browser happens to be in.
  const zone = timeZone ?? accounts[0]?.serverTimezone ?? "UTC";
  const openedAt = trade ? utcToZonedInput(trade.openedAt, zone) : "";
  const closedAt = trade ? utcToZonedInput(trade.closedAt, zone) : "";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {trade && <input type="hidden" name="id" value={trade.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="tradingAccountId" label="Account" errors={errors.tradingAccountId}>
          <Select
            name="tradingAccountId"
            defaultValue={trade?.tradingAccountId ?? accounts[0]?.id ?? ""}
            required
            errors={errors.tradingAccountId}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.serverTimezone})
              </option>
            ))}
          </Select>
        </Field>

        <Field name="symbol" label="Symbol" errors={errors.symbol}>
          <TextInput
            name="symbol"
            defaultValue={trade?.symbol ?? ""}
            placeholder="EURUSD"
            required
            maxLength={20}
            // Uppercased again on the server; this is only so the field looks
            // the way it will be stored.
            style={{ textTransform: "uppercase" }}
            errors={errors.symbol}
          />
        </Field>

        <Field name="direction" label="Direction" errors={errors.direction}>
          <Select
            name="direction"
            defaultValue={trade?.direction ?? "buy"}
            required
            errors={errors.direction}
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </Select>
        </Field>

        <Field name="volume" label="Volume (lots)" errors={errors.volume}>
          <DecimalInput
            name="volume"
            defaultValue={trade?.volume ?? ""}
            placeholder="0.10"
            required
            errors={errors.volume}
          />
        </Field>

        <Field
          name="openedAt"
          label="Open time"
          hint={`Broker server time (${zone})`}
          errors={errors.openedAt}
        >
          <TextInput
            name="openedAt"
            type="datetime-local"
            defaultValue={openedAt}
            required
            errors={errors.openedAt}
          />
        </Field>

        <Field
          name="closedAt"
          label="Close time"
          hint={`Broker server time (${zone})`}
          errors={errors.closedAt}
        >
          <TextInput
            name="closedAt"
            type="datetime-local"
            defaultValue={closedAt}
            required
            errors={errors.closedAt}
          />
        </Field>

        <Field name="openPrice" label="Open price" errors={errors.openPrice}>
          <DecimalInput
            name="openPrice"
            defaultValue={trade?.openPrice ?? ""}
            placeholder="1.08453"
            required
            errors={errors.openPrice}
          />
        </Field>

        <Field name="closePrice" label="Close price" errors={errors.closePrice}>
          <DecimalInput
            name="closePrice"
            defaultValue={trade?.closePrice ?? ""}
            placeholder="1.08910"
            required
            errors={errors.closePrice}
          />
        </Field>

        <Field name="stopLoss" label="Stop loss" hint="Optional" errors={errors.stopLoss}>
          <DecimalInput
            name="stopLoss"
            defaultValue={trade?.stopLoss ?? ""}
            errors={errors.stopLoss}
          />
        </Field>

        <Field name="takeProfit" label="Take profit" hint="Optional" errors={errors.takeProfit}>
          <DecimalInput
            name="takeProfit"
            defaultValue={trade?.takeProfit ?? ""}
            errors={errors.takeProfit}
          />
        </Field>

        <Field
          name="grossProfit"
          label="Gross profit"
          hint="Before costs. Negative for a loss."
          errors={errors.grossProfit}
        >
          <DecimalInput
            name="grossProfit"
            signed
            defaultValue={trade?.grossProfit ?? ""}
            placeholder="-45.20"
            required
            errors={errors.grossProfit}
          />
        </Field>

        <Field
          name="commission"
          label="Commission"
          hint="Negative, as MetaTrader writes it."
          errors={errors.commission}
        >
          <DecimalInput
            name="commission"
            signed
            defaultValue={trade?.commission ?? "0"}
            errors={errors.commission}
          />
        </Field>

        <Field name="swap" label="Swap" hint="Either sign." errors={errors.swap}>
          <DecimalInput name="swap" signed defaultValue={trade?.swap ?? "0"} errors={errors.swap} />
        </Field>

        <Field
          name="setupTag"
          label="Setup"
          hint="Optional, e.g. Breakout"
          errors={errors.setupTag}
        >
          <TextInput
            name="setupTag"
            defaultValue={trade?.setupTag ?? ""}
            maxLength={40}
            errors={errors.setupTag}
          />
        </Field>
      </div>

      <Field name="notes" label="Notes" hint="Optional" errors={errors.notes}>
        <TextArea name="notes" defaultValue={trade?.notes ?? ""} rows={3} errors={errors.notes} />
      </Field>

      {/* Net profit is not a field. It is a generated column computed by
          Postgres as gross + commission + swap, so there is nothing here that
          could disagree with it. */}
      <p className="text-xs text-gray-500">
        Net profit is calculated by the database as gross profit + commission + swap.
      </p>

      <FormError message={state.error} />

      <div>
        <SubmitButton pending={pending}>{editing ? "Save changes" : "Save trade"}</SubmitButton>
      </div>
    </form>
  );
}
