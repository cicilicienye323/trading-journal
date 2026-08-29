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
  // origin actually being served or the session cookie lands on the wrong
  // domain and login fails silently.
  //
  // Optional here because on Vercel it is derived from the platform's own
  // variables (see resolveAuthUrl). Set it explicitly for local development and
  // for custom domains.
  BETTER_AUTH_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().url("BETTER_AUTH_URL must be a full URL including scheme").optional(),
  ),

  // Populated by Vercel. None of them include the protocol scheme.
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  // The branch alias, e.g. my-app-git-main-team.vercel.app. Stable per branch,
  // unlike VERCEL_URL which changes on every push.
  VERCEL_BRANCH_URL: z.string().optional(),

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

type RawEnv = z.infer<typeof serverSchema>;

/** The parsed environment, with `BETTER_AUTH_URL` guaranteed present. */
export type Env = RawEnv & { BETTER_AUTH_URL: string };

/**
 * Works out the origin Better Auth should treat as its base.
 *
 * The problem this solves: you cannot know your Vercel URL until after the
 * first deploy, but the app needs the value to boot. Hardcoding it means the
 * first deploy is guaranteed to be wrong, and the symptom is not an error —
 * it's login appearing to succeed while the session cookie is set on a
 * different domain, so every request afterwards looks logged out.
 *
 * Precedence:
 *   1. An explicit BETTER_AUTH_URL. Required locally, and the only way to use
 *      a custom domain.
 *   2. On a Vercel production deploy, the project's stable production domain —
 *      not the per-deploy URL, which changes on every push.
 *   3. On any other Vercel deploy, that deployment's own URL, so preview
 *      deployments get cookies on the domain they are actually served from.
 *
 * Vercel's variables omit the protocol, hence the https:// prefix. They also
 * require "Enable access to System Environment Variables" to be on in project
 * settings; if it is off, none of them exist and we fall through to the error.
 */
export function resolveAuthUrl(raw: RawEnv): string | undefined {
  if (raw.BETTER_AUTH_URL) return raw.BETTER_AUTH_URL;

  const host =
    raw.VERCEL_ENV === "production"
      ? (raw.VERCEL_PROJECT_PRODUCTION_URL ?? raw.VERCEL_URL)
      : raw.VERCEL_URL;

  return host ? `https://${host}` : undefined;
}

/**
 * Every origin this deployment may legitimately be browsed from.
 *
 * Why this exists, and it cost a round trip to learn: `resolveAuthUrl` picks
 * exactly ONE origin, and Better Auth rejects any request whose `Origin` header
 * doesn't match it — `INVALID_ORIGIN`, surfacing in the UI as "Invalid origin".
 * But a Vercel deployment is reachable at up to three hostnames at once:
 *
 *   VERCEL_PROJECT_PRODUCTION_URL  the stable production alias people visit
 *   VERCEL_BRANCH_URL             the per-branch alias
 *   VERCEL_URL                    this specific deployment, changes every push
 *
 * So if any of those variables is missing at runtime — which is the case unless
 * "Automatically expose System Environment Variables" is on — the single
 * derived origin can easily be a hostname nobody is actually browsing, and
 * every sign-in fails while the page itself renders perfectly.
 *
 * Listing all of them is not a loosening of CSRF protection: these are the
 * hostnames Vercel itself reports for this deployment, not anything an attacker
 * supplies. A wildcard like `*.vercel.app` WOULD be a hole — anyone can deploy
 * there — which is exactly why this enumerates instead.
 */
export function resolveTrustedOrigins(raw: RawEnv): string[] {
  const hosts = [raw.VERCEL_PROJECT_PRODUCTION_URL, raw.VERCEL_BRANCH_URL, raw.VERCEL_URL];

  const origins = hosts
    .filter((host): host is string => Boolean(host))
    // Vercel omits the scheme; a bare host would never match an Origin header.
    .map((host) => (host.includes("://") ? host : `https://${host}`));

  // The explicit/derived base URL last, so it is present even when running
  // somewhere Vercel's variables don't exist at all (local, Docker, Fly).
  const authUrl = resolveAuthUrl(raw);
  if (authUrl) origins.push(authUrl);

  return [...new Set(origins.map((origin) => origin.replace(/\/+$/, "")))];
}

/**
 * Parses an environment-shaped object. Exported separately from the module-level
 * `env` so it can be unit-tested without mutating `process.env`.
 *
 * Throws with every failing variable listed, not just the first — fixing one
 * missing variable only to be told about the next is a miserable loop.
 */
export function parseEnv(source: Record<string, unknown>): Env {
  const parsed = serverSchema.safeParse(source);

  const issues = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);

  // Resolved from the raw source rather than from parsed.data, so that a
  // missing auth URL is reported in the *same* pass as any schema failures.
  // Reporting it only after the schema passes would mean fixing three
  // variables, re-running, and being told about a fourth.
  const authUrl = resolveAuthUrl(source as RawEnv);

  if (!authUrl) {
    issues.push(
      "  - BETTER_AUTH_URL: not set, and no Vercel URL to fall back to. " +
        "Locally use http://localhost:3000. On Vercel it is derived automatically, " +
        'but that needs "Enable access to System Environment Variables" in project settings.',
    );
  }

  if (issues.length > 0) {
    throw new Error(
      `Invalid environment variables:\n${issues.join("\n")}\n\n` +
        "Copy .env.example to .env.local and fill it in.",
    );
  }

  // Safe: issues is empty, so the schema parsed and authUrl resolved.
  return { ...(parsed as { data: RawEnv }).data, BETTER_AUTH_URL: authUrl! };
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
