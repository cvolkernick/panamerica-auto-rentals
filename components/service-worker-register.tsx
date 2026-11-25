"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js after the page has loaded. Does nothing where service
 * workers are unsupported or in development. The worker itself ignores
 * /api/* and the signed-in portals; see public/sw.js.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
