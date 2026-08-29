import { describe, expect, it } from "vitest";

import { parseEnv, resolveTrustedOrigins } from "./env";

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

/**
 * These pin the fix for a real production failure: sign-up on the live URL
 * answered "Invalid origin" while the page itself rendered fine. Better Auth
 * compares the browser's Origin header against an exact list, and deriving only
 * one origin from a deployment that answers on three hostnames leaves the one
 * people actually visit off that list.
 */
describe("resolveTrustedOrigins", () => {
  it("trusts the production alias even when the base URL resolved elsewhere", () => {
    // The exact shape of the bug: system env vars are exposed, but VERCEL_ENV
    // is missing, so resolveAuthUrl falls back to the per-deployment VERCEL_URL
    // while the user is browsing the stable production alias.
    const origins = resolveTrustedOrigins({
      VERCEL_URL: "trading-journal-abc123.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "trading-journal-vcien.vercel.app",
    } as never);

    expect(origins).toContain("https://trading-journal-vcien.vercel.app");
    expect(origins).toContain("https://trading-journal-abc123.vercel.app");
  });

  it("covers all three Vercel hostnames plus the resolved base URL", () => {
    const origins = resolveTrustedOrigins({
      VERCEL_ENV: "production",
      VERCEL_URL: "app-abc123.vercel.app",
      VERCEL_BRANCH_URL: "app-git-main.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "app.vercel.app",
    } as never);

    expect(origins.sort()).toEqual([
      "https://app-abc123.vercel.app",
      "https://app-git-main.vercel.app",
      "https://app.vercel.app",
    ]);
  });

  it("adds the scheme Vercel omits", () => {
    const origins = resolveTrustedOrigins({ VERCEL_URL: "x.vercel.app" } as never);
    expect(origins).toEqual(["https://x.vercel.app"]);
  });

  it("works off-Vercel, where none of those variables exist", () => {
    // Local dev, Docker, Fly. Without this the list would be empty and every
    // request would be rejected.
    const origins = resolveTrustedOrigins({ BETTER_AUTH_URL: "http://localhost:3000" } as never);
    expect(origins).toEqual(["http://localhost:3000"]);
  });

  it("does not repeat an origin that is both derived and explicit", () => {
    const origins = resolveTrustedOrigins({
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "app.vercel.app",
      VERCEL_URL: "app.vercel.app",
    } as never);

    expect(origins).toEqual(["https://app.vercel.app"]);
  });

  it("normalises a trailing slash, which would never match an Origin header", () => {
    // Origin headers have no path and no trailing slash, and the comparison is
    // exact — so "https://app.com/" silently matches nothing.
    const origins = resolveTrustedOrigins({ BETTER_AUTH_URL: "https://app.com/" } as never);
    expect(origins).toEqual(["https://app.com"]);
  });

  it("never returns a wildcard", () => {
    // "*.vercel.app" would make sign-in work everywhere — including from any
    // other person's Vercel deployment, which is the CSRF hole this avoids.
    const origins = resolveTrustedOrigins({
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "app.vercel.app",
      VERCEL_URL: "app-abc.vercel.app",
    } as never);

    expect(origins.some((o) => o.includes("*"))).toBe(false);
  });
});
