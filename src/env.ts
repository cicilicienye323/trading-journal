import { z } from "zod";

/**
 * Validated environment variables.
 *
 * Why this file exists: `process.env.FOO` is `string | undefined` everywhere in
 * a plain Next.js app, so a missing variable becomes a runtime crash in
 * production — usually on the one page that reads it. Parsing once at startup
 * turns that into a loud failure at boot with a message naming the variable.
 *
 * Import `env` instead of touching `process.env` directly.
 */
export const serverSchema = z.object({
  // Checks the scheme explicitly rather than using `.url()`. Zod's URL check
  // accepts "localhost:5432" — that parses as a URL whose scheme is
  // "localhost:" — so it would pass a value the Postgres driver rejects, and
  // the failure would surface as a confusing driver error at first query
  // instead of a clear message at boot.
  DATABASE_URL: z
    .string()
    .refine(
      (value) => /^postgres(ql)?:\/\/.+/.test(value),
      "DATABASE_URL must be a full connection string starting with postgres:// or postgresql://",
    ),

  // Signing key for Better Auth session cookies. Rotating it logs everyone out,
  // which is the correct behaviour if it ever leaks.
  BETTER_AUTH_SECRET: z
    .string()
    .min(
      32,
      "BETTER_AUTH_SECRET must be at least 32 characters — generate with `openssl rand -base64 32`",
    ),

  // Absolute base URL Better Auth builds callback links against. Must match the
  // deployed origin exactly or the auth cookie is set on the wrong domain.
  BETTER_AUTH_URL: z.string().url("BETTER_AUTH_URL must be a full URL including scheme"),

  // The read-only demo account. Mutations check against this so a visitor
  // clicking around can't wreck the data a recruiter sees next.
  DEMO_EMAIL: z.string().email("DEMO_EMAIL must be a valid email address"),

  // Optional on purpose: the repo must clone-and-run for someone with no
  // Anthropic account. Features that need it degrade instead of crashing.
  //
  // The preprocess is load-bearing, not defensive. An unset variable and one
  // set to "" are different things to Zod: `.optional()` only covers the first.
  // Docker Compose's `${VAR:-}`, a blank field in the Vercel dashboard, and a
  // CI secret that didn't resolve all produce the second — and without this,
  // every one of them crashes the app at boot instead of disabling the feature.
  ANTHROPIC_API_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof serverSchema>;

/**
 * Parses an environment-shaped object. Exported separately from the module-level
 * `env` so it can be unit-tested without mutating `process.env`.
 *
 * Throws with every failing variable listed, not just the first — fixing one
 * missing variable only to be told about the next is a miserable loop.
 */
export function parseEnv(source: Record<string, unknown>): Env {
  const parsed = serverSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid environment variables:\n${issues}\n\nCopy .env.example to .env.local and fill it in.`,
    );
  }

  return parsed.data;
}

/**
 * During `next build` the app is compiled without a real environment (Vercel
 * runs the build before injecting runtime secrets in some configurations, and
 * CI builds have no database at all). Skipping validation there keeps the build
 * green while still validating on every real server start.
 */
const shouldSkip = process.env.SKIP_ENV_VALIDATION === "true";

export const env: Env = shouldSkip ? (process.env as unknown as Env) : parseEnv(process.env);

/**
 * Whether LLM-backed features should be offered at all.
 *
 * Check this before rendering an entry point that calls the model, so the UI
 * can disable the control with an explanation rather than letting the user
 * click something that will fail.
 */
export const hasAnthropicKey = Boolean(env.ANTHROPIC_API_KEY);
