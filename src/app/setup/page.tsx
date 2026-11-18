import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BookForm } from "@/components/book-form";
import { PlainShell, PlainShellFallback } from "@/components/plain-shell";
import { buttonClass } from "@/components/ui/button";
import { FillLine } from "@/components/ui/fill-line";
import { SubmitButton } from "@/components/ui/submit-button";
import { APP_NAME } from "@/lib/app-config";
import { templateSummaries } from "@/server/accounts/templates";
import { getCurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getSetupState } from "@/server/setup/service";
import { createFirstBookAction, finishSetupAction } from "./actions";
import { AdminForm } from "./admin-form";

export const metadata: Metadata = { title: "Set up" };

const STEPS = ["Your login", "First book", "Bank connection"] as const;

function StepHeader({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between text-[0.8125rem] text-ink-muted">
          <span>
            Step <span className="tabular">{step}</span> of{" "}
            <span className="tabular">{STEPS.length}</span>
          </span>
          <span>{STEPS[step - 1]}</span>
        </div>
        <FillLine
          value={step - 1}
          max={STEPS.length}
          label={`Setup progress, step ${step} of ${STEPS.length}`}
        />
      </div>
      <h1 className="text-2xl font-semibold text-ink sm:text-[1.75rem]">{title}</h1>
      {children ? <div className="text-ink-muted">{children}</div> : null}
    </div>
  );
}

async function SetupContent() {
  // Per-user page: always render at request time, never at build time.
  await connection();
  const db = getDb();
  const setup = await getSetupState(db);
  if (setup.completed) redirect("/");

  if (!setup.hasUser) {
    return (
      <PlainShell>
        <StepHeader step={1} title={`Welcome to ${APP_NAME}`}>
          Let&apos;s get your books ready. First, create the login you&apos;ll use on this server.
        </StepHeader>
        <AdminForm />
      </PlainShell>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return (
      <PlainShell>
        <StepHeader step={2} title="Sign in to finish setup">
          Your login exists, but this browser isn&apos;t signed in yet.
        </StepHeader>
        <Link href="/login?next=/setup" className={buttonClass("primary")}>
          Sign in
        </Link>
      </PlainShell>
    );
  }

  if (!setup.hasBook) {
    return (
      <PlainShell wide>
        <StepHeader step={2} title="Start your first book">
          A book is one set of accounts: your household, or a business. You can add more later.
        </StepHeader>
        <BookForm
          action={createFirstBookAction}
          templates={templateSummaries()}
          submitLabel="Create book and continue"
        />
      </PlainShell>
    );
  }

  return (
    <PlainShell>
      <StepHeader step={3} title="Connect your bank">
        {APP_NAME} brings in bank transactions through SimpleFIN, a service that reads your accounts
        without sharing your bank password. That connection arrives in a later update, so for now
        you can skip this step and set it up from Settings once it&apos;s ready.
      </StepHeader>
      <form action={finishSetupAction} className="flex flex-col gap-3">
        <div>
          <SubmitButton pendingLabel="Finishing">Connect later and open my books</SubmitButton>
        </div>
      </form>
    </PlainShell>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={<PlainShellFallback />}>
      <SetupContent />
    </Suspense>
  );
}
