/**
 * The shape every server action in this app returns to `useActionState`.
 *
 * One shape for all of them so the form components can share error rendering
 * instead of each inventing its own convention.
 *
 * Not a `"use server"` file: it exports types and a pure helper, and everything
 * exported from a `"use server"` module must be an async function. Keeping it
 * separate is what lets the actions import it.
 */
// A value import, not `import type`: `z.flattenError` is called below.
import { z } from "zod";

export type FormState = {
  /** Set when the whole submission failed for a reason not tied to one field. */
  error?: string;
  /** Field name → messages, rendered under the matching input. */
  fieldErrors?: Record<string, string[]>;
};

/** The state a form starts in, before anything has been submitted. */
export const emptyFormState: FormState = {};

/**
 * Turns a Zod failure into per-field messages.
 *
 * `flatten()` splits errors into `fieldErrors` (attached to a key) and
 * `formErrors` (cross-field rules that name no single field). Both are
 * surfaced: dropping `formErrors` is how a form ends up silently refusing to
 * submit with nothing shown to the user.
 */
export function toFormState(error: z.ZodError): FormState {
  const flat = z.flattenError(error);
  return {
    error: flat.formErrors[0],
    fieldErrors: flat.fieldErrors as Record<string, string[]>,
  };
}

/**
 * Reads a `FormData` into a plain object for Zod.
 *
 * Every value arrives as a string, which is exactly what the money schemas
 * want — see `lib/money.ts`. Note there is no coercion step here: this is the
 * boundary where a well-meaning `Number(...)` would undo the `numeric`
 * guarantee for the entire application.
 */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") entries[key] = value;
  }
  return entries;
}
