"use client";

import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";

export const portalInputClass =
  "h-11 border-white/15 bg-white/5 text-base text-white md:text-base";

export function PortalShell({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede?: ReactNode;
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

export function PortalSignedOut() {
  return (
    <PortalShell eyebrow="Sign in" title="Owner sign-in required">
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70">
        This page is for vehicle owners. Use the email one-time code for your
        owner login, then reload.
      </p>
    </PortalShell>
  );
}

export function PortalNotice({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 text-base leading-relaxed text-white/70" role="status">
      {children}
    </p>
  );
}
