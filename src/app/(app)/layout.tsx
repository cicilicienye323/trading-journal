/**
 * The protected route group.
 *
 * Any page placed under `src/app/(app)/` is behind a session check by virtue of
 * being there — spec §8.1 puts `/dashboard`, `/trades`, `/trades/new`,
 * `/trades/[id]`, `/import`, and `/accounts` in here. The parentheses keep
 * "(app)" out of the URL, so the paths stay exactly as the spec lists them.
 *
 * ── This layout is not the authorization boundary ──
 * It redirects a signed-out visitor to `/login`, which is a navigation
 * convenience. It does not make the data underneath safe, because a server
 * action is a POST to the route rather than a render of it — this layout does
 * not run for one. Next's own proxy docs make the same point.
 *
 * The real boundary is the query predicate (spec §8.3): scope every read and
 * write with `eq(table.userId, session.user.id)` so another user's row is never
 * found in the first place. Every server action calls `requireSession()` itself.
 *
 * Reading the session calls `headers()`, which opts these routes into dynamic
 * rendering automatically — no `export const dynamic` needed. That is what you
 * want: a cached dashboard would be one user's numbers shown to another.
 */
import { requireSession } from "@/lib/auth-guard";

import Link from "next/link";

import { SignOutButton } from "./sign-out-button";

/**
 * Plain `Link`s, with no active-state highlighting. Marking the current item
 * would mean reading the pathname, which requires a Client Component and would
 * pull this whole layout into the browser bundle for a purely cosmetic gain.
 * Slice 5 can add it with a small client component around just the nav.
 */
const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/trades", label: "Trades" },
  { href: "/import", label: "Import" },
  { href: "/accounts", label: "Accounts" },
] as const;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user } = await requireSession();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-gray-200 px-6 py-3 dark:border-gray-800">
        <nav className="flex items-center gap-4">
          <span className="text-sm font-medium">Trading journal</span>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-gray-500 hover:underline"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user.email}</span>
          <SignOutButton />
        </div>
      </header>

      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
