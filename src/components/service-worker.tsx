"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production. Browsers only allow it over
 * HTTPS (or on localhost), so plain-HTTP installs simply skip it.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {});
  }, []);
  return null;
}
