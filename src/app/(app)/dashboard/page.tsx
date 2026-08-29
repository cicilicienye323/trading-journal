/**
 * ⛳ PLACEHOLDER — this page is yours to replace.
 *
 * It exists so the protected route group has something to land on and the
 * register → dashboard flow in spec §2 A1 is testable end to end. The real
 * dashboard is spec §8.1 and Slice 3: metric cards (S1), equity curve (S2),
 * per-symbol breakdown (S3), drawdown and limit-breach panels (P1, P2), plus
 * the account and date-range filters (S4).
 *
 * The session is already resolved by the layout above. When you start querying,
 * call `requireSession()` here too and scope every query by `session.user.id` —
 * spec §8.3.
 */
import { getSession } from "@/lib/auth-guard";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  // Non-null in practice: the layout redirects before this renders. Read again
  // rather than passed down, because a page must not depend on a parent layout
  // having done the check — that assumption is what breaks when the page is
  // later reached some other way.
  const session = await getSession();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-sm text-gray-500">
        Signed in as {session?.user.email}. This page is a placeholder — the real dashboard arrives
        with the trade schema.
      </p>
    </div>
  );
}
