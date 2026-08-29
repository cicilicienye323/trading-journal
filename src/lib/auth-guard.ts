/**
 * Server-side session helpers.
 *
 * `safeReturnTo` is a pure function and is unit-tested. The two `require*`
 * helpers touch Next request APIs, so they are exercised by actually loading a
 * protected page rather than by a unit test with a mocked framework.
 *
 * ── Where authorization actually lives ──
 * These helpers answer "is anyone signed in?" and nothing else. They are a
 * navigation aid: they send a signed-out visitor somewhere useful instead of
 * showing an empty page. They are NOT the authorization boundary.
 *
 * The boundary is the query predicate (spec §8.3): every read and write is
 * scoped with `eq(table.userId, session.user.id)` in the WHERE clause, so a row
 * belonging to someone else is not found rather than found-then-rejected. Next's
 * own docs make the same point about proxy/middleware — a layout check can be
 * bypassed by anything that reaches the data without rendering that layout,
 * and server actions are exactly that: they are POSTs to the route, not renders
 * of it. So every server action calls `requireSession()` itself.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth, type AppSession } from "@/lib/auth";

/** Where a signed-in user lands when they have no more specific destination. */
export const DEFAULT_SIGNED_IN_PATH = "/dashboard";

/** The query parameter carrying "bring me back here after login". */
export const RETURN_TO_PARAM = "next";

/**
 * Narrows an untrusted `?next=` value to a path we're willing to redirect to.
 *
 * Without this, `/login?next=https://evil.example/phish` sends the user
 * off-site immediately after they authenticate — the classic open redirect, and
 * a genuinely effective phish because the hop happens on a real login.
 *
 * Only a path on this origin is allowed, which means:
 *   - must start with a single "/"
 *   - must NOT start with "//" or "/\", which browsers read as protocol-relative
 *     URLs — "//evil.example" navigates off-site despite looking like a path
 *   - must NOT contain a backslash, since some parsers fold "\" to "/"
 *   - must not be the login or register page itself, or signing in bounces
 *     straight back to the form
 *
 * Anything rejected falls back to the default rather than erroring: a visitor
 * who followed a mangled link should still end up logged in and somewhere sane.
 */
export function safeReturnTo(
  value: string | null | undefined,
  fallback: string = DEFAULT_SIGNED_IN_PATH,
): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.includes("\\")) return fallback;

  // Compare against the path only — "/login?x=1" should be rejected too.
  const path = value.split(/[?#]/)[0];
  if (path === "/login" || path === "/register") return fallback;

  return value;
}

/**
 * Builds the login URL for a visitor who tried to reach `attemptedPath`.
 * Pure, so the round trip is unit-testable without a request.
 */
export function loginUrlFor(attemptedPath: string): string {
  const target = safeReturnTo(attemptedPath, "");
  if (!target) return "/login";
  return `/login?${RETURN_TO_PARAM}=${encodeURIComponent(target)}`;
}

/** The current session, or `null`. Never redirects. */
export async function getSession(): Promise<AppSession> {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * The current session, or a redirect to `/login`.
 *
 * `redirect()` throws, so nothing after this line runs when signed out and the
 * return type is a plain non-null session — callers don't need a null check.
 * Never call it inside a `try` block that swallows errors; it would catch the
 * redirect and render the protected page anyway.
 */
export async function requireSession(
  attemptedPath: string = DEFAULT_SIGNED_IN_PATH,
): Promise<NonNullable<AppSession>> {
  const session = await getSession();
  if (!session) redirect(loginUrlFor(attemptedPath));
  return session;
}
