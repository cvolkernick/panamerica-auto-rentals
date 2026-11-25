import type { Metadata } from "next";

import { InvitePortal } from "../../owner/invite/invite-portal";

export const metadata: Metadata = {
  title: "Set your password",
  robots: "noindex",
  referrer: "no-referrer",
};

export const dynamic = "force-static";

/** Manager invite: same token and GET/POST /api/portal/invite as the owner invite. */
export default function ManagerInvitePage() {
  return <InvitePortal signInHref="/manager/" />;
}
