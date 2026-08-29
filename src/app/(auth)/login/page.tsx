import Link from "next/link";

import { CredentialsForm } from "@/components/auth/credentials-form";
import { RETURN_TO_PARAM, safeReturnTo } from "@/lib/auth-guard";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // `?next=` arrives from the protected layout when someone tried to open a
  // page while signed out. It is attacker-controllable — anyone can send a link
  // — so it is laundered through safeReturnTo before it becomes a redirect.
  const params = await searchParams;
  const raw = params[RETURN_TO_PARAM];
  const returnTo = safeReturnTo(Array.isArray(raw) ? raw[0] : raw);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-gray-500">Trading journal</p>
      </div>

      <CredentialsForm mode="login" returnTo={returnTo} />

      <p className="text-sm text-gray-500">
        No account?{" "}
        <Link className="underline underline-offset-4" href="/register">
          Create one
        </Link>
      </p>
    </>
  );
}
