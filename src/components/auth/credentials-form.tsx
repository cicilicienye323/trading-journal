"use client";

/**
 * The login and register forms. Deliberately plain — Slice 5 is where polish
 * happens, and spending styling time here steals from it.
 *
 * Both modes are one component because they differ in exactly three things:
 * which Better Auth call to make, whether a name field is shown, and the
 * wording. Two near-identical files would drift.
 *
 * This is a Client Component rather than a server action + `useActionState`,
 * which is what the Next docs reach for by default. The reason: Better Auth's
 * sign-in sets the session cookie through its own HTTP endpoint, so the browser
 * client is the path the library actually supports. `nextCookies()` covers the
 * server-action path if a later slice needs it.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { signIn, signUp } from "@/lib/auth-client";

type Mode = "login" | "register";

/**
 * Mirrors `PASSWORD_MIN_LENGTH` in `lib/auth.ts`. Not imported from there:
 * that module is server-only, and importing it here would pull the database
 * driver into the browser bundle. Kept honest by a test that asserts the two
 * numbers match.
 */
export const CLIENT_PASSWORD_MIN_LENGTH = 8;

/**
 * Turns a Better Auth error into something a person can act on.
 *
 * The raw messages are serviceable but generic; these are the three cases a
 * user actually hits. Anything unmapped falls through to the library's own
 * message rather than a swallowed "something went wrong", so an unexpected
 * failure stays diagnosable.
 */
export function messageForError(
  code: string | undefined,
  fallback: string | undefined,
  mode: Mode,
): string {
  switch (code) {
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "That email is already registered. Try signing in instead.";
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
    case "USER_NOT_FOUND":
      // One message for all three on purpose: saying "no such user" tells an
      // attacker which emails are registered.
      return "Wrong email or password.";
    case "PASSWORD_TOO_SHORT":
      return `Password must be at least ${CLIENT_PASSWORD_MIN_LENGTH} characters.`;
    default:
      return (
        fallback ?? (mode === "login" ? "Could not sign in." : "Could not create the account.")
      );
  }
}

export function CredentialsForm({ mode, returnTo }: { mode: Mode; returnTo: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isRegister = mode === "register";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    const name = String(data.get("name") ?? "").trim();

    const result = isRegister
      ? await signUp.email({ email, password, name: name || email })
      : await signIn.email({ email, password });

    if (result.error) {
      setError(messageForError(result.error.code, result.error.message, mode));
      setPending(false);
      return;
    }

    // `refresh()` before `push()` matters. The protected layout reads the
    // session on the server; without dropping the client's cached RSC payload
    // first, the navigation can render against a tree fetched while signed out
    // and bounce straight back to /login.
    router.refresh();
    router.push(returnTo);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {isRegister && (
        <label className="flex flex-col gap-1 text-sm">
          <span>Name</span>
          <input
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Optional"
            className="rounded border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span>Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>Password</span>
        <input
          name="password"
          type="password"
          required
          // Server-side is the real check (Better Auth's minPasswordLength).
          // This just saves a round trip, and only for the sign-up form —
          // enforcing it on login would lock out anyone whose password
          // predates a future change to the minimum.
          minLength={isRegister ? CLIENT_PASSWORD_MIN_LENGTH : undefined}
          autoComplete={isRegister ? "new-password" : "current-password"}
          className="rounded border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
        />
        {isRegister && (
          <span className="text-xs text-gray-500">
            At least {CLIENT_PASSWORD_MIN_LENGTH} characters.
          </span>
        )}
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-gray-900"
      >
        {pending ? "Working…" : isRegister ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
