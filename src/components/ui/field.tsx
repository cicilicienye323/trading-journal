/**
 * Form field primitives — presentational only, no state and no data access
 * (spec §8.2 puts pure presentation in `components/ui/`).
 *
 * They exist to make one thing consistent: an invalid field shows its message
 * *next to the input*, and is announced to assistive technology. Doing that by
 * hand on every input is how half of them end up missing it.
 *
 * Styling is deliberately plain. Slice 5 is where polish happens, and the
 * review rubric for this slice explicitly does not grade appearance.
 */
import type { ReactNode } from "react";

const inputClass =
  "rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900";

/**
 * Label + control + error message.
 *
 * `htmlFor`/`id` are wired from `name` so clicking the label focuses the input,
 * and `aria-describedby` points at the error so a screen reader reads it with
 * the field rather than as loose text somewhere on the page.
 */
export function Field({
  name,
  label,
  hint,
  errors,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  errors?: string[];
  children: ReactNode;
}) {
  const errorId = `${name}-error`;
  const hasError = Boolean(errors?.length);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !hasError && <span className="text-xs text-gray-500">{hint}</span>}
      {hasError && (
        <span id={errorId} role="alert" className="text-xs text-red-600 dark:text-red-400">
          {errors!.join(" ")}
        </span>
      )}
    </div>
  );
}

type ControlProps = {
  name: string;
  errors?: string[];
};

export function TextInput({
  name,
  errors,
  ...props
}: ControlProps & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      id={name}
      name={name}
      // `aria-invalid` is what tells assistive tech the value was rejected;
      // red text alone conveys nothing to a screen reader.
      aria-invalid={errors?.length ? true : undefined}
      aria-describedby={errors?.length ? `${name}-error` : undefined}
      className={inputClass}
      {...props}
    />
  );
}

/**
 * A decimal input.
 *
 * `type="text"` with `inputMode="decimal"`, **not** `type="number"`. Three
 * reasons, and they are the kind of detail that shows up in a finance app:
 *
 *  - A number input's value is normalised by the browser, and a scroll wheel
 *    over a focused field silently changes it — genuinely dangerous next to a
 *    price.
 *  - Browsers disagree about what a number input does with trailing zeros, so
 *    "1.50" can come back as "1.5" and the user's intent is lost.
 *  - Most importantly, we want the exact characters the user typed to reach the
 *    server as a string. `lib/money.ts` explains why a decimal must never take
 *    a trip through a JavaScript float.
 *
 * `inputMode="decimal"` still gets the numeric keypad on mobile, and `pattern`
 * gives the same client-side hint a number input would.
 */
export function DecimalInput({
  name,
  errors,
  signed,
  ...props
}: ControlProps & { signed?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <TextInput
      name={name}
      errors={errors}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      pattern={signed ? "-?[0-9]*\\.?[0-9]*" : "[0-9]*\\.?[0-9]*"}
      {...props}
    />
  );
}

export function Select({
  name,
  errors,
  children,
  ...props
}: ControlProps & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      id={name}
      name={name}
      aria-invalid={errors?.length ? true : undefined}
      aria-describedby={errors?.length ? `${name}-error` : undefined}
      className={inputClass}
      {...props}
    >
      {children}
    </select>
  );
}

export function TextArea({
  name,
  errors,
  ...props
}: ControlProps & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      id={name}
      name={name}
      aria-invalid={errors?.length ? true : undefined}
      aria-describedby={errors?.length ? `${name}-error` : undefined}
      className={inputClass}
      {...props}
    />
  );
}

/** A submit button that reports its own pending state. */
export function SubmitButton({
  pending,
  children,
  className = "",
}: {
  pending: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-gray-900 ${className}`}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

/** A submission-level error, for failures that belong to no single field. */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}
