/**
 * Placeholder landing page.
 *
 * Exists so there is something to look at the moment the app is deployed —
 * deploying on day one, before any features, is the point. Replace this with
 * the real UI for whichever project this repo became.
 */
import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">fintech-app-template</h1>
        <p className="text-muted mt-2 text-sm text-gray-500 dark:text-gray-400">
          Scaffolding is live. Replace this page with the real thing.
        </p>
      </div>

      {/* Slice 5 replaces this with the real landing page — problem statement,
          screenshot, and the "Try the demo" button from spec §9. For now these
          two links are simply how you reach the app at all. */}
      <div className="flex gap-3">
        <Link
          href="/login"
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-gray-900"
        >
          Sign in
        </Link>
        <Link
          href="/register"
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-700"
        >
          Create account
        </Link>
      </div>

      <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
        <li>
          Health check:{" "}
          <a className="underline underline-offset-4" href="/api/health">
            /api/health
          </a>
        </li>
        <li>Setup notes: docs/SETUP.md</li>
        <li>Deploy steps: docs/DEPLOY.md</li>
      </ul>
    </main>
  );
}
