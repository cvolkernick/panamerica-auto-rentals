"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { portalRequest } from "@/components/portal/api";
import {
  PortalField,
  PortalForbidden,
  PortalLogin,
  PortalLogout,
  PortalNotice,
  PortalShell,
  portalInputClass,
} from "@/components/portal/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { carAdminHref, plateKeyFromPath } from "@/lib/portal/car-path";
import { isApexHost } from "@/lib/portal/hosts";
import type { CarJson, OwnerJson, PortalErrorJson, SessionJson } from "@/lib/portal/types";
import { parseCarPatch } from "@/lib/portal/validate";

import { CarLedger } from "../car-ledger";

const primaryButton =
  "h-11 bg-red px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-red/90";
const selectClass = `${portalInputClass} w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5`;

type Gate =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "forbidden"; email?: string }
  | { kind: "not-admin" }
  | { kind: "error" }
  | { kind: "no-key" }
  | { kind: "not-found" }
  | { kind: "ready" };

type CarForm = {
  ownerId: string;
  year: string;
  make: string;
  model: string;
  color: string;
  licensePlate: string;
  vin: string;
};

function formFrom(car: CarJson): CarForm {
  return {
    ownerId: String(car.ownerId),
    year: String(car.year),
    make: car.make,
    model: car.model,
    color: car.color,
    licensePlate: car.licensePlate,
    vin: car.vin,
  };
}

function fieldsFrom(error: PortalErrorJson | null): Record<string, string> {
  return error?.fields ?? {};
}

function redirectApexToWww(): boolean {
  if (!isApexHost(window.location.hostname)) return false;
  const target = new URL(window.location.href);
  target.hostname = "www.panamericafleet.com";
  target.protocol = "https:";
  window.location.replace(target.toString());
  return true;
}

function BackToAdmin() {
  return (
    <Link
      href="/admin/"
      className="font-heading text-sm tracking-[0.16em] text-gold uppercase hover:text-white"
    >
      Back
    </Link>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-heading text-xs tracking-[0.16em] text-white/55 uppercase">{label}</dt>
      <dd className="mt-1 min-w-0 text-base leading-relaxed wrap-anywhere text-white">{value}</dd>
    </div>
  );
}

export function CarAdmin() {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [car, setCar] = useState<CarJson | null>(null);
  const [owners, setOwners] = useState<OwnerJson[]>([]);
  const [form, setForm] = useState<CarForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const key = plateKeyFromPath(window.location.pathname);
    if (redirectApexToWww()) return;
    (async () => {
      const session = await portalRequest<SessionJson>("/api/portal/session");
      if (cancelled) return;
      if (session.network || (!session.ok && session.status !== 401 && session.status !== 403)) {
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
      if (!session.data?.owner.isAdmin) {
        setEmail(session.data?.email ?? "");
        setGate({ kind: "not-admin" });
        return;
      }
      setEmail(session.data.email);
      if (!key) {
        setGate({ kind: "no-key" });
        return;
      }
      const [ownerResult, carResult] = await Promise.all([
        portalRequest<{ owners: OwnerJson[] }>("/api/portal/admin/owners"),
        portalRequest<{ car: CarJson }>(
          `/api/portal/admin/cars/by-plate/${encodeURIComponent(key)}`
        ),
      ]);
      if (cancelled) return;
      if (ownerResult.status === 403 || carResult.status === 403) {
        setGate({ kind: "not-admin" });
        return;
      }
      if (carResult.status === 404) {
        setGate({ kind: "not-found" });
        return;
      }
      if (!ownerResult.ok || !ownerResult.data || !carResult.ok || !carResult.data) {
        setGate({ kind: "error" });
        return;
      }
      setOwners(ownerResult.data.owners);
      setCar(carResult.data.car);
      setForm(formFrom(carResult.data.car));
      setGate({ kind: "ready" });
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function saveCar(event: FormEvent) {
    event.preventDefault();
    if (!car || !form) return;
    const parsed = parseCarPatch(form);
    if (!parsed.ok) {
      setErrors(parsed.fields);
      return;
    }
    setSaving(true);
    setMessage("");
    const result = await portalRequest<{ car: CarJson }>(`/api/portal/admin/cars/${car.id}`, {
      method: "PATCH",
      body: form,
    });
    setSaving(false);
    if (!result.ok || !result.data) {
      setErrors(fieldsFrom(result.error));
      setMessage("Could not save the car.");
      return;
    }
    const saved = result.data.car;
    if (saved.licensePlate !== car.licensePlate) {
      window.history.replaceState(window.history.state, "", carAdminHref(saved));
    }
    setCar(saved);
    setForm(formFrom(saved));
    setErrors({});
    setMessage("Car saved.");
  }

  if (gate.kind === "signed-out") {
    return <PortalLogin onSuccess={() => setReloadToken((value) => value + 1)} />;
  }
  if (gate.kind === "forbidden") return <PortalForbidden email={gate.email} />;
  if (gate.kind === "not-admin") {
    return (
      <PortalShell eyebrow="403" title="Admin only">
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70">
          {email ? <>Signed in as {email}. </> : null}
          This login is not an admin.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Link
            href="/owner/"
            className="font-heading text-sm tracking-[0.16em] text-gold uppercase hover:text-white"
          >
            Your cars
          </Link>
          <PortalLogout onDone={() => setReloadToken((value) => value + 1)} />
        </div>
      </PortalShell>
    );
  }
  if (gate.kind === "loading") {
    return (
      <PortalShell eyebrow="Admin" title="Car">
        <PortalNotice>Loading.</PortalNotice>
      </PortalShell>
    );
  }
  if (gate.kind === "error") {
    return (
      <PortalShell eyebrow="Admin" title="Car">
        <PortalNotice>Could not load the portal. Refresh and try again.</PortalNotice>
        <div className="mt-6">
          <BackToAdmin />
        </div>
      </PortalShell>
    );
  }
  if (gate.kind === "no-key") {
    return (
      <PortalShell eyebrow="Admin" title="Car">
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70">
          Open a car from the admin list.
        </p>
        <div className="mt-6">
          <BackToAdmin />
        </div>
      </PortalShell>
    );
  }
  if (gate.kind === "not-found" || !car || !form) {
    return (
      <PortalShell eyebrow="Admin" title="Car not found">
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70">
          That plate is not on a car in the portal.
        </p>
        <div className="mt-6">
          <BackToAdmin />
        </div>
      </PortalShell>
    );
  }

  const plateLabel = car.licensePlate.trim() ? car.licensePlate : "No plate";

  return (
    <PortalShell
      eyebrow="Admin"
      title={`${car.year} ${car.make} ${car.model}`}
      lede={
        <>
          Signed in as {email}. Plate {plateLabel}.
        </>
      }
      actions={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <BackToAdmin />
          <PortalLogout onDone={() => setReloadToken((value) => value + 1)} />
        </div>
      }
    >
      {message ? <PortalNotice>{message}</PortalNotice> : null}

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="car-details-title">
          <h2 id="car-details-title" className="text-2xl font-bold text-white">
            Car
          </h2>
          <dl className="mt-6 grid gap-4 rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:grid-cols-2 sm:p-8">
            <Detail label="Year" value={String(car.year)} />
            <Detail label="Make" value={car.make} />
            <Detail label="Model" value={car.model} />
            <Detail label="Color" value={car.color} />
            <Detail label="Plate" value={plateLabel} />
            <Detail label="VIN" value={car.vin} />
            <Detail label="Added" value={car.createdAt} />
            <Detail label="Updated" value={car.updatedAt} />
          </dl>
        </section>

        <section aria-labelledby="car-owner-title">
          <h2 id="car-owner-title" className="text-2xl font-bold text-white">
            Owner
          </h2>
          <div className="mt-6 rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:p-8">
            <p className="text-2xl font-bold wrap-anywhere text-white">
              {car.ownerName ?? "Owner"}
            </p>
            {car.ownerEmail ? (
              <p className="mt-3 text-base leading-relaxed wrap-anywhere text-white/80">
                {car.ownerEmail}
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <CarLedger car={car} />

      <section className="mt-14" aria-labelledby="car-edit-title">
        <h2 id="car-edit-title" className="text-2xl font-bold text-white">
          Edit car
        </h2>
        <form
          className="mt-8 grid gap-5 rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:p-8"
          onSubmit={saveCar}
        >
          <PortalField id="edit-car-owner" label="Owner" error={errors.ownerId}>
            <select
              id="edit-car-owner"
              value={form.ownerId}
              onChange={(event) => setForm({ ...form, ownerId: event.target.value })}
              className={selectClass}
            >
              <option value="">Choose an owner</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
          </PortalField>
          <PortalField id="edit-car-year" label="Year" error={errors.year}>
            <Input
              id="edit-car-year"
              inputMode="numeric"
              value={form.year}
              onChange={(event) => setForm({ ...form, year: event.target.value })}
              className={portalInputClass}
              aria-invalid={errors.year ? true : undefined}
              aria-describedby={errors.year ? "edit-car-year-error" : undefined}
            />
          </PortalField>
          <PortalField id="edit-car-make" label="Make" error={errors.make}>
            <Input
              id="edit-car-make"
              value={form.make}
              onChange={(event) => setForm({ ...form, make: event.target.value })}
              className={portalInputClass}
            />
          </PortalField>
          <PortalField id="edit-car-model" label="Model" error={errors.model}>
            <Input
              id="edit-car-model"
              value={form.model}
              onChange={(event) => setForm({ ...form, model: event.target.value })}
              className={portalInputClass}
            />
          </PortalField>
          <PortalField id="edit-car-color" label="Color" error={errors.color}>
            <Input
              id="edit-car-color"
              value={form.color}
              onChange={(event) => setForm({ ...form, color: event.target.value })}
              className={portalInputClass}
            />
          </PortalField>
          <PortalField id="edit-car-plate" label="Plate" error={errors.licensePlate}>
            <Input
              id="edit-car-plate"
              autoComplete="off"
              value={form.licensePlate}
              onChange={(event) => setForm({ ...form, licensePlate: event.target.value })}
              className={portalInputClass}
            />
          </PortalField>
          <PortalField id="edit-car-vin" label="VIN" error={errors.vin}>
            <Input
              id="edit-car-vin"
              autoComplete="off"
              value={form.vin}
              onChange={(event) => setForm({ ...form, vin: event.target.value })}
              className={portalInputClass}
              aria-invalid={errors.vin ? true : undefined}
              aria-describedby={errors.vin ? "edit-car-vin-error" : undefined}
            />
          </PortalField>
          <div>
            <Button type="submit" className={primaryButton} disabled={saving}>
              Save car
            </Button>
          </div>
        </form>
      </section>

      <section className="mt-16" aria-labelledby="car-bookings-title">
        <h2 id="car-bookings-title" className="text-2xl font-bold text-white">
          Bookings
        </h2>
        <div className="mt-6 min-h-28 rounded-xl ring-1 ring-white/10" />
      </section>

      <section className="mt-16" aria-labelledby="car-maintenance-title">
        <h2 id="car-maintenance-title" className="text-2xl font-bold text-white">
          Maintenance
        </h2>
        <div className="mt-6 min-h-28 rounded-xl ring-1 ring-white/10" />
      </section>
    </PortalShell>
  );
}
