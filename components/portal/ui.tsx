"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { portalRequest, setPortalCsrf } from "@/components/portal/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const portalInputClass =
  "h-11 border-white/15 bg-white/5 text-base text-white md:text-base";

const primaryButton =
  "h-11 bg-red px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-red/90";
const secondaryButton =
  "h-11 border-white/25 bg-transparent px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-white/10 hover:text-white";

export function PortalShell({
  eyebrow,
  title,
  lede,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
      <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-3 text-4xl font-bold text-white sm:text-5xl">{title}</h1>
      {lede ? (
        <div className="mt-4 max-w-2xl text-base leading-relaxed text-white/70">
          {lede}
        </div>
      ) : null}
      {actions ? <div className="mt-6">{actions}</div> : null}
      {children}
    </div>
  );
}

export function PortalField({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label
        htmlFor={id}
        className="font-heading tracking-[0.12em] text-white/80 uppercase"
      >
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm leading-relaxed text-white/80">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function PortalForbidden({ email }: { email?: string }) {
  return (
    <PortalShell eyebrow="403" title="This login is not an owner">
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70">
        {email ? <>Signed in as {email}. </> : null}
        Panamerica has not added this email as an owner.
      </p>
    </PortalShell>
  );
}

export function PortalLogin({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const result = await portalRequest("/api/portal/login", {
      method: "POST",
      body: { email, password },
    });
    setSubmitting(false);
    if (result.ok) {
      setPassword("");
      onSuccess();
      return;
    }
    if (result.status === 429) {
      setError("Too many sign-in attempts. Wait and try again.");
      return;
    }
    if (result.status === 403 && result.error?.reason === "host_not_allowed") {
      setError("Sign-in is not available on this address. Use www.panamericafleet.com.");
      return;
    }
    if (result.status === 401) {
      setError("That email or password is not valid.");
      return;
    }
    setError("Could not sign in. Try again.");
  }

  return (
    <PortalShell
      eyebrow="Sign in"
      title="Owner sign-in"
      lede="Use the email and password for your owner account."
    >
      <form
        className="mt-8 grid max-w-md gap-5 rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:p-8"
        onSubmit={onSubmit}
      >
        <PortalField id="portal-email" label="Email">
          <Input
            id="portal-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={portalInputClass}
            required
          />
        </PortalField>
        <PortalField id="portal-password" label="Password">
          <Input
            id="portal-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={portalInputClass}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "portal-login-error" : undefined}
          />
        </PortalField>
        {error ? (
          <p id="portal-login-error" role="alert" className="text-sm leading-relaxed text-white/80">
            {error}
          </p>
        ) : null}
        <Button type="submit" className={primaryButton} disabled={submitting}>
          {submitting ? "Signing in" : "Sign in"}
        </Button>
      </form>
    </PortalShell>
  );
}

export function PortalLogout({ onDone }: { onDone: () => void }) {
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    await portalRequest("/api/portal/logout", { method: "POST" });
    setPortalCsrf("");
    setPending(false);
    onDone();
  }

  return (
    <Button
      type="button"
      variant="outline"
      className={secondaryButton}
      onClick={logout}
      disabled={pending}
    >
      Log out
    </Button>
  );
}

export function PortalNotice({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 text-base leading-relaxed text-white/70" role="status">
      {children}
    </p>
  );
}
