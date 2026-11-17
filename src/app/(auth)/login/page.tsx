import { connection } from "next/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PlainShell, PlainShellFallback } from "@/components/plain-shell";
import { getCurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getSetupState } from "@/server/setup/service";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

async function LoginContent({ searchParams }: PageProps<"/login">) {
  // Per-user page: always render at request time, never at build time.
  await connection();
  const [setup, user, params] = await Promise.all([
    getSetupState(getDb()),
    getCurrentUser(),
    searchParams,
  ]);
  if (!setup.hasUser) redirect("/setup");
  const next = typeof params.next === "string" ? params.next : "/";
  if (user) redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");

  return (
    <PlainShell>
      <h1 className="mb-2 text-2xl font-semibold text-ink">Welcome back</h1>
      <p className="mb-8 text-ink-muted">Sign in to open your books.</p>
      <LoginForm next={next} />
    </PlainShell>
  );
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <Suspense fallback={<PlainShellFallback />}>
      <LoginContent {...props} />
    </Suspense>
  );
}
