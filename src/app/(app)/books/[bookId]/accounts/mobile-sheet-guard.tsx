"use client";

import { useEffect } from "react";

/**
 * While the editor is open as a bottom sheet (narrow screens), make the page
 * behind it inert so keyboard and screen reader focus stay in the sheet.
 * On wide screens the editor is a side panel and the list stays usable.
 */
export function MobileSheetGuard() {
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023.98px)");
    const targets = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-sheet-inert], [data-app-topbar]"));
    const apply = () => {
      for (const el of targets()) el.inert = query.matches;
      if (query.matches) {
        const sheet = document.querySelector<HTMLElement>("[data-account-editor]");
        if (sheet && !sheet.contains(document.activeElement)) {
          sheet.querySelector<HTMLElement>("input, select, textarea, a, button")?.focus();
        }
      }
    };
    apply();
    query.addEventListener("change", apply);
    return () => {
      query.removeEventListener("change", apply);
      for (const el of targets()) el.inert = false;
    };
  }, []);
  return null;
}
