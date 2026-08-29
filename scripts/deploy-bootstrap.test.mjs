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
      // Second GET of the project, after the deploy: carries the real alias.
      // Deliberately NOT "trading-journal.vercel.app" — that host belongs to
      // someone else, and guessing it is the bug this pins down.
      if (p === "/v9/projects/prj_test" && req.method === "PATCH")
        return send(200, { id: "prj_test", autoExposeSystemEnvs: true });
      if (p === "/v9/projects/prj_test")
        return send(200, {
          id: "prj_test",
          targets: { production: { alias: ["trading-journal-cici.vercel.app"] } },
        });

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
          // vitest.config.mts sets this; inherited by the script AND by the
          // seed it spawns, it would disable the validation these tests pin.
          SKIP_ENV_VALIDATION: "",
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
let seedRun;
let healthFails;
let healthProtected;
let protectedSrv;
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

  // Lets the seed step actually run. It cannot reach the fake Neon host, so it
  // fails at connection — but only if it gets past env validation first.
  seedRun = await run({
    skip: "github,push,migrate,verify",
    env: { GITHUB_REPOSITORY: "testuser/trading-journal" },
  });

  // Runs verify() against a dead port so the health poll genuinely fails.
  // A workflow that exits 0 here would report a dead deployment as success.
  neonUris = [DIRECT, POOLED];
  healthFails = await run({
    skip: "github,push,migrate,seed",
    env: {
      GITHUB_REPOSITORY: "testuser/trading-journal",
      PROD_URL: "http://127.0.0.1:1",
      HEALTH_ATTEMPTS: "2",
      HEALTH_INTERVAL_MS: "10",
    },
  });

  // A URL behind Vercel Deployment Protection: HTML challenge, never JSON.
  // Retrying cannot clear it, so the poll must stop and say so.
  protectedSrv = createServer((_req, res) => {
    res.writeHead(403, { "Content-Type": "text/html" });
    res.end("<html><body>Vercel Security Checkpoint</body></html>");
  });
  await new Promise((r) => protectedSrv.listen(0, "127.0.0.1", r));
  healthProtected = await run({
    skip: "github,push,migrate,seed",
    env: {
      GITHUB_REPOSITORY: "testuser/trading-journal",
      PROD_URL: `http://127.0.0.1:${protectedSrv.address().port}`,
      HEALTH_ATTEMPTS: "20",
      HEALTH_INTERVAL_MS: "5000",
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
  protectedSrv?.close();
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

describe("system environment variables", () => {
  it("turns on autoExposeSystemEnvs", () => {
    // BETTER_AUTH_URL is derived from VERCEL_PROJECT_PRODUCTION_URL at runtime.
    // Without this the build is green and every request 500s on env validation.
    const patch = both.requests.find(
      (r) => r.method === "PATCH" && r.path === "/v9/projects/prj_test",
    );
    expect(patch?.body).toEqual({ autoExposeSystemEnvs: true });
  });
});

describe("production URL", () => {
  it("uses the alias Vercel reports, not a guessed <name>.vercel.app", () => {
    // trading-journal.vercel.app is a real site owned by someone else. Guessing
    // it means verifying against a stranger's app: their 404 read as our
    // failure, or their 200 as our success.
    expect(both.state.prodUrl).toBe("https://trading-journal-cici.vercel.app");
    expect(both.state.prodUrl).not.toBe("https://trading-journal.vercel.app");
  });

  it("asks Vercel for the project after deploying", () => {
    expect(find(both.requests, "GET", "/v9/projects/prj_test")).toBeDefined();
  });

  it("records the deployment URL too", () => {
    expect(both.state.deployUrl).toBe("https://trading-journal-abc123.vercel.app");
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

describe("health verification", () => {
  it("exits non-zero when /api/health never goes healthy", () => {
    // Otherwise the workflow is green while the deployment serves nothing —
    // a dead link that looks verified, which is the whole failure this
    // script exists to prevent.
    expect(healthFails.code).toBe(1);
  });

  it("says which URL it checked", () => {
    expect(healthFails.output).toContain("never returned healthy");
    expect(healthFails.output).toContain("127.0.0.1:1");
  });

  it("makes clear nothing is lost", () => {
    expect(healthFails.output).toContain("re-running reuses every resource");
  });
});

describe("Vercel Deployment Protection", () => {
  it("stops polling immediately instead of retrying a challenge", () => {
    // 20 attempts at 5s would be 100s. Detecting it must short-circuit.
    expect(healthProtected.output).toContain("Deployment Protection is blocking");
  });

  it("explains that no automated check can pass, and where to turn it off", () => {
    expect(healthProtected.output).toContain("Settings > Deployment Protection");
  });

  it("still fails the run — a challenged URL is not a live one", () => {
    expect(healthProtected.code).toBe(1);
  });
});

describe("seed step", () => {
  // Regression: seed() passed only DATABASE_URL, so scripts/seed.ts died in
  // src/env at module load — on BETTER_AUTH_SECRET, before touching the DB.
  it("passes enough environment for src/env to validate", () => {
    expect(seedRun.output).not.toContain("Invalid environment variables");
    expect(seedRun.output).not.toContain("BETTER_AUTH_SECRET must be at least");
  });

  it("reaches the database layer and fails there instead", () => {
    expect(seedRun.output).toContain("Seed failed");
  });

  it("does not invent a cause for the failure", () => {
    // The child prints its own error; a guessed explanation buries it.
    expect(seedRun.output).not.toContain("Migrations must succeed first");
  });
});

describe("seed environment", () => {
  // The reported failure: seed() passed only DATABASE_URL, but scripts/seed.ts
  // imports src/db -> src/env, which validates the whole schema at module load.
  // It died on BETTER_AUTH_SECRET before opening a single connection.
  const runSeed = (env) =>
    new Promise((resolve) => {
      execFile(
        "npx",
        ["tsx", "scripts/seed.ts"],
        {
          encoding: "utf8",
          // Port 1 refuses immediately, so a run that gets past validation
          // fails fast on connection instead of hanging.
          env: {
            ...process.env,
            // vitest.config.mts sets this for the test process. Inherited by
            // the child it disables the very validation under test, which made
            // the "gets past validation" case pass for the wrong reason.
            SKIP_ENV_VALIDATION: "",
            DATABASE_URL: "postgresql://u:p@127.0.0.1:1/none",
            BETTER_AUTH_SECRET: "",
            BETTER_AUTH_URL: "",
            DEMO_EMAIL: "",
            ...env,
          },
          timeout: 60000,
        },
        (err, stdout, stderr) => resolve((stdout || "") + (stderr || "")),
      );
    });

  it("fails env validation when only DATABASE_URL is provided", async () => {
    const out = await runSeed({});
    expect(out).toContain("Invalid environment variables");
    expect(out).toContain("BETTER_AUTH_SECRET");
  }, 90000);

  it("gets past validation with the variables seed() actually passes", async () => {
    const out = await runSeed({
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://trading-journal-cici.vercel.app",
      DEMO_EMAIL: "demo@example.com",
    });
    expect(out).not.toContain("Invalid environment variables");
    // Reached the database layer, which is as far as it can get without one.
    expect(out).toContain("Seed failed");
  }, 90000);
});

describe("vercel build configuration", () => {
  // Reproduced against the real build: without the Vercel system env vars,
  // `next build` dies collecting /api/health because src/env validates
  // BETTER_AUTH_URL at module load. That is what failed on Vercel while CI
  // stayed green — CI sets SKIP_ENV_VALIDATION and the Vercel build did not.
  it("skips env validation during the build, as src/env documents", () => {
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(cfg.buildCommand).toContain("SKIP_ENV_VALIDATION=true");
  });

  it("does not disable validation at runtime", () => {
    // Build-time only. Setting it as a project env var would silence the
    // check on every server start, which is the opposite of the intent.
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(cfg.env?.SKIP_ENV_VALIDATION).toBeUndefined();
    expect(cfg.build?.env?.SKIP_ENV_VALIDATION).toBeUndefined();
  });
});

describe("next.config output mode", () => {
  // The Vercel build died in Vercel's own onBuildComplete step with
  // ENOENT .next/next-server.js.nft.json. output:"standalone" rearranges the
  // build output and is documented as a self-hosting/Docker feature; Vercel
  // packages the standard layout itself. Leading suspect, not a proven cause —
  // the failing step only runs on Vercel's infrastructure.
  const outputFor = (env) =>
    new Promise((resolve) => {
      execFile(
        "npx",
        [
          "tsx",
          "-e",
          "import c from './next.config.ts'; console.log(JSON.stringify(c.output ?? null))",
        ],
        { encoding: "utf8", env: { ...process.env, ...env }, timeout: 60000 },
        (_e, stdout) => resolve(stdout.trim()),
      );
    });

  it("disables standalone when building on Vercel", async () => {
    expect(await outputFor({ VERCEL: "1" })).toBe("null");
  }, 90000);

  it("keeps standalone everywhere else — the Docker image needs it", async () => {
    expect(await outputFor({ VERCEL: "" })).toBe('"standalone"');
  }, 90000);
});
