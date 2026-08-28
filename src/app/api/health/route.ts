import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";

// Never cache: the point of this route is to report live state.
export const dynamic = "force-dynamic";

/**
 * Health check.
 *
 * Deploys can succeed while the database is unreachable — wrong connection
 * string, missing env var, Neon branch deleted. This route makes that visible
 * immediately instead of on the first user request.
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", database: "reachable" });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
