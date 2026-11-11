import type { Metadata } from "next";

import { InvitePortal } from "./invite-portal";

export const metadata: Metadata = {
  title: "Set your password",
  robots: "noindex",
  referrer: "no-referrer",
};

export const dynamic = "force-static";

export default function OwnerInvitePage() {
  return <InvitePortal />;
}
