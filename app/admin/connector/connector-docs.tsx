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
import type { SessionJson } from "@/lib/portal/types";

// This page is only a loader. The connector's capability list is served to admins by
// GET /api/portal/admin/connector-capabilities and never ships in the static bundle.
// Do not import lib/portal/connector-capabilities here (tests/build/connector-bundle.test.ts).

type Tool = { name: string; access: "read" | "write"; summary: string };

type Capabilities = {
  title: string;
  updated: string;
  version: string;
  expenseCategories: string[];
  tools: Tool[];
  notSupported: string[];
  rules: string[];
};

type Gate =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "forbidden"; email?: string }
  | { kind: "not-admin" }
  | { kind: "error" }
  | { kind: "ready"; data: Capabilities };

const PAGE_TITLE = "Team connector (MCP)";
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
      if (!session.data.owner.isAdmin) return setGate({ kind: "not-admin" });
      const result = await portalRequest<Capabilities>("/api/portal/admin/connector-capabilities");
      if (cancelled) return;
      if (result.status === 401) return setGate({ kind: "signed-out" });
      if (result.status === 403) return setGate({ kind: "not-admin" });
      if (!result.ok || !result.data) return setGate({ kind: "error" });
      setGate({ kind: "ready", data: result.data });
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
      <PortalShell eyebrow="Admin" title={PAGE_TITLE}>
        <PortalNotice>{text}</PortalNotice>
      </PortalShell>
    );
  }

  const data = gate.data;
  const reads = data.tools.filter((tool) => tool.access === "read");
  const writes = data.tools.filter((tool) => tool.access === "write");

  return (
    <PortalShell
      eyebrow="Admin"
      title={data.title}
      lede={
        <>
          Updated {data.updated} · {data.version}.{" "}
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
            Expense categories: {data.expenseCategories.join(", ")}.
          </p>
        </section>

        <section aria-labelledby="connector-cannot">
          <h2 id="connector-cannot" className={heading}>
            Can&apos;t do
          </h2>
          <ul className="mt-4 space-y-2 text-sm leading-relaxed text-white/75">
            {data.notSupported.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden className="text-red">
                  ✕
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h2 className={`${heading} mt-10`}>Rules</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-white/75">
            {data.rules.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>
    </PortalShell>
  );
}

function ToolList({ label, tools }: { label: string; tools: Tool[] }) {
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
