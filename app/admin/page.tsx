import type { Metadata } from "next";

import { AdminPortal } from "./admin-portal";

export const metadata: Metadata = {
  title: "Owners and cars",
  robots: "noindex",
};

export const dynamic = "force-static";

export default function AdminPage() {
  return <AdminPortal />;
}
