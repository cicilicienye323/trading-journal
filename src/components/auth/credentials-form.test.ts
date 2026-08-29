/**
 * Tests for the error-message mapping in the auth forms.
 *
 * The codes asserted here are not guesses — each was observed coming back from
 * a running server during Slice 1a:
 *
 *   wrong password  -> 401 {"code":"INVALID_EMAIL_OR_PASSWORD"}
 *   duplicate email -> 422 {"code":"USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"}
 *   short password  -> 400 {"code":"PASSWORD_TOO_SHORT"}
 *
 * If a Better Auth upgrade renames one, the mapping falls through to the
 * library's own message rather than breaking — which is the point of the
 * fallback, and why the fallback itself is tested.
 */
import { describe, expect, it } from "vitest";

import { CLIENT_PASSWORD_MIN_LENGTH, messageForError } from "./credentials-form";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth";

describe("messageForError", () => {
  it("points a duplicate email at signing in instead", () => {
    expect(messageForError("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", undefined, "register")).toMatch(
      /already registered/i,
    );
    expect(messageForError("USER_ALREADY_EXISTS", undefined, "register")).toMatch(
      /already registered/i,
    );
  });

  it("gives the same answer for a bad password and an unknown user", () => {
    // Distinguishing them would confirm to an attacker which emails are
    // registered, one guess at a time.
    const badPassword = messageForError("INVALID_EMAIL_OR_PASSWORD", undefined, "login");
    const noSuchUser = messageForError("USER_NOT_FOUND", undefined, "login");

    expect(badPassword).toBe(noSuchUser);
    expect(badPassword).toBe("Wrong email or password.");
  });

  it("states the actual minimum for a short password", () => {
    expect(messageForError("PASSWORD_TOO_SHORT", undefined, "register")).toContain(
      String(CLIENT_PASSWORD_MIN_LENGTH),
    );
  });

  it("passes an unmapped error through instead of swallowing it", () => {
    // A generic "something went wrong" here would make a real outage
    // undiagnosable from a screenshot.
    expect(messageForError("SOME_FUTURE_CODE", "Database is on fire", "login")).toBe(
      "Database is on fire",
    );
  });

  it("still says something useful when there is no message at all", () => {
    expect(messageForError(undefined, undefined, "login")).toBe("Could not sign in.");
    expect(messageForError(undefined, undefined, "register")).toBe("Could not create the account.");
  });
});

describe("password length", () => {
  it("is the same number on the client and the server", () => {
    // The client copy exists because `lib/auth.ts` is server-only and importing
    // it into a Client Component would pull the database driver into the
    // browser bundle. Duplicated constants drift; this is the tripwire.
    expect(CLIENT_PASSWORD_MIN_LENGTH).toBe(PASSWORD_MIN_LENGTH);
  });

  it("is at least the 8 characters the spec requires", () => {
    // Spec §2 A1: "password minimal 8 karakter".
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(8);
  });
});
