"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest("[role=menu]") !== null
  );
}

/** N opens a new account; Escape closes the side panel. No animation on either. */
export function AccountShortcuts({
  newHref,
  closeHref,
  panelOpen,
}: {
  newHref: string;
  closeHref: string;
  panelOpen: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (e.key === "Escape" && panelOpen && !isTyping(e.target)) {
        router.push(closeHref, { scroll: false });
      } else if ((e.key === "n" || e.key === "N") && !isTyping(e.target)) {
        e.preventDefault();
        router.push(newHref, { scroll: false });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, newHref, closeHref, panelOpen]);
  return null;
}
