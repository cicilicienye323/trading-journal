/**
 * Better Auth browser client. The counterpart to `auth.ts`, which is
 * server-only — keep the two straight, because importing `auth.ts` from a
 * Client Component drags the Postgres driver into the browser bundle.
 *
 * No `baseURL` is set on purpose. Left unset, the client calls
 * `/api/auth/...` on whatever origin the page was served from, which is always
 * the right answer: localhost in dev, the deploy URL on a Vercel preview, the
 * production domain in production. Hardcoding one — or reading a
 * NEXT_PUBLIC_ variable, which is baked in at build time and therefore wrong on
 * every preview deploy — is how the client ends up calling the wrong origin and
 * the cookie lands somewhere nobody is browsing.
 */
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
