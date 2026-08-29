"use client";

/**
 * A delete button that confirms first.
 *
 * Shared by accounts and trades because the interaction is identical and the
 * confirmation must not be the thing that gets forgotten on one of them —
 * deleting a trading account cascades to every trade in it.
 *
 * `confirm()` is a browser dialog rather than a styled modal: it is one line,
 * it is accessible by default, and Slice 5 can replace it when the design
 * system exists. Note it only runs in the browser — the button is a real form
 * submission, so the server action is still what enforces ownership. The dialog
 * prevents accidents; it is not a security control.
 */
import { useActionState } from "react";

import { emptyFormState, type FormState } from "@/actions/form-state";
import { FormError } from "@/components/ui/field";

export function DeleteButton({
  action,
  id,
  label = "Delete",
  confirmMessage,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  id: string;
  label?: string;
  confirmMessage: string;
}) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-400"
      >
        {pending ? "Deleting…" : label}
      </button>
      <FormError message={state.error} />
    </form>
  );
}
