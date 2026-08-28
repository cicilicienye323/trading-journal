#!/usr/bin/env node
/**
 * First-deploy bootstrap: Neon -> GitHub -> migrate -> Vercel -> seed -> verify.
 *
 * This is the automated equivalent of `docs/FIRST-DEPLOY.md`. The manual guide
 * is still the source of truth for *why* each step exists — read it once. This
 * script exists so you only do the clicking part once, and so the three things
 * people actually forget (pooled connection string, running migrations, setting
 * env vars on all three targets) cannot be forgotten.
 *
 * Usage:
 *   NEON_API_KEY=... GITHUB_TOKEN=... VERCEL_TOKEN=... \
 *     node scripts/deploy-bootstrap.mjs --name trading-journal
 *
 * Every step is idempotent and re-entrant: if a step already happened, it is
 * detected and skipped. If the script dies halfway, fix the cause and re-run the
 * same command — it picks up where it stopped. Nothing is ever deleted.
 *
 * Skip steps you have already done by hand:
 *   --skip neon,github,migrate,vercel,seed
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Arg parsing + small helpers
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};

const NAME = getArg("--name", "trading-journal");
const REGION = getArg("--region", "aws-ap-southeast-1"); // Singapore
const PG_VERSION = Number(getArg("--pg", "16")); // matches docker-compose.yml
const SKIP = new Set((getArg("--skip", "") || "").split(",").filter(Boolean));
const STATE_FILE = ".deploy-state.json"; // gitignored; lets re-runs resume

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

let stepNo = 0;
const step = (title) => console.log(`\n${c.bold(`[${++stepNo}] ${title}`)}`);
const ok = (msg) => console.log(`  ${c.green("✓")} ${msg}`);
const info = (msg) => console.log(`  ${c.dim("·")} ${c.dim(msg)}`);
const warn = (msg) => console.log(`  ${c.yellow("!")} ${msg}`);

/** Fail with the provider's actual response body — guessing wastes more time. */
function die(msg, detail) {
  console.error(`\n${c.red("✗ " + msg)}`);
  if (detail)
    console.error(c.dim(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)));
  process.exit(1);
}

async function api(
  url,
  { token, method = "GET", body, headers = {}, tokenScheme = "Bearer" } = {},
) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `${tokenScheme} ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { res, json, status: res.status };
}

/** Prior-run state, so a half-finished run can resume instead of restarting. */
function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    warn(`${STATE_FILE} is not valid JSON — starting from scratch`);
    return {};
  }
}
const state = loadState();
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();

// ---------------------------------------------------------------------------
// Step 1 — Neon: create the Postgres project, derive the POOLED URL
// ---------------------------------------------------------------------------

async function neon() {
  step("Neon — Postgres project");
  if (SKIP.has("neon")) return info("skipped (--skip neon)");

  const token = process.env.NEON_API_KEY;
  if (!token)
    die(
      "NEON_API_KEY is not set.",
      "Create one at https://console.neon.tech/app/settings/api-keys",
    );

  // Idempotent: reuse a project with this name if it already exists.
  const list = await api("https://console.neon.tech/api/v2/projects", { token });
  if (list.status === 401)
    die(
      "Neon rejected the API key (401).",
      "Regenerate it at console.neon.tech > Settings > API keys",
    );
  if (!list.res.ok) die(`Neon list projects failed (${list.status}).`, list.json);

  let project = (list.json.projects || []).find((p) => p.name === NAME);

  if (project) {
    info(`reusing existing Neon project "${NAME}" (${project.id})`);
    // Creating a project returns the connection URI once; listing does not.
    // Re-derive it from the project's roles + endpoints.
    const detail = await api(
      `https://console.neon.tech/api/v2/projects/${project.id}/connection_uri` +
        `?database_name=neondb&role_name=neondb_owner&pooled=true`,
      { token },
    );
    if (detail.res.ok && detail.json?.uri) {
      state.databaseUrl = detail.json.uri;
    } else if (!state.databaseUrl) {
      die(
        "Reused an existing Neon project but could not fetch its connection string.",
        "Copy the POOLED connection string from the Neon dashboard and re-run with:\n" +
          `  DATABASE_URL="<pooled>" node scripts/deploy-bootstrap.mjs --skip neon`,
      );
    }
  } else {
    const created = await api("https://console.neon.tech/api/v2/projects", {
      token,
      method: "POST",
      body: { project: { name: NAME, pg_version: PG_VERSION, region_id: REGION } },
    });
    if (!created.res.ok) die(`Neon project creation failed (${created.status}).`, created.json);
    project = created.json.project;

    // Neon returns both a direct and a pooled URI. Take the pooled one: every
    // serverless invocation opens its own connection, and the direct endpoint
    // runs out of connections under real traffic — which shows up only once
    // someone else opens your portfolio, never while you test it yourself.
    const uris = created.json.connection_uris || [];
    const pooled = uris.find((u) => u.connection_uri.includes("-pooler."));
    state.databaseUrl = pooled?.connection_uri || toPooled(uris[0]?.connection_uri);
    ok(`created Neon project "${NAME}" (pg ${PG_VERSION}, ${REGION})`);
  }

  if (!state.databaseUrl) die("Could not determine a Neon connection string.");
  if (!state.databaseUrl.includes("-pooler.")) {
    warn("connection string has no '-pooler' host; converting to the pooled endpoint");
    state.databaseUrl = toPooled(state.databaseUrl);
  }
  state.neonProjectId = project.id;
  saveState();
  ok(`pooled DATABASE_URL ready ${c.dim("(host: " + hostOf(state.databaseUrl) + ")")}`);
}

/** The pooled endpoint is the same host with "-pooler" appended to the endpoint id. */
function toPooled(uri) {
  if (!uri) return uri;
  const u = new URL(uri);
  if (!u.hostname.includes("-pooler.")) {
    const [ep, ...rest] = u.hostname.split(".");
    u.hostname = [`${ep}-pooler`, ...rest].join(".");
  }
  return u.toString();
}
const hostOf = (uri) => {
  try {
    return new URL(uri).hostname;
  } catch {
    return "?";
  }
};

// ---------------------------------------------------------------------------
// Step 2 — GitHub: create the repo and push main
// ---------------------------------------------------------------------------

async function github() {
  step("GitHub — create repo and push");
  if (SKIP.has("github")) return info("skipped (--skip github)");

  const token = process.env.GITHUB_TOKEN;
  if (!token)
    die(
      "GITHUB_TOKEN is not set.",
      "Create a classic PAT with the 'repo' scope at https://github.com/settings/tokens",
    );

  const me = await api("https://api.github.com/user", {
    token,
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!me.res.ok) die(`GitHub rejected the token (${me.status}).`, me.json);
  const owner = me.json.login;
  ok(`authenticated as ${owner}`);

  const existing = await api(`https://api.github.com/repos/${owner}/${NAME}`, { token });
  if (existing.res.ok) {
    info(`repo ${owner}/${NAME} already exists — reusing`);
  } else {
    const created = await api("https://api.github.com/user/repos", {
      token,
      method: "POST",
      // auto_init false: an empty repo is required, or the first push is
      // rejected with "fetch first" and untangling that costs more than
      // starting clean.
      body: {
        name: NAME,
        private: false,
        auto_init: false,
        description: "Trading journal — Next.js, TypeScript, Postgres",
      },
    });
    if (!created.res.ok) die(`GitHub repo creation failed (${created.status}).`, created.json);
    ok(`created https://github.com/${owner}/${NAME}`);
  }

  state.owner = owner;
  state.repo = `${owner}/${NAME}`;
  saveState();

  // Push over an ephemeral tokenised URL so the PAT never lands in .git/config.
  const cleanUrl = `https://github.com/${owner}/${NAME}.git`;
  const authUrl = `https://x-access-token:${token}@github.com/${owner}/${NAME}.git`;

  const remotes = git("remote").split("\n").filter(Boolean);
  if (remotes.includes("origin")) {
    git("remote", "set-url", "origin", cleanUrl);
  } else {
    git("remote", "add", "origin", cleanUrl);
  }
  git("branch", "-M", "main");

  try {
    execFileSync("git", ["push", "-u", authUrl, "main"], { stdio: ["ignore", "pipe", "pipe"] });
    ok("pushed main");
  } catch (e) {
    const err = (e.stderr?.toString() || e.message).replace(token, "***");
    if (/Everything up-to-date/.test(err)) ok("already up to date");
    else die("git push failed.", err);
  }
  // Restore tracking against the clean (tokenless) URL.
  try {
    git("branch", "--set-upstream-to=origin/main", "main");
  } catch {
    /* tracking is cosmetic; ignore */
  }
  info(`CI: https://github.com/${owner}/${NAME}/actions`);
}

// ---------------------------------------------------------------------------
// Step 3 — Apply migrations against Neon
// ---------------------------------------------------------------------------

function migrate() {
  step("Migrations — apply schema to Neon");
  if (SKIP.has("migrate")) return info("skipped (--skip migrate)");

  const url = state.databaseUrl || process.env.DATABASE_URL;
  if (!url) die("No DATABASE_URL available for migrations.");

  // Deliberately NOT run during deploy: a migration that fails halfway through
  // a build leaves the schema in an unknown state. Applying it from here means
  // you see the failure directly.
  try {
    execFileSync("npx", ["drizzle-kit", "migrate"], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: url },
    });
    ok("migrations applied");
  } catch {
    die(
      "drizzle-kit migrate failed.",
      "Check the pooled connection string is correct and the Neon project is awake.",
    );
  }
}

// ---------------------------------------------------------------------------
// Step 4 — Vercel: project, env vars on all three targets, production deploy
// ---------------------------------------------------------------------------

async function vercel() {
  step("Vercel — project, env vars, deploy");
  if (SKIP.has("vercel")) return info("skipped (--skip vercel)");

  const token = process.env.VERCEL_TOKEN;
  if (!token) die("VERCEL_TOKEN is not set.", "Create one at https://vercel.com/account/tokens");
  const teamQ = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "";

  const existing = await api(`https://api.vercel.com/v9/projects/${NAME}${teamQ}`, { token });
  let project;
  if (existing.res.ok) {
    project = existing.json;
    info(`reusing Vercel project "${NAME}"`);
  } else {
    const created = await api(`https://api.vercel.com/v11/projects${teamQ}`, {
      token,
      method: "POST",
      body: {
        name: NAME,
        framework: "nextjs",
        gitRepository: { type: "github", repo: state.repo },
      },
    });
    if (!created.res.ok) {
      // Most common cause by far: the Vercel GitHub App is not installed on the
      // account, so Vercel cannot see the repo. That is a browser-only consent
      // screen — no API can grant it.
      die(
        `Vercel project creation failed (${created.status}).`,
        JSON.stringify(created.json, null, 2) +
          "\n\nIf this mentions the repository or permissions: connect GitHub to Vercel once at\n" +
          "  https://vercel.com/account/login-connections  (or import the repo via vercel.com/new)\n" +
          "then re-run this script — it will reuse everything already created.",
      );
    }
    project = created.json;
    ok(`created Vercel project "${NAME}"`);
  }
  state.vercelProjectId = project.id;
  saveState();

  // BETTER_AUTH_URL is intentionally absent: it is derived at runtime from
  // Vercel's own system env vars, so preview deploys get their own origin and
  // the session cookie always matches the host actually serving the app.
  const secret = state.betterAuthSecret || randomBytes(32).toString("base64");
  state.betterAuthSecret = secret;
  saveState();

  const vars = [
    { key: "DATABASE_URL", value: state.databaseUrl },
    { key: "BETTER_AUTH_SECRET", value: secret },
    { key: "DEMO_EMAIL", value: process.env.DEMO_EMAIL || "demo@example.com" },
  ];

  for (const v of vars) {
    if (!v.value) die(`Refusing to set empty ${v.key} on Vercel.`);
    const r = await api(
      `https://api.vercel.com/v10/projects/${project.id}/env${teamQ ? teamQ + "&" : "?"}upsert=true`,
      {
        token,
        method: "POST",
        body: {
          key: v.key,
          value: v.value,
          type: "encrypted",
          // All three targets. Missing one is the classic "works in prod, breaks
          // in preview" bug, and it surfaces days later.
          target: ["production", "preview", "development"],
        },
      },
    );
    if (!r.res.ok) die(`Setting ${v.key} failed (${r.status}).`, r.json);
    ok(`env ${v.key} set on production, preview, development`);
  }

  // Trigger a production deploy from main.
  const repoId = project.link?.repoId;
  const dep = await api(
    `https://api.vercel.com/v13/deployments${teamQ ? teamQ + "&" : "?"}forceNew=1`,
    {
      token,
      method: "POST",
      body: {
        name: NAME,
        project: project.id,
        target: "production",
        gitSource: repoId
          ? { type: "github", repoId, ref: "main" }
          : { type: "github", org: state.owner, repo: NAME, ref: "main" },
      },
    },
  );
  if (!dep.res.ok) {
    warn(`Could not trigger a deploy automatically (${dep.status}).`);
    info("Env vars are set. Push any commit, or hit Redeploy in the dashboard.");
    info(JSON.stringify(dep.json));
    return;
  }
  state.deployUrl = `https://${dep.json.url}`;
  state.prodUrl = `https://${NAME}.vercel.app`;
  saveState();
  ok(`deploy queued: ${state.deployUrl}`);
}

// ---------------------------------------------------------------------------
// Step 5 — Seed demo data
// ---------------------------------------------------------------------------

function seed() {
  step("Seed — demo data");
  if (SKIP.has("seed")) return info("skipped (--skip seed)");
  const url = state.databaseUrl || process.env.DATABASE_URL;
  if (!url) die("No DATABASE_URL available for seeding.");
  try {
    execFileSync("npx", ["tsx", "scripts/seed.ts"], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: url },
    });
    ok("seed complete");
  } catch {
    die(
      "Seed failed.",
      "Migrations must succeed first — a missing table shows up here as a seed error.",
    );
  }
}

// ---------------------------------------------------------------------------
// Step 6 — Verify the deploy is actually live
// ---------------------------------------------------------------------------

async function verify() {
  step("Verify — /api/health");
  const url = state.prodUrl || process.env.PROD_URL;
  if (!url) return info("no production URL known yet; check the Vercel dashboard");

  info(`polling ${url}/api/health (builds take ~1-2 min)`);
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${url}/api/health`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.database === "reachable") {
        ok(`live: ${JSON.stringify(body)}`);
        return true;
      }
      if (res.status === 503) {
        info(`503 (database unreachable) — still building, or migrations did not run`);
      }
    } catch {
      /* deployment not resolvable yet */
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  warn("health check did not go green within 10 minutes.");
  info(
    "See the troubleshooting table in docs/FIRST-DEPLOY.md — start with 'migrations not applied'.",
  );
  return false;
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(
    c.bold(`\nFirst-deploy bootstrap — ${NAME}\n`) +
      c.dim("Equivalent to docs/FIRST-DEPLOY.md. Safe to re-run.\n"),
  );

  await neon();
  await github();
  migrate();
  await vercel();
  seed();
  const green = await verify();

  console.log(`\n${c.bold("Summary")}`);
  console.log(`  repo      ${state.repo ? "https://github.com/" + state.repo : "-"}`);
  console.log(`  database  ${hostOf(state.databaseUrl)}`);
  console.log(`  app       ${state.prodUrl || "-"}`);
  console.log(`  health    ${green ? c.green("ok") : c.yellow("check manually")}`);
  console.log(
    c.dim(
      `\n  Secrets and ids were written to ${STATE_FILE} (gitignored).\n` +
        `  Re-running this command is safe: every step detects existing resources.\n`,
    ),
  );

  if (green) {
    console.log(
      c.green("\nDone. Open the URL in incognito to confirm a stranger sees the same thing.\n"),
    );
  }
}

main().catch((e) => die("Unexpected failure.", e.stack || String(e)));
