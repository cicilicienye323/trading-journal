/**
 * Shell for the signed-out pages, `/login` and `/register`.
 *
 * The `(auth)` folder is a route group: the parentheses keep it out of the URL,
 * so these pages live at `/login`, not `/auth/login`. It exists to give the two
 * of them a layout without affecting the paths.
 *
 * Already-signed-in visitors are bounced to the dashboard. Not a security
 * measure — it just stops a login form being the thing you see after logging in.
 */
import { redirect } from "next/navigation";

import { DEFAULT_SIGNED_IN_PATH, getSession } from "@/lib/auth-guard";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  if (await getSession()) redirect(DEFAULT_SIGNED_IN_PATH);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6">
      {children}
    </main>
  );
}
