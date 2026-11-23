import type { Metadata } from "next";

import { ImportsAdmin } from "./imports-admin";

export const metadata: Metadata = {
  title: "Trip import",
  robots: "noindex",
};

export const dynamic = "force-static";

export default function ImportsPage() {
  return <ImportsAdmin />;
}
