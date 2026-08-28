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
const serverSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a full postgres:// connection string"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

/**
 * During `next build` the app is compiled without a real environment (Vercel
 * runs the build before injecting runtime secrets in some configurations, and
 * CI builds have no database at all). Skipping validation there keeps the build
 * green while still validating on every real server start.
 */
const shouldSkip = process.env.SKIP_ENV_VALIDATION === "true";

function loadEnv() {
  if (shouldSkip) {
    return process.env as unknown as z.infer<typeof serverSchema>;
  }

  const parsed = serverSchema.safeParse(process.env);

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

export const env = loadEnv();
