"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { portalRequest } from "@/components/portal/api";
import {
  PortalForbidden,
  PortalNotice,
  PortalShell,
  PortalSignedOut,
} from "@/components/portal/ui";
import type { CarJson, SessionJson } from "@/lib/portal/types";

type Gate =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "forbidden"; email?: string }
  | { kind: "error" }
  | { kind: "ready"; session: SessionJson; cars: CarJson[] };

function CarFacts({ car }: { car: CarJson }) {
  const facts = [
    ["Color", car.color],
    ["Plate", car.licensePlate],
    ["VIN", car.vin],
  ] as const;
  return (
    <article className="rounded-xl bg-navy-mid p-6 ring-1 ring-white/10">
      <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
        {car.year}
      </p>
      <h2 className="mt-2 text-2xl font-bold text-white">
        {car.make} {car.model}
      </h2>
      <dl className="mt-6 divide-y divide-white/10">
        {facts.map(([term, value]) => (
          <div
            key={term}
            className="grid gap-1 py-4 sm:grid-cols-[13rem_1fr] sm:items-baseline"
          >
            <dt className="font-heading text-xs tracking-[0.16em] text-white/55 uppercase">
              {term}
            </dt>
            <dd className="text-base text-white">{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function OwnerPortal() {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await portalRequest<SessionJson>("/api/portal/session");
      if (cancelled) return;
      if (session.network) {
        setGate({ kind: "error" });
        return;
      }
      if (session.status === 401) {
        setGate({ kind: "signed-out" });
        return;
      }
      if (session.status === 403) {
        setGate({ kind: "forbidden", email: session.error?.email });
        return;
      }
      if (!session.ok || !session.data) {
        setGate({ kind: "error" });
        return;
      }
      const cars = await portalRequest<{ cars: CarJson[] }>("/api/portal/cars");
      if (cancelled) return;
      if (cars.status === 403) {
        setGate({ kind: "forbidden", email: session.data.email });
        return;
      }
      if (!cars.ok || !cars.data) {
        setGate({ kind: "error" });
        return;
      }
      setGate({ kind: "ready", session: session.data, cars: cars.data.cars });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate.kind === "signed-out") return <PortalSignedOut />;
  if (gate.kind === "forbidden") return <PortalForbidden email={gate.email} />;
  if (gate.kind === "loading") {
    return (
      <PortalShell eyebrow="Owner" title="Your cars">
        <PortalNotice>Loading your cars.</PortalNotice>
      </PortalShell>
    );
  }
  if (gate.kind === "error") {
    return (
      <PortalShell eyebrow="Owner" title="Your cars">
        <PortalNotice>Could not load your cars. Refresh and try again.</PortalNotice>
      </PortalShell>
    );
  }

  return (
    <PortalShell
      eyebrow="Owner"
      title="Your cars"
      lede={
        <>
          Signed in as {gate.session.email}. This list is only for your cars.
          {gate.session.owner.isAdmin ? (
            <>
              {" "}
              <Link
                href="/admin/"
                className="text-gold hover:underline"
              >
                Open admin
              </Link>
              .
            </>
          ) : null}
        </>
      }
    >
      {gate.cars.length === 0 ? (
        <p className="mt-10 text-base leading-relaxed text-white/70">No cars yet.</p>
      ) : (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {gate.cars.map((car) => (
            <li key={car.id}>
              <CarFacts car={car} />
            </li>
          ))}
        </ul>
      )}
    </PortalShell>
  );
}
