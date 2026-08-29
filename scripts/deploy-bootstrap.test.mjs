// @vitest-environment node
/**
 * Exercises deploy-bootstrap's success paths against a mock Neon/GitHub/Vercel.
 *
 * The real script talks to three providers and creates billable resources, so
 * its happy path would otherwise only ever be exercised by running it for real
 * against someone's account. That is a bad place to discover a malformed body.
 *
 * These assert on the *requests the script sends* — method, path, body shape —
 * not on the mock's replies. A mock cannot tell us Vercel's API is shaped the
 * way we believe it is; it can tell us the script sends what we intended, and
 * that the wiring between steps holds together.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const POOLED =
  "postgresql://neondb_owner:pw@ep-test-123-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const DIRECT =
  "postgresql://neondb_owner:pw@ep-test-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const VERCEL_ENV_PATH = "/v10/projects/prj_test/env";

let server;
let base;
let scratch;
let runNo = 0;

/** Which connection URIs the mock Neon returns — the scenario variable. */
let neonUris = [DIRECT, POOLED];
/** Requests seen during the most recent run(). */
let requests = [];

function startMock() {
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const url = new URL(req.url, "http://localhost");
      requests.push({
        method: req.method,
        path: url.pathname,
        body: raw ? JSON.parse(raw) : null,
        auth: req.headers.authorization,
      });
      const send = (code, obj) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      const p = url.pathname;

      // Neon
      if (p === "/api/v2/projects" && req.method === "GET") return send(200, { projects: [] });
      if (p === "/api/v2/projects" && req.method === "POST")
        return send(201, {
          project: { id: "neon-proj-1", name: "trading-journal" },
          connection_uris: neonUris.map((connection_uri) => ({ connection_uri })),
        });

      // GitHub. Actions' built-in GITHUB_TOKEN is an installation token: it
      // cannot read /user, and answers 403 rather than 401. Reproduced here
      // because that difference is what broke the first real workflow run.
      if (p === "/user") {
        if (req.headers.authorization === "Bearer gh-actions-installation-token")
          return send(403, { message: "Resource not accessible by integration" });
        return send(200, { login: "testuser" });
      }
      if (p === "/repos/testuser/trading-journal") return send(404, { message: "Not Found" });
      if (p === "/user/repos" && req.method === "POST")
        return send(201, { name: "trading-journal" });

      // Vercel
      if (p === "/v2/user") return send(200, { user: { username: "testuser" } });
      if (p === "/v9/projects/trading-journal") return send(404, { error: { code: "not_found" } });
      if (p === "/v11/projects" && req.method === "POST")
        return send(200, { id: "prj_test", name: "trading-journal", link: { repoId: 998877 } });
      if (p === VERCEL_ENV_PATH && req.method === "POST") return send(201, { created: 1 });
      if (p === "/v13/deployments" && req.method === "POST")
        return send(200, { url: "trading-journal-abc123.vercel.app" });

      send(404, { error: "unmocked", path: p });
    });
  });
  return srv;
}

/** Runs the real script against the mock; returns its output, state and requests. */
function run({ skip = "push,migrate,seed,verify", env = {}, args = [] } = {}) {
  requests = [];
  const stateFile = join(scratch, `state-${++runNo}.json`);
  return new Promise((resolve) => {
    execFile(
      "node",
      [
        "scripts/deploy-bootstrap.mjs",
        "--name",
        "trading-journal",
        "--state",
        stateFile,
        // push/migrate/seed/verify each need something real — a remote, a
        // database, a live deployment — and push would rewrite this repo's own
        // origin. The API calls around them are what this covers.
        "--skip",
        skip,
        ...args,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          NEON_API_BASE: base,
          GITHUB_API_BASE: base,
          VERCEL_API_BASE: base,
          NEON_API_KEY: "neon-test",
          GITHUB_TOKEN: "gh-test",
          VERCEL_TOKEN: "vc-test",
          // Actions sets this; locally it must not leak in from the parent.
          GITHUB_REPOSITORY: "",
          ...env,
        },
        timeout: 60000,
      },
      // A non-zero exit is not itself a failure; the assertions decide.
      (err, stdout, stderr) =>
        resolve({
          output: (stdout || "") + (stderr || ""),
          code: err?.code ?? 0,
          state: existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {},
          requests,
        }),
    );
  });
}

// Both scenarios run once up front: each spawns a child process, and the
// assertions below only read the captured result.
let both;
let directOnly;
let ciRun;
let noRepo;
let preflightCI;
let preflightBadGh;

beforeAll(async () => {
  server = startMock();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  scratch = mkdtempSync(join(tmpdir(), "deploy-bootstrap-test-"));

  neonUris = [DIRECT, POOLED];
  both = await run();

  neonUris = [DIRECT];
  directOnly = await run();

  // How .github/workflows/deploy-bootstrap.yml invokes it: the repo already
  // exists, so the github step is skipped and the slug comes from Actions.
  neonUris = [DIRECT, POOLED];
  ciRun = await run({
    skip: "github,push,migrate,seed,verify",
    env: { GITHUB_REPOSITORY: "testuser/trading-journal" },
  });

  // Same, but with nothing to derive the slug from.
  noRepo = await run({ skip: "github,push,migrate,seed,verify" });

  // Exactly how the workflow's preflight step invokes it: --skip github, and
  // Actions' installation token in the environment (which cannot read /user).
  preflightCI = await run({
    skip: "github,push,migrate,seed,verify",
    args: ["--dry-run"],
    env: {
      GITHUB_TOKEN: "gh-actions-installation-token",
      GITHUB_REPOSITORY: "testuser/trading-journal",
    },
  });

  // Preflight when the github step really will run and its token is bad.
  preflightBadGh = await run({
    skip: "push,migrate,seed,verify",
    args: ["--dry-run"],
    env: { GITHUB_TOKEN: "gh-actions-installation-token" },
  });
}, 150000);

afterAll(() => {
  server?.close();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const find = (reqs, method, path) => reqs.find((r) => r.method === method && r.path === path);
const envPosts = (reqs) => reqs.filter((r) => r.method === "POST" && r.path === VERCEL_ENV_PATH);

describe("neon", () => {
  it("lists projects before creating one, so a re-run reuses it", () => {
    expect(find(both.requests, "GET", "/api/v2/projects")).toBeDefined();
  });

  it("creates Postgres 16 in the Singapore region", () => {
    const post = find(both.requests, "POST", "/api/v2/projects");
    expect(post?.body.project).toMatchObject({
      name: "trading-journal",
      pg_version: 16,
      region_id: "aws-ap-southeast-1",
    });
  });

  it("authenticates with a bearer token", () => {
    expect(find(both.requests, "POST", "/api/v2/projects")?.auth).toBe("Bearer neon-test");
  });
});

describe("connection string", () => {
  // The whole point of the script. A direct string deploys fine and then dies
  // under concurrency, long after anyone is watching.
  it("persists the pooled URI when Neon offers both", () => {
    expect(both.state.databaseUrl).toBe(POOLED);
  });

  it("rewrites a direct-only URI to the pooled host", () => {
    expect(directOnly.state.databaseUrl).toBe(POOLED);
  });

  it("sends the pooled URL to Vercel in both cases", () => {
    for (const r of [both, directOnly]) {
      const dbUrl = envPosts(r.requests).find((e) => e.body.key === "DATABASE_URL");
      expect(dbUrl?.body.value).toContain("-pooler.");
    }
  });

  it("records the project id so a half-finished run can resume", () => {
    expect(both.state.neonProjectId).toBe("neon-proj-1");
  });
});

describe("github", () => {
  it("validates the token before mutating anything", () => {
    expect(find(both.requests, "GET", "/user")).toBeDefined();
  });

  it("checks for an existing repo first", () => {
    expect(find(both.requests, "GET", "/repos/testuser/trading-journal")).toBeDefined();
  });

  it("creates a public, genuinely empty repo", () => {
    // auto_init would add a README and get the first push rejected.
    expect(find(both.requests, "POST", "/user/repos")?.body).toMatchObject({
      name: "trading-journal",
      private: false,
      auto_init: false,
    });
  });
});

describe("vercel", () => {
  it("creates the project linked to the repo with the Next.js preset", () => {
    expect(find(both.requests, "POST", "/v11/projects")?.body).toMatchObject({
      name: "trading-journal",
      framework: "nextjs",
      gitRepository: { type: "github", repo: "testuser/trading-journal" },
    });
  });

  it("sets exactly the three required env vars", () => {
    expect(
      envPosts(both.requests)
        .map((r) => r.body.key)
        .sort(),
    ).toEqual(["BETTER_AUTH_SECRET", "DATABASE_URL", "DEMO_EMAIL"]);
  });

  it("does not set BETTER_AUTH_URL, which is derived at runtime", () => {
    // Setting it pins the cookie domain and silently breaks preview logins.
    expect(envPosts(both.requests).map((r) => r.body.key)).not.toContain("BETTER_AUTH_URL");
  });

  it("targets production, preview and development for every var", () => {
    for (const post of envPosts(both.requests)) {
      expect(post.body.target).toEqual(["production", "preview", "development"]);
    }
  });

  it("generates a real 32-byte secret rather than the placeholder", () => {
    const secret = envPosts(both.requests).find((r) => r.body.key === "BETTER_AUTH_SECRET")?.body
      .value;
    expect(Buffer.from(secret, "base64")).toHaveLength(32);
    expect(secret).not.toBe("replace-me-with-32-plus-random-characters-abcd");
  });

  it("triggers a production deployment from main", () => {
    expect(find(both.requests, "POST", "/v13/deployments")?.body).toMatchObject({
      target: "production",
      gitSource: { type: "github", repoId: 998877, ref: "main" },
    });
  });
});

describe("CI path (--skip github, as the deploy workflow runs it)", () => {
  it("links Vercel to the repo derived from GITHUB_REPOSITORY", () => {
    // Without this the workflow sends `repo: undefined` and Vercel creates an
    // unlinked project that never deploys on push.
    expect(find(ciRun.requests, "POST", "/v11/projects")?.body.gitRepository).toEqual({
      type: "github",
      repo: "testuser/trading-journal",
    });
  });

  it("still creates no GitHub repo", () => {
    expect(find(ciRun.requests, "POST", "/user/repos")).toBeUndefined();
  });

  it("still sets all three env vars", () => {
    expect(envPosts(ciRun.requests)).toHaveLength(3);
  });

  it("fails loudly when the repo slug cannot be determined", () => {
    expect(find(noRepo.requests, "POST", "/v11/projects")).toBeUndefined();
    expect(noRepo.output).toContain("Don't know which GitHub repo");
  });
});

describe("preflight (--dry-run)", () => {
  // The first real workflow run died here: preflight checked GITHUB_TOKEN even
  // though the run skipped the github step, and Actions' installation token
  // answers 403 to /user. The job failed over a credential it never uses.
  it("passes when the only bad token belongs to a skipped step", () => {
    expect(preflightCI.code).toBe(0);
    expect(preflightCI.output).toContain("not needed (--skip github)");
    expect(preflightCI.output).toContain("Preflight clean");
  });

  it("never calls /user for a skipped github step", () => {
    expect(find(preflightCI.requests, "GET", "/user")).toBeUndefined();
  });

  it("still validates the tokens it will actually use", () => {
    expect(find(preflightCI.requests, "GET", "/api/v2/projects")).toBeDefined();
    expect(find(preflightCI.requests, "GET", "/v2/user")).toBeDefined();
  });

  it("creates nothing — every request is a GET", () => {
    expect(preflightCI.requests.every((r) => r.method === "GET")).toBe(true);
  });

  it("still fails when a token for a step that WILL run is rejected", () => {
    expect(preflightBadGh.code).toBe(1);
    expect(preflightBadGh.output).toContain("rejected (403)");
  });
});

describe("secrets", () => {
  it("never prints raw tokens", () => {
    expect(both.output).not.toContain("gh-test");
    expect(both.output).not.toContain("neon-test");
    expect(both.output).not.toContain("vc-test");
  });
});
