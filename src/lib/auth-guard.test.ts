/**
 * Tests for the pure parts of the auth guard.
 *
 * `safeReturnTo` is the interesting one: it is the only thing standing between
 * `?next=` and an open redirect, and open redirects are easy to reintroduce
 * because the naive version ("does it start with a slash?") looks correct.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_SIGNED_IN_PATH, loginUrlFor, safeReturnTo } from "./auth-guard";

describe("safeReturnTo", () => {
  it("keeps a normal in-app path", () => {
    expect(safeReturnTo("/trades")).toBe("/trades");
  });

  it("keeps a path with a query string, which is how filters are shared", () => {
    // Spec T2 stores table filters in the URL, so the return path must be able
    // to carry them.
    expect(safeReturnTo("/trades?symbol=EURUSD&outcome=loss")).toBe(
      "/trades?symbol=EURUSD&outcome=loss",
    );
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
  ])("falls back when the value is %s", (_label, value) => {
    expect(safeReturnTo(value)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  describe("refuses to send the user off-site", () => {
    it.each([
      ["absolute http url", "https://evil.example/phish"],
      ["protocol-relative url", "//evil.example"],
      ["protocol-relative with path", "//evil.example/login"],
      ["backslash-relative url", "/\\evil.example"],
      ["backslash anywhere", "/trades\\@evil.example"],
      ["scheme-only", "javascript:alert(1)"],
      ["bare host", "evil.example"],
    ])("%s", (_label, value) => {
      expect(safeReturnTo(value)).toBe(DEFAULT_SIGNED_IN_PATH);
    });
  });

  describe("refuses to bounce back to an auth page", () => {
    it.each([
      ["login", "/login"],
      ["register", "/register"],
      ["login with a query string", "/login?next=%2Flogin"],
    ])("%s", (_label, value) => {
      // Otherwise signing in returns you to the form you just used, which reads
      // as "login failed" even though it succeeded.
      expect(safeReturnTo(value)).toBe(DEFAULT_SIGNED_IN_PATH);
    });

    it("still allows a path that merely starts with the same letters", () => {
      expect(safeReturnTo("/logins-report")).toBe("/logins-report");
    });
  });

  it("honours an explicit fallback", () => {
    expect(safeReturnTo("https://evil.example", "/")).toBe("/");
  });
});

describe("loginUrlFor", () => {
  it("round-trips an attempted path through the query string", () => {
    expect(loginUrlFor("/trades")).toBe("/login?next=%2Ftrades");
  });

  it("encodes a query string so it survives as one parameter", () => {
    // Without encoding, the "&" would split into a second parameter and the
    // filter would be silently dropped on the way back.
    const url = loginUrlFor("/trades?symbol=EURUSD&outcome=loss");
    expect(url).toBe("/login?next=%2Ftrades%3Fsymbol%3DEURUSD%26outcome%3Dloss");

    const returned = new URL(url, "http://localhost").searchParams.get("next");
    expect(returned).toBe("/trades?symbol=EURUSD&outcome=loss");
    expect(safeReturnTo(returned)).toBe("/trades?symbol=EURUSD&outcome=loss");
  });

  it("omits the parameter entirely for an unsafe destination", () => {
    // Rather than embedding a rejected value that would only be dropped later.
    expect(loginUrlFor("https://evil.example")).toBe("/login");
    expect(loginUrlFor("/login")).toBe("/login");
  });
});
