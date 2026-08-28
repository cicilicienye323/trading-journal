import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmounts rendered components between tests so one test's DOM can't leak into
// the next and produce a passing test that would fail in isolation.
afterEach(() => {
  cleanup();
});
