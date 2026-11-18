import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PlainShell, PlainShellFallback } from "@/components/plain-shell";
import { getCurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { findInvite } from "@/server/people/service";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Join Bucketbook", referrer: "no-referrer" };

async function InviteContent({ params }: PageProps<"/invite/[token]">) {
  // Per-request page: the invitation is checked each time.
  await connection();
  const { token } = await params;
  const [invite, user] = await Promise.all([findInvite(getDb(), token), getCurrentUser()]);

  if (!invite) {
    return (
      <PlainShell>
        <h1 className="mb-2 text-2xl font-semibold text-ink">This link doesn&apos;t work</h1>
        <p className="mb-6 text-ink-muted">
          The invitation has expired, was already used, or was withdrawn. Ask whoever invited you
          for a new link.
        </p>
        <Link href="/login" className="text-sm font-medium text-signal-strong underline">
          Go to sign in
        </Link>
      </PlainShell>
    );
  }

  return (
    <PlainShell>
      <h1 className="mb-2 text-2xl font-semibold text-ink">Join Bucketbook</h1>
      <p className="mb-8 text-ink-muted">
        You&apos;ve been invited to share these books. Choose a password to finish.
      </p>
      {user ? (
        <p className="mb-6 rounded-lg bg-sunken p-3 text-sm text-ink-muted">
          You&apos;re signed in as {user.email}. Joining signs you in as {invite.email} instead.
        </p>
      ) : null}
      <InviteForm token={token} name={invite.name} email={invite.email} />
    </PlainShell>
  );
}

export default function InvitePage(props: PageProps<"/invite/[token]">) {
  return (
    <Suspense fallback={<PlainShellFallback />}>
      <InviteContent {...props} />
    </Suspense>
  );
}
