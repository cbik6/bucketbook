"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "!rounded-xl !border !border-rule !bg-surface !text-ink !shadow-[var(--shadow-float)] !font-sans",
          description: "!text-ink-muted",
          actionButton: "!bg-signal !text-on-signal !font-medium",
          closeButton: "!bg-surface !border-rule !text-ink-muted",
        },
      }}
    />
  );
}
