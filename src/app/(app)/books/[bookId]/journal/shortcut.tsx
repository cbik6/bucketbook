"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** N starts a new journal entry from the journal list. */
export function NewEntryShortcut({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        router.push(href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, href]);
  return null;
}
