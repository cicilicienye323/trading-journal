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

      // GitHub
      if (p === "/user") return send(200, { login: "testuser" });
      if (p === "/repos/testuser/trading-journal") return send(404, { message: "Not Found" });
      if (p === "/user/repos" && req.method === "POST")
        return send(201, { name: "trading-journal" });

      // Vercel
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
function run() {
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
        "push,migrate,seed,verify",
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
        },
        timeout: 60000,
      },
      // A non-zero exit is not itself a failure; the assertions decide.
      (_err, stdout, stderr) =>
        resolve({
          output: (stdout || "") + (stderr || ""),
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

beforeAll(async () => {
  server = startMock();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  scratch = mkdtempSync(join(tmpdir(), "deploy-bootstrap-test-"));

  neonUris = [DIRECT, POOLED];
  both = await run();

  neonUris = [DIRECT];
  directOnly = await run();
}, 90000);

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

describe("secrets", () => {
  it("never prints raw tokens", () => {
    expect(both.output).not.toContain("gh-test");
    expect(both.output).not.toContain("neon-test");
    expect(both.output).not.toContain("vc-test");
  });
});
