"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { portalRequest } from "@/components/portal/api";
import { PortalLogin, PortalLogout, PortalNotice, PortalShell } from "@/components/portal/ui";
import {
  sessionRoleFlags,
  signInRoute,
  type PortalDestination,
} from "@/lib/portal/destinations";
import type { SessionJson } from "@/lib/portal/types";

type Gate =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "redirecting"; href: string }
  | { kind: "choose"; email: string; options: PortalDestination[] }
  | { kind: "none"; email?: string }
  | { kind: "error" };

/**
 * One sign-in page for every portal role. There is no sign-up: accounts are
 * created by an admin invite. A failed sign-in shows the same generic message
 * as the portal pages, whatever the reason.
 */
export function SignInPortal() {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await portalRequest<SessionJson>("/api/portal/session");
      if (cancelled) return;
      if (session.network) return setGate({ kind: "error" });
      if (session.status === 401) return setGate({ kind: "signed-out" });
      if (session.status === 403) return setGate({ kind: "none", email: session.error?.email });
      if (!session.ok || !session.data) return setGate({ kind: "error" });
      const route = signInRoute(sessionRoleFlags(session.data));
      if (route.kind === "redirect") {
        setGate({ kind: "redirecting", href: route.href });
        window.location.replace(route.href);
        return;
      }
      if (route.kind === "choose") {
        return setGate({ kind: "choose", email: session.data.email, options: route.options });
      }
      setGate({ kind: "none", email: session.data.email });
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = () => setReloadToken((value) => value + 1);

  if (gate.kind === "signed-out") {
    return (
      <PortalLogin
        title="Sign in"
        lede="For Panamerica owners, managers and team. Accounts are set up by invite."
        footer={
          <p className="text-sm leading-relaxed text-white/70">
            Renting with us?{" "}
            <Link href="/fleet/" className="text-gold hover:underline">
              Book through our fleet page.
            </Link>
          </p>
        }
        onSuccess={reload}
      />
    );
  }
  if (gate.kind === "loading" || gate.kind === "redirecting") {
    return (
      <PortalShell eyebrow="Sign in" title="Sign in">
        <PortalNotice>{gate.kind === "loading" ? "Checking your sign-in." : "Opening your portal."}</PortalNotice>
      </PortalShell>
    );
  }
  if (gate.kind === "error") {
    return (
      <PortalShell eyebrow="Sign in" title="Sign in">
        <PortalNotice>Could not reach sign-in. Check your connection and try again.</PortalNotice>
      </PortalShell>
    );
  }
  if (gate.kind === "none") {
    return (
      <PortalShell
        eyebrow="Sign in"
        title="No portal for this login"
        lede={
          <>
            {gate.email ? <>Signed in as {gate.email}. </> : null}
            This login does not have portal access yet.
          </>
        }
        actions={<PortalLogout onDone={reload} />}
      />
    );
  }

  return (
    <PortalShell
      eyebrow="Sign in"
      title="Choose a view"
      lede={<>Signed in as {gate.email}. You can switch views at any time from the top of each page.</>}
      actions={<PortalLogout onDone={reload} />}
    >
      <ul className="mt-8 grid max-w-2xl gap-4 sm:grid-cols-2">
        {gate.options.map((option) => (
          <li key={option.role}>
            <Link
              href={option.href}
              className="block h-full rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 transition-colors hover:ring-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              <span className="font-heading text-sm tracking-[0.16em] text-white uppercase">
                {option.label}
              </span>
              <span className="mt-2 block text-sm leading-relaxed text-white/70">
                {option.description}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </PortalShell>
  );
}
