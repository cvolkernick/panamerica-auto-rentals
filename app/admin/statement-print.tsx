"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { portalRequest } from "@/components/portal/api";
import { PortalForbidden, PortalLogin, PortalNotice, PortalShell } from "@/components/portal/ui";
import { Button } from "@/components/ui/button";
import type { CarStatementJson, SessionJson } from "@/lib/portal/types";

import { statementPath } from "./car-statement";
import { StatementSheet } from "./statement-sheet";

type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "forbidden"; email?: string }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; data: CarStatementJson };

function readQuery(): { carId: number; month: string } | null {
  const params = new URLSearchParams(window.location.search);
  const car = params.get("car") ?? "";
  const month = params.get("month") ?? "";
  if (!/^[1-9]\d{0,9}$/.test(car) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  return { carId: Number(car), month };
}

export function StatementPrint({ mode }: { mode: "owner" | "admin" }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const back = mode === "admin" ? "/admin/" : "/owner/";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const query = readQuery();
      if (!query) {
        if (!cancelled) setState({ kind: "missing" });
        return;
      }
      const session = await portalRequest<SessionJson>("/api/portal/session");
      if (cancelled) return;
      if (session.status === 401) return setState({ kind: "signed-out" });
      if (session.status === 403) return setState({ kind: "forbidden", email: session.error?.email });
      if (!session.ok) return setState({ kind: "error" });
      const result = await portalRequest<CarStatementJson>(statementPath(mode, query.carId, query.month));
      if (cancelled) return;
      if (result.status === 403) return setState({ kind: "forbidden", email: session.data?.email });
      if (result.status === 404) return setState({ kind: "missing" });
      if (!result.ok || !result.data) return setState({ kind: "error" });
      setState({ kind: "ready", data: result.data });
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, reload]);

  if (state.kind === "signed-out") return <PortalLogin onSuccess={() => setReload((value) => value + 1)} />;
  if (state.kind === "forbidden") return <PortalForbidden email={state.email} />;
  if (state.kind !== "ready") {
    const text =
      state.kind === "loading"
        ? "Loading the statement."
        : state.kind === "missing"
          ? "That statement was not found."
          : "Could not load the statement. Refresh and try again.";
    return (
      <PortalShell eyebrow={mode === "admin" ? "Admin" : "Owner"} title="Statement">
        <PortalNotice>{text}</PortalNotice>
      </PortalShell>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 print:max-w-none print:p-0" data-print-statement>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={back} className="font-heading text-xs tracking-[0.16em] text-gold uppercase hover:underline">
          Back
        </Link>
        <Button
          type="button"
          className="h-11 bg-red px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-red/90"
          onClick={() => window.print()}
        >
          Print or save as PDF
        </Button>
      </div>
      <StatementSheet data={state.data} variant="paper" />
    </div>
  );
}
