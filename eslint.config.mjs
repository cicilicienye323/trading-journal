import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

/**
 * Keeps money out of floating point — mechanically, not by remembering.
 *
 * `src/db/schema.ts` stores money and prices as `numeric`, which is exact. That
 * guarantee is only as strong as the code around it, and the classic way to
 * lose it is one innocuous-looking line in a Zod schema:
 *
 *     grossProfit: z.coerce.number()
 *
 * which runs the value through a double and discards the exactness before it
 * ever reaches Postgres — while still reviewing as perfectly reasonable.
 *
 * This is the same reasoning `lib/auth.ts` applies to authorization: a rule you
 * can forget to write is a rule you will eventually forget to write. So the
 * rule is a lint error in the files that handle stored decimals, rather than a
 * convention in a comment.
 *
 * Scoped to the money paths on purpose. `src/lib/fx/**` is the CSV fixture
 * generator — it produces synthetic test data and never writes to these
 * columns, so float arithmetic is fine there. Page numbers and calendar
 * arithmetic are likewise unaffected.
 *
 * ── Why `lib/trades/**` and `lib/trading-accounts/**` are in the list ──
 * They were not, and the gap was invisible: `parseFloat(input.grossProfit)` in
 * `lib/trades/write-values.ts` — the module that maps every money value onto
 * its column — passed `npm run lint` and all 239 tests. A rule that misses the
 * write path is a rule that only looks like enforcement.
 *
 * This matters most for what lands next, not what is here now. Spec §8.2 puts
 * `deriveRisk()` in `lib/trades/`, and that function divides and multiplies
 * prices to fill `risk_amount` and `r_multiple`. Done in floats on ordinary FX
 * values it yields 80.99999999999774 instead of 81.00, and an r_multiple of
 * 1.000000000000028 — so a break-even trade compares as not equal to 1R, and
 * Slice 3 groups on that. The directory needed the rule before the function
 * arrives, not after.
 *
 * ── And why `lib/import/**` joined them in Slice 2 ──
 * The same gap, one directory over. The CSV importer reads every money and
 * price column in the application out of a text file, and `parseFloat(fields[12])`
 * is the single most natural line to write there — it is how almost every CSV
 * parser tutorial does it. The importer is also the path that will carry the
 * most rows by far: a mistake in a form costs one trade, a mistake here costs
 * every trade in the file.
 */
const noFloatMoney = {
  files: [
    "src/lib/schemas/**/*.ts",
    "src/lib/money.ts",
    "src/lib/import/**/*.ts",
    "src/lib/trades/**/*.ts",
    "src/lib/trading-accounts/**/*.ts",
    "src/actions/**/*.ts",
  ],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        // Matches `z.coerce.number(...)` — and `z.coerce.bigint`/`.date` too,
        // since any coercion of a stored decimal is the same mistake.
        selector:
          "MemberExpression[object.object.name='z'][object.property.name='coerce'][property.name='number']",
        message:
          "z.coerce.number() sends the value through a JS float. Money and prices are `numeric` — use decimalString() from lib/money.ts and keep the value a string.",
      },
      {
        selector: "CallExpression > Identifier[name='parseFloat']",
        message:
          "parseFloat destroys the exactness `numeric` is chosen for. Compare with compareDecimals() from lib/money.ts instead.",
      },
      {
        selector: "MemberExpression[object.name='Number'][property.name='parseFloat']",
        message:
          "Number.parseFloat destroys the exactness `numeric` is chosen for. Compare with compareDecimals() from lib/money.ts instead.",
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  noFloatMoney,
  // Must stay last: turns off every ESLint rule that would fight Prettier.
  // Formatting is Prettier's job, correctness is ESLint's.
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "src/db/migrations/**",
  ]),
]);

export default eslintConfig;
