"use client";

import { useState } from "react";

import { portalRequest, type PortalResult } from "@/components/portal/api";
import { Button } from "@/components/ui/button";

const secondaryButton =
  "h-11 border-white/25 bg-transparent px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-white/10 hover:text-white";

type InviteResult = { url: string; expiresAt: string };

/**
 * One-time invite links per account, shared by the owners list (/admin/) and the managers page
 * (/admin/managers/). Both call an admin route that wraps createOwnerInvite, so the token,
 * 72-hour expiry, and "a new link replaces older unused ones" rule are the same.
 */
export function useInviteLinks() {
  const [invites, setInvites] = useState<Record<number, { url: string; copied: boolean }>>({});
  const [pendingId, setPendingId] = useState<number | null>(null);

  async function create(id: number, path: string, body?: unknown): Promise<PortalResult<InviteResult>> {
    setPendingId(id);
    const result = await portalRequest<InviteResult>(path, body === undefined ? { method: "POST" } : { method: "POST", body });
    setPendingId(null);
    const url = result.data?.url;
    if (result.ok && url) setInvites((current) => ({ ...current, [id]: { url, copied: false } }));
    return result;
  }

  /** Returns false when the clipboard is unavailable, so the page can ask for a manual copy. */
  async function copy(id: number): Promise<boolean> {
    const invite = invites[id];
    if (!invite) return false;
    try {
      await navigator.clipboard.writeText(invite.url);
    } catch {
      return false;
    }
    setInvites((current) => ({ ...current, [id]: { url: invite.url, copied: true } }));
    return true;
  }

  return { invites, pendingId, create, copy };
}

export function InviteLinkPanel({
  url,
  copied,
  onCopy,
}: {
  url: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-4 min-w-0">
      <p className="text-sm leading-relaxed text-white/70">
        This link works once and expires in 72 hours. Copy it now. It will not be shown again.
      </p>
      <p className="mt-3 break-all text-sm leading-relaxed text-white">{url}</p>
      <Button type="button" variant="outline" className={`mt-4 ${secondaryButton}`} onClick={onCopy}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
