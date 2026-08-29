/**
 * Every Better Auth endpoint — sign-up, sign-in, sign-out, get-session — is
 * served from this one catch-all route. The `[...all]` segment name is
 * arbitrary; what matters is that the path prefix is `/api/auth`, which is
 * Better Auth's default `basePath`. Move the folder and the client starts
 * calling a 404 with no other symptom than login silently failing.
 *
 * `toNextJsHandler` returns GET and POST already shaped for the App Router, so
 * there is no request/params plumbing to get wrong here.
 */
import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth);
