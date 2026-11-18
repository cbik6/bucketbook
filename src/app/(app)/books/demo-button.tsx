"use client";

import { Sparkles } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createDemoBookAction } from "./actions";

/** Builds a sample book with a few months of activity to explore. */
export function DemoButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await createDemoBookAction();
          if (r?.error) toast.error(r.error);
        })
      }
    >
      <Sparkles size={15} aria-hidden />
      {pending ? "Building the demo" : "Try a demo book"}
    </Button>
  );
}
