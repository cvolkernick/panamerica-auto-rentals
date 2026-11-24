import type { Metadata } from "next";

import { ManagersAdmin } from "./managers-admin";

export const metadata: Metadata = {
  title: "Managers",
  robots: "noindex",
};

export const dynamic = "force-static";

export default function ManagersAdminPage() {
  return <ManagersAdmin />;
}
