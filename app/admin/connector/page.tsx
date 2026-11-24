import type { Metadata } from "next";

import { ConnectorDocs } from "./connector-docs";

export const metadata: Metadata = {
  title: "Team connector (MCP)",
  robots: "noindex",
};

export const dynamic = "force-static";

export default function ConnectorPage() {
  return <ConnectorDocs />;
}
