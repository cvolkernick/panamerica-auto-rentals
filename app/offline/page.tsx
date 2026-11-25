import type { Metadata } from "next";

import { SITE_NAME } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Offline",
  robots: "noindex",
};

/** Shown by the service worker when a page is opened with no connection and no saved copy. */
export default function OfflinePage() {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-4 px-6 py-24 text-center">
      <h1 className="text-4xl font-bold text-white">You&apos;re offline</h1>
      <p className="text-muted-foreground">
        {SITE_NAME} needs a connection to load this page. Check your signal and try again.
      </p>
    </section>
  );
}
