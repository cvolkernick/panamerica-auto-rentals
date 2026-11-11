"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { portalRequest } from "@/components/portal/api";
import { PortalField, PortalShell, portalInputClass } from "@/components/portal/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { encodeDerived, derivePortalKey, passwordAcceptable } from "@/lib/portal/derive";

const primaryButton =
  "h-11 bg-red px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-red/90";

type InviteInfo = { email: string; emailMasked: string };

type Gate =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "limited" }
  | { kind: "error" }
  | { kind: "ready"; token: string; info: InviteInfo }
  | { kind: "done" };

function tokenFromLocation(): string {
  const token = new URLSearchParams(window.location.search).get("t") ?? "";
  if (!token || token.length > 200 || /[^A-Za-z0-9_-]/.test(token)) return "";
  return token;
}

export function InvitePortal() {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = tokenFromLocation();
      if (!token) {
        if (!cancelled) setGate({ kind: "invalid" });
        return;
      }
      const result = await portalRequest<InviteInfo>(
        `/api/portal/invite?t=${encodeURIComponent(token)}`
      );
      if (cancelled) return;
      if (result.status === 429) {
        setGate({ kind: "limited" });
        return;
      }
      if (!result.ok || !result.data?.email || !result.data.emailMasked) {
        setGate(result.network || result.status >= 500 ? { kind: "error" } : { kind: "invalid" });
        return;
      }
      setGate({ kind: "ready", token, info: result.data });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (gate.kind !== "ready") return;
    if (!passwordAcceptable(password)) {
      setError("Use 12 to 128 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setError("");
    setSubmitting(true);
    let derived: string;
    try {
      derived = encodeDerived(await derivePortalKey(gate.info.email, password));
    } catch {
      setSubmitting(false);
      setError("Could not set the password. Try again.");
      return;
    }
    const result = await portalRequest("/api/portal/invite", {
      method: "POST",
      body: { token: gate.token, derived },
    });
    setSubmitting(false);
    setPassword("");
    setConfirm("");
    if (result.ok) {
      setGate({ kind: "done" });
      return;
    }
    if (result.status === 429) {
      setError("Too many attempts. Wait and try again.");
      return;
    }
    if (result.status === 400 && result.error?.error === "invite_invalid") {
      setGate({ kind: "invalid" });
      return;
    }
    setError("Could not set the password. Try again.");
  }

  if (gate.kind === "loading") {
    return (
      <PortalShell eyebrow="Invite" title="Set your password">
        <p className="mt-4 text-base leading-relaxed text-white/70">Checking this invite link.</p>
      </PortalShell>
    );
  }

  if (gate.kind === "invalid") {
    return (
      <PortalShell eyebrow="Invite" title="This link is not valid">
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70">
          This invite link is invalid, expired, or already used. Ask Panamerica for a new link.
        </p>
      </PortalShell>
    );
  }

  if (gate.kind === "limited") {
    return (
      <PortalShell eyebrow="Invite" title="Set your password">
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70">
          Too many attempts. Wait and try again.
        </p>
      </PortalShell>
    );
  }

  if (gate.kind === "error") {
    return (
      <PortalShell eyebrow="Invite" title="Set your password">
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70">
          Could not check this invite link. Refresh and try again.
        </p>
      </PortalShell>
    );
  }

  if (gate.kind === "done") {
    return (
      <PortalShell
        eyebrow="Invite"
        title="Password saved"
        lede="Sign in with your email and the password you chose."
      >
        <Link
          href="/owner/"
          className="mt-6 inline-block font-heading text-sm tracking-[0.16em] text-gold uppercase hover:text-white"
        >
          Sign in
        </Link>
      </PortalShell>
    );
  }

  return (
    <PortalShell
      eyebrow="Invite"
      title="Set your password"
      lede={`Choose a password for ${gate.info.emailMasked}. This link works once.`}
    >
      <form
        className="mt-8 grid max-w-md gap-5 rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:p-8"
        onSubmit={onSubmit}
      >
        <PortalField id="invite-password" label="Password">
          <Input
            id="invite-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={portalInputClass}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "invite-password-hint invite-form-error" : "invite-password-hint"}
          />
        </PortalField>
        <p id="invite-password-hint" className="-mt-3 text-sm leading-relaxed text-white/60">
          Use 12 to 128 characters.
        </p>
        <PortalField id="invite-confirm" label="Confirm password">
          <Input
            id="invite-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className={portalInputClass}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "invite-form-error" : undefined}
          />
        </PortalField>
        {error ? (
          <p id="invite-form-error" role="alert" className="text-sm leading-relaxed text-white/80">
            {error}
          </p>
        ) : null}
        <Button type="submit" className={primaryButton} disabled={submitting}>
          {submitting ? "Saving" : "Save password"}
        </Button>
      </form>
    </PortalShell>
  );
}
