import type { ReactNode } from "react";
import { Wordmark } from "./wordmark";

/** Centered single-column layout for setup and sign-in, outside the app shell. */
export function PlainShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-rail text-rail-ink">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-5">
          <Wordmark />
        </div>
      </header>
      <main
        className={`mx-auto w-full flex-1 px-5 pb-16 pt-10 sm:pt-16 ${wide ? "max-w-2xl" : "max-w-md"}`}
      >
        {children}
      </main>
    </div>
  );
}

export function PlainShellFallback() {
  return (
    <PlainShell>
      <div className="h-6 w-40 animate-pulse rounded bg-rule" />
    </PlainShell>
  );
}
