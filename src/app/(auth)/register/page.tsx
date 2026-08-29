import Link from "next/link";

import { CredentialsForm } from "@/components/auth/credentials-form";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/auth-guard";

export const metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
        <p className="mt-1 text-sm text-gray-500">Trading journal</p>
      </div>

      {/* No `?next=` handling here: you only land on this page by choosing to,
          never by being bounced off a protected route. Sign-up goes to the
          dashboard, per spec §2 A1. */}
      <CredentialsForm mode="register" returnTo={DEFAULT_SIGNED_IN_PATH} />

      <p className="text-sm text-gray-500">
        Already have an account?{" "}
        <Link className="underline underline-offset-4" href="/login">
          Sign in
        </Link>
      </p>
    </>
  );
}
