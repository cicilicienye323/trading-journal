/**
 * Better Auth server instance. Server-only — importing this from a Client
 * Component pulls the database driver into the browser bundle and the build
 * fails. The browser side is `auth-client.ts`.
 *
 * Everything here is configuration. The authorization *rules* are not: those
 * live in the query predicates (spec §8.3), because a rule you can forget to
 * write is a rule you will eventually forget to write.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/db";
import { account, session, user, verification } from "@/db/auth-schema";
import { env, originOfRequest, resolveTrustedOrigins } from "@/env";

/**
 * Minimum password length, in one place because it is enforced in two: Better
 * Auth rejects short passwords server-side, and the register form checks the
 * same value client-side so the user isn't told only after a round trip.
 *
 * Must stay above `auth` — it is read while `auth` is being constructed, and a
 * `const` declared below would still be in its temporal dead zone at that
 * point, which crashes the module on import rather than at first use.
 */
export const PASSWORD_MIN_LENGTH = 8;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",

    // Passed explicitly rather than letting the adapter fall back to the
    // client's own schema object. The fallback resolves models by export name,
    // so adding an unrelated export called `session` or `account` to
    // `schema.ts` would silently repoint auth at the wrong table. Naming the
    // four tables here means that can't happen.
    schema: { user, session, account, verification },

    // Off by default in the adapter. Sign-up writes a `user` row and an
    // `account` row; without this they are two independent statements, and a
    // failure between them leaves a user who can never log in because their
    // password hash was never stored. Postgres supports transactions, so there
    // is no reason to accept that.
    transaction: true,
  }),

  secret: env.BETTER_AUTH_SECRET,

  // Derived on Vercel from the platform's own variables — see resolveAuthUrl in
  // src/env.ts. Getting this wrong doesn't error: the session cookie is simply
  // set on a domain nobody is browsing, so login "succeeds" and every request
  // afterwards looks logged out.
  baseURL: env.BETTER_AUTH_URL,

  // Better Auth rejects any request whose Origin header doesn't match one of
  // these and answers INVALID_ORIGIN, which the form shows as "Invalid origin".
  //
  // Takes the request so the origin it was actually served on is included.
  // Vercel serves the project on a `<project>-<team>.vercel.app` alias that it
  // publishes in no environment variable, so a list built purely from env vars
  // provably misses the hostname people use. See resolveTrustedOrigins for why
  // trusting the request's own origin is the standard CSRF check rather than a
  // hole, and why a `*.vercel.app` wildcard would be one.
  trustedOrigins: (request) => resolveTrustedOrigins(env, originOfRequest(request)),

  emailAndPassword: {
    enabled: true,

    // Spec §2 A1: "password minimal 8 karakter". This is the server-side floor;
    // the form checks the same number so the user finds out before submitting.
    // Keep the two in sync — see PASSWORD_MIN_LENGTH below, which both import.
    minPasswordLength: PASSWORD_MIN_LENGTH,

    // No mail provider is wired up, and v1 doesn't have one in scope. Left on,
    // every sign-up would land on a "check your email" screen with no email
    // ever sent — the account would be unreachable. Turn this on in the same
    // change that adds a mailer, not before.
    requireEmailVerification: false,

    // A1 again: "setelah daftar langsung login dan masuk ke /dashboard".
    // This is the library default; stated explicitly because the acceptance
    // criterion depends on it.
    autoSignIn: true,
  },

  // Must stay last in the array. It is an after-hook that copies Better Auth's
  // Set-Cookie headers into Next's cookie store; a plugin added after it can
  // set a cookie that never gets written.
  plugins: [nextCookies()],
});

/** What a resolved session looks like. `null` when signed out. */
export type AppSession = Awaited<ReturnType<typeof auth.api.getSession>>;
