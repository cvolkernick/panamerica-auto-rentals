import type { Metadata } from "next";

import { ManagerPortal } from "./manager-portal";

export const metadata: Metadata = {
  title: "Managed cars",
  robots: "noindex",
};

export const dynamic = "force-static";

export default function ManagerPage() {
  return <ManagerPortal />;
}
