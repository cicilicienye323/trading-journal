import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { databaseFingerprint, env, originOfRequest, resolveTrustedOrigins } from "@/env";

// Never cache: the point of this route is to report live state.
export const dynamic = "force-dynamic";

/**
 * Health check.
 *
 * Deploys can succeed while the database is unreachable — wrong connection
 * string, missing env var, Neon branch deleted. This route makes that visible
 * immediately instead of on the first user request.
 *
 * ── Why `auth` is reported here ──
 * Two auth failures are invisible from outside and cost a round trip each to
 * diagnose, because the page renders perfectly in both cases:
 *
 *   1. Sign-in answers "Invalid origin" — the browser's Origin is not among the
 *      trusted ones, usually because Vercel's system environment variables are
 *      not exposed at runtime, so only a per-deployment hostname was derived.
 *   2. Sign-up fails on a missing table — migrations were never applied to the
 *      production database. `database: "reachable"` does NOT cover this: the
 *      check below is `select 1`, which touches no table at all.
 *
 * Both become obvious by comparing `auth.origin` and `auth.trustedOrigins` to
 * the URL in the address bar, and by reading `auth.migrationsApplied`. These
 * are public hostnames and a boolean — no secret is exposed.
 */
export async function GET(request: Request) {
  try {
    await db.execute(sql`select 1`);

    // Asks the catalog rather than selecting from the table, so a missing table
    // is `false` here instead of an exception that would misreport the whole
    // database as unreachable.
    const rows = await db.execute<{ present: boolean }>(
      sql`select to_regclass('public.user') is not null as present`,
    );

    return NextResponse.json({
      status: "ok",
      database: "reachable",
      // Compare against the value the migrate-production workflow prints. Equal
      // fingerprints mean both point at the same database; different ones mean
      // the migration ran somewhere the app never reads, which looks exactly
      // like "the migration silently did nothing".
      databaseFingerprint: databaseFingerprint(env.DATABASE_URL),
      auth: {
        origin: env.BETTER_AUTH_URL,
        // The origin this very request arrived on. If it is absent from
        // trustedOrigins below, that is the "Invalid origin" cause, stated.
        requestOrigin: originOfRequest(request),
        trustedOrigins: resolveTrustedOrigins(env, originOfRequest(request)),
        migrationsApplied: Boolean(rows[0]?.present),
      },
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
