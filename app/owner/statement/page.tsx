import type { Metadata } from "next";

import { StatementPrint } from "../../admin/statement-print";

export const metadata: Metadata = {
  title: "Statement",
  robots: "noindex",
};

export const dynamic = "force-static";

export default function StatementPage() {
  return <StatementPrint mode="owner" />;
}
