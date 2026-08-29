"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { signOut } from "@/lib/auth-client";

/**
 * Sign out, then go to `/` — spec §2 A2: "logout balik ke /".
 *
 * `router.refresh()` before navigating is load-bearing: it throws away the
 * client's cached RSC payload, which still contains the signed-in header. Skip
 * it and the app looks logged in until a hard reload.
 */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await signOut();
        router.refresh();
        router.push("/");
      }}
      className="text-sm underline underline-offset-4 disabled:opacity-50"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
