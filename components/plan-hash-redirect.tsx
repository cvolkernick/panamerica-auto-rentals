"use client";

import { useEffect } from "react";

const LEGACY_PLAN_HASHES: Record<string, string> = {
  "earn-to-own": "owner-exit",
};

export function PlanHashRedirect() {
  useEffect(() => {
    const current = window.location.hash.replace(/^#/, "");
    const next = LEGACY_PLAN_HASHES[current];
    if (!next) return;

    const target = document.getElementById(next);
    window.history.replaceState(null, "", `#${next}`);
    target?.scrollIntoView();
  }, []);

  return null;
}
