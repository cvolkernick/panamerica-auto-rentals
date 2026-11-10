import type { Metadata } from "next";

import { OwnerPortal } from "./owner-portal";

export const metadata: Metadata = {
  title: "Your cars",
  robots: "noindex",
};

export const dynamic = "force-static";

export default function OwnerPage() {
  return <OwnerPortal />;
}
