/**
 * What `importCsvAction` returns to `useActionState`.
 *
 * Separate from `import.ts` for the same reason `form-state.ts` is separate
 * from the actions that use it: everything exported from a `"use server"`
 * module has to be an async function, and `emptyImportState` is a value. The
 * types could live there — they are erased — but keeping the shape and its
 * initial value together is what stops the two from drifting.
 */
import type { ImportPreview } from "@/lib/import/preview";
import type { FormState } from "./form-state";

export type ImportResult = {
  inserted: number;
  /** Rows the account already held, refused by the unique index. */
  duplicates: number;
  /** Rows the file itself was wrong about, refused by the parser. */
  rejected: number;
  accountName: string;
};

/**
 * `preview` and `result` are deliberately separate optional fields on one
 * state rather than a discriminated union of two states. The page renders
 * whichever is present, and having both live in the same object is what makes
 * it impossible to show a preview of one file beside the result of another.
 */
export type ImportState = FormState & {
  /** Present after step 1. Nothing has been written to the database. */
  preview?: ImportPreview;
  /** Present after step 2. */
  result?: ImportResult;
};

export const emptyImportState: ImportState = {};
