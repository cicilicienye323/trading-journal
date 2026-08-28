import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

const VALID = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/fintech_dev",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  DEMO_EMAIL: "demo@example.com",
};

describe("parseEnv", () => {
  it("accepts a complete environment", () => {
    expect(parseEnv(VALID).DEMO_EMAIL).toBe("demo@example.com");
  });

  it("defaults NODE_ENV to development", () => {
    expect(parseEnv(VALID).NODE_ENV).toBe("development");
  });

  // Regression: `docker compose` writes `${ANTHROPIC_API_KEY:-}` as an empty
  // string rather than leaving it unset, and a blank field in the Vercel
  // dashboard does the same. Without the preprocess in env.ts, that empty
  // string fails `.min(1)` and crashes the app at boot — which breaks the
  // requirement that the repo runs for someone with no Anthropic key at all.
  it("treats an empty ANTHROPIC_API_KEY as absent, not invalid", () => {
    expect(() => parseEnv({ ...VALID, ANTHROPIC_API_KEY: "" })).not.toThrow();
    expect(parseEnv({ ...VALID, ANTHROPIC_API_KEY: "" }).ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("accepts an omitted ANTHROPIC_API_KEY", () => {
    expect(parseEnv(VALID).ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("keeps a real ANTHROPIC_API_KEY", () => {
    expect(parseEnv({ ...VALID, ANTHROPIC_API_KEY: "sk-ant-xyz" }).ANTHROPIC_API_KEY).toBe(
      "sk-ant-xyz",
    );
  });

  it("rejects a short BETTER_AUTH_SECRET", () => {
    expect(() => parseEnv({ ...VALID, BETTER_AUTH_SECRET: "too-short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  // "localhost:5432" is what someone pastes when they copy a host:port out of
  // a dashboard. Zod's own .url() accepts it (scheme "localhost:"), so this
  // guards a hand-written scheme check, not the library's.
  it.each(["localhost:5432", "mysql://user@host/db", "not a url", ""])(
    "rejects DATABASE_URL %j",
    (value) => {
      expect(() => parseEnv({ ...VALID, DATABASE_URL: value })).toThrow(/DATABASE_URL/);
    },
  );

  it.each([
    "postgres://postgres:postgres@localhost:5432/db",
    "postgresql://user:pw@ep-x-pooler.aws.neon.tech/db?sslmode=require",
  ])("accepts DATABASE_URL %j", (value) => {
    expect(parseEnv({ ...VALID, DATABASE_URL: value }).DATABASE_URL).toBe(value);
  });

  // You cannot know your Vercel URL before the first deploy, so BETTER_AUTH_URL
  // is derived there. Getting this wrong does not raise — login appears to work
  // while the cookie lands on another domain — so each branch is pinned.
  describe("BETTER_AUTH_URL resolution", () => {
    const withoutAuthUrl = { ...VALID, BETTER_AUTH_URL: undefined };

    it("prefers an explicit value over anything Vercel provides", () => {
      const env = parseEnv({
        ...VALID,
        BETTER_AUTH_URL: "https://custom-domain.com",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "ignored.vercel.app",
        VERCEL_URL: "also-ignored.vercel.app",
      });

      expect(env.BETTER_AUTH_URL).toBe("https://custom-domain.com");
    });

    it("uses the stable production domain on a production deploy", () => {
      // Not VERCEL_URL: that is the per-deploy URL and changes on every push,
      // which would invalidate every existing session.
      const env = parseEnv({
        ...withoutAuthUrl,
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "my-app.vercel.app",
        VERCEL_URL: "my-app-abc123.vercel.app",
      });

      expect(env.BETTER_AUTH_URL).toBe("https://my-app.vercel.app");
    });

    it("uses the deployment's own URL on a preview deploy", () => {
      // A preview is served from its own domain, so the cookie has to be set
      // there or the preview is permanently logged out.
      const env = parseEnv({
        ...withoutAuthUrl,
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_PRODUCTION_URL: "my-app.vercel.app",
        VERCEL_URL: "my-app-git-branch.vercel.app",
      });

      expect(env.BETTER_AUTH_URL).toBe("https://my-app-git-branch.vercel.app");
    });

    it("adds the scheme, which Vercel's variables omit", () => {
      const env = parseEnv({ ...withoutAuthUrl, VERCEL_URL: "x.vercel.app" });
      expect(env.BETTER_AUTH_URL).toMatch(/^https:\/\//);
    });

    it("fails loudly when there is nothing to derive from", () => {
      // The case where system environment variables are disabled in project
      // settings: booting with a wrong origin is worse than not booting.
      expect(() => parseEnv(withoutAuthUrl)).toThrow(/BETTER_AUTH_URL/);
    });

    it("treats an empty BETTER_AUTH_URL as absent", () => {
      const env = parseEnv({ ...VALID, BETTER_AUTH_URL: "", VERCEL_URL: "x.vercel.app" });
      expect(env.BETTER_AUTH_URL).toBe("https://x.vercel.app");
    });
  });

  it("reports every missing variable at once, not just the first", () => {
    // Fixing one variable only to be told about the next is a miserable loop.
    try {
      parseEnv({});
      throw new Error("expected parseEnv to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("BETTER_AUTH_SECRET");
      expect(message).toContain("DEMO_EMAIL");
      // Including the derived one. It is resolved outside the schema, so it
      // would be easy to report in a second pass — which is the loop this
      // test exists to prevent.
      expect(message).toContain("BETTER_AUTH_URL");
    }
  });
});
