"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { portalRequest } from "@/components/portal/api";
import {
  PortalForbidden,
  PortalLogin,
  PortalNotice,
  PortalShell,
} from "@/components/portal/ui";
import {
  CONNECTOR_DOC,
  CONNECTOR_EXPENSE_CATEGORIES,
  CONNECTOR_NOT_SUPPORTED,
  CONNECTOR_RULES,
  CONNECTOR_TOOLS,
} from "@/lib/portal/connector-capabilities";
import type { SessionJson } from "@/lib/portal/types";

type Gate =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "forbidden"; email?: string }
  | { kind: "not-admin" }
  | { kind: "error" }
  | { kind: "ready" };

const heading = "font-heading text-sm tracking-[0.2em] text-gold uppercase";

export function ConnectorDocs() {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await portalRequest<SessionJson>("/api/portal/session");
      if (cancelled) return;
      if (session.status === 401) return setGate({ kind: "signed-out" });
      if (session.status === 403) return setGate({ kind: "forbidden", email: session.error?.email });
      if (session.network || !session.ok || !session.data) return setGate({ kind: "error" });
      setGate(session.data.owner.isAdmin ? { kind: "ready" } : { kind: "not-admin" });
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  if (gate.kind === "signed-out") {
    return <PortalLogin onSuccess={() => setReloadToken((value) => value + 1)} />;
  }
  if (gate.kind === "forbidden") return <PortalForbidden email={gate.email} />;
  if (gate.kind !== "ready") {
    const text =
      gate.kind === "loading"
        ? "Loading."
        : gate.kind === "not-admin"
          ? "This page is for admins."
          : "Could not load the page. Refresh and try again.";
    return (
      <PortalShell eyebrow="Admin" title={CONNECTOR_DOC.title}>
        <PortalNotice>{text}</PortalNotice>
      </PortalShell>
    );
  }

  const reads = CONNECTOR_TOOLS.filter((tool) => tool.access === "read");
  const writes = CONNECTOR_TOOLS.filter((tool) => tool.access === "write");

  return (
    <PortalShell
      eyebrow="Admin"
      title={CONNECTOR_DOC.title}
      lede={
        <>
          What team agents can and can&apos;t do to car records through the connector.
          Updated {CONNECTOR_DOC.updated} · {CONNECTOR_DOC.version}.{" "}
          <Link href="/admin/" className="text-gold hover:underline">
            Back to owners and cars
          </Link>
          .
        </>
      }
    >
      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="connector-can">
          <h2 id="connector-can" className={heading}>
            Can do
          </h2>
          <ToolList label="Read" tools={reads} />
          <ToolList label="Write" tools={writes} />
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            Expense categories: {CONNECTOR_EXPENSE_CATEGORIES.join(", ")}.
          </p>
        </section>

        <section aria-labelledby="connector-cannot">
          <h2 id="connector-cannot" className={heading}>
            Can&apos;t do
          </h2>
          <ul className="mt-4 space-y-2 text-sm leading-relaxed text-white/75">
            {CONNECTOR_NOT_SUPPORTED.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden className="text-red">
                  ✕
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h2 className={`${heading} mt-10`}>Rules on every write</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-white/75">
            {CONNECTOR_RULES.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>
    </PortalShell>
  );
}

function ToolList({ label, tools }: { label: string; tools: readonly (typeof CONNECTOR_TOOLS)[number][] }) {
  return (
    <div className="mt-5">
      <h3 className="text-xs font-semibold tracking-[0.16em] text-white/50 uppercase">{label}</h3>
      <ul className="mt-2 divide-y divide-white/10 border-y border-white/10">
        {tools.map((tool) => (
          <li key={tool.name} className="py-2.5">
            <code className="text-sm text-white">{tool.name}</code>
            <p className="mt-0.5 text-sm leading-relaxed text-white/65">{tool.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
