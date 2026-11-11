"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { portalRequest } from "@/components/portal/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PortalField,
  PortalForbidden,
  PortalLogin,
  PortalLogout,
  PortalNotice,
  PortalShell,
  portalInputClass,
} from "@/components/portal/ui";
import { carAdminHref } from "@/lib/portal/car-path";
import type { CarJson, OwnerJson, PortalErrorJson, SessionJson } from "@/lib/portal/types";
import { parseCarCreate, parseCarPatch, parseOwnerCreate, parseOwnerPatch } from "@/lib/portal/validate";

const primaryButton =
  "h-11 bg-red px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-red/90";
const secondaryButton =
  "h-11 border-white/25 bg-transparent px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-white/10 hover:text-white";
const selectClass = `${portalInputClass} w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5`;

type Gate =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "forbidden"; email?: string }
  | { kind: "not-admin" }
  | { kind: "error" }
  | { kind: "ready" };

type OwnerForm = { name: string; email: string; storedAdmin: string };
type CarForm = {
  ownerId: string;
  year: string;
  make: string;
  model: string;
  color: string;
  licensePlate: string;
  vin: string;
};

const emptyOwner = (): OwnerForm => ({ name: "", email: "", storedAdmin: "0" });
const emptyCar = (): CarForm => ({
  ownerId: "",
  year: "",
  make: "",
  model: "",
  color: "",
  licensePlate: "",
  vin: "",
});

function fieldsFrom(error: PortalErrorJson | null): Record<string, string> {
  return error?.fields ?? {};
}

export function AdminPortal() {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [owners, setOwners] = useState<OwnerJson[]>([]);
  const [cars, setCars] = useState<CarJson[]>([]);
  const [ownerForm, setOwnerForm] = useState<OwnerForm>(emptyOwner);
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [ownerErrors, setOwnerErrors] = useState<Record<string, string>>({});
  const [carForm, setCarForm] = useState<CarForm>(emptyCar);
  const [carId, setCarId] = useState<number | null>(null);
  const [carErrors, setCarErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [inviteOwnerId, setInviteOwnerId] = useState<number | null>(null);
  const [invites, setInvites] = useState<Record<number, { url: string; copied: boolean }>>({});

  useEffect(() => {
    let cancelled = false;
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
      const [ownerResult, carResult] = await Promise.all([
        portalRequest<{ owners: OwnerJson[] }>("/api/portal/admin/owners"),
        portalRequest<{ cars: CarJson[] }>("/api/portal/admin/cars"),
      ]);
      if (cancelled) return;
      if (ownerResult.status === 403 || carResult.status === 403) {
        setGate({ kind: "not-admin" });
        return;
      }
      if (!ownerResult.ok || !ownerResult.data || !carResult.ok || !carResult.data) {
        setGate({ kind: "error" });
        return;
      }
      setEmail(session.data.email);
      setOwners(ownerResult.data.owners);
      setCars(carResult.data.cars);
      setGate({ kind: "ready" });
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function saveOwner(event: FormEvent) {
    event.preventDefault();
    const body = {
      name: ownerForm.name,
      email: ownerForm.email,
      storedAdmin: ownerForm.storedAdmin,
    };
    const parsed = ownerId ? parseOwnerPatch(body) : parseOwnerCreate(body);
    if (!parsed.ok) {
      setOwnerErrors(parsed.fields);
      return;
    }
    setSaving(true);
    setMessage("");
    const result = await portalRequest<{ owner: OwnerJson }>(
      ownerId ? `/api/portal/admin/owners/${ownerId}` : "/api/portal/admin/owners",
      { method: ownerId ? "PATCH" : "POST", body }
    );
    setSaving(false);
    if (!result.ok) {
      setOwnerErrors(fieldsFrom(result.error));
      setMessage(result.network ? "Could not save the owner." : "Could not save the owner.");
      return;
    }
    setOwnerForm(emptyOwner());
    setOwnerId(null);
    setOwnerErrors({});
    setMessage("Owner saved.");
    setReloadToken((value) => value + 1);
  }

  async function saveCar(event: FormEvent) {
    event.preventDefault();
    const body = { ...carForm };
    const parsed = carId ? parseCarPatch(body) : parseCarCreate(body);
    if (!parsed.ok) {
      setCarErrors(parsed.fields);
      return;
    }
    setSaving(true);
    setMessage("");
    const result = await portalRequest<{ car: CarJson }>(
      carId ? `/api/portal/admin/cars/${carId}` : "/api/portal/admin/cars",
      { method: carId ? "PATCH" : "POST", body }
    );
    setSaving(false);
    if (!result.ok) {
      setCarErrors(fieldsFrom(result.error));
      setMessage("Could not save the car.");
      return;
    }
    setCarForm(emptyCar());
    setCarId(null);
    setCarErrors({});
    setMessage("Car saved.");
    setReloadToken((value) => value + 1);
  }

  async function createInvite(id: number) {
    setInviteOwnerId(id);
    setMessage("");
    const result = await portalRequest<{ url: string; expiresAt: string }>(
      `/api/portal/admin/owners/${id}/invite`,
      { method: "POST" }
    );
    setInviteOwnerId(null);
    const url = result.data?.url;
    if (!result.ok || !url) {
      setMessage("Could not create an invite link.");
      return;
    }
    setInvites((current) => ({ ...current, [id]: { url, copied: false } }));
  }

  async function copyInvite(id: number, url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      setMessage("Select the link and copy it.");
      return;
    }
    setInvites((current) => ({ ...current, [id]: { url, copied: true } }));
  }

  async function removeCar(id: number) {
    if (!window.confirm("Delete this car?")) return;
    setSaving(true);
    setMessage("");
    const result = await portalRequest<{ ok: boolean }>(`/api/portal/admin/cars/${id}`, {
      method: "DELETE",
    });
    setSaving(false);
    if (!result.ok) {
      setMessage(
        result.status === 409
          ? "This car has ledger entries. Delete those entries first."
          : "Could not delete the car."
      );
      return;
    }
    if (carId === id) {
      setCarId(null);
      setCarForm(emptyCar());
    }
    setMessage("Car deleted.");
    setReloadToken((value) => value + 1);
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
      <PortalShell eyebrow="Admin" title="Owners and cars">
        <PortalNotice>Loading.</PortalNotice>
      </PortalShell>
    );
  }
  if (gate.kind === "error") {
    return (
      <PortalShell eyebrow="Admin" title="Owners and cars">
        <PortalNotice>Could not load the portal. Refresh and try again.</PortalNotice>
      </PortalShell>
    );
  }

  return (
    <PortalShell
      eyebrow="Admin"
      title="Owners and cars"
      lede={
        <>
          Signed in as {email}. Add an owner, then assign each car to an owner. Create an
          invite link so that owner can set a password. Open a car for its details and
          ledger.{" "}
          <Link href="/owner/" className="text-gold hover:underline">
            Your cars
          </Link>
          .
        </>
      }
      actions={<PortalLogout onDone={() => setReloadToken((value) => value + 1)} />}
    >
      {message ? <PortalNotice>{message}</PortalNotice> : null}

      <section className="mt-14">
        <h2 className="text-2xl font-bold text-white">Owners</h2>
        <form
          className="mt-8 grid gap-5 rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:p-8"
          onSubmit={saveOwner}
        >
          <PortalField id="owner-name" label="Name" error={ownerErrors.name}>
            <Input
              id="owner-name"
              value={ownerForm.name}
              onChange={(event) => setOwnerForm({ ...ownerForm, name: event.target.value })}
              className={portalInputClass}
              aria-invalid={ownerErrors.name ? true : undefined}
              aria-describedby={ownerErrors.name ? "owner-name-error" : undefined}
            />
          </PortalField>
          <PortalField id="owner-email" label="Email" error={ownerErrors.email}>
            <Input
              id="owner-email"
              type="email"
              autoComplete="off"
              value={ownerForm.email}
              onChange={(event) => setOwnerForm({ ...ownerForm, email: event.target.value })}
              className={portalInputClass}
              aria-invalid={ownerErrors.email ? true : undefined}
              aria-describedby={ownerErrors.email ? "owner-email-error" : undefined}
            />
          </PortalField>
          <PortalField id="owner-admin" label="Admin" error={ownerErrors.storedAdmin}>
            <select
              id="owner-admin"
              value={ownerForm.storedAdmin}
              onChange={(event) =>
                setOwnerForm({ ...ownerForm, storedAdmin: event.target.value })
              }
              className={selectClass}
            >
              <option value="0">No</option>
              <option value="1">Yes</option>
            </select>
          </PortalField>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Button type="submit" className={primaryButton} disabled={saving}>
              {ownerId ? "Save owner" : "Add owner"}
            </Button>
            {ownerId ? (
              <Button
                type="button"
                variant="outline"
                className={secondaryButton}
                onClick={() => {
                  setOwnerId(null);
                  setOwnerForm(emptyOwner());
                  setOwnerErrors({});
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
        <ul className="mt-10 grid gap-6 sm:grid-cols-2">
          {owners.map((owner) => {
            const invite = invites[owner.id];
            return (
              <li key={owner.id} className="min-w-0 rounded-xl bg-navy-mid p-6 ring-1 ring-white/10">
                <h3 className="text-2xl font-bold text-white">{owner.name}</h3>
                <p className="mt-3 text-base leading-relaxed text-white/80">{owner.email}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/70">
                  {owner.storedAdmin ? "Admin" : "Owner"}
                  {owner.isAdmin && !owner.storedAdmin ? " (also set on the server)" : ""}
                </p>
                <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    className={secondaryButton}
                    onClick={() => {
                      setOwnerId(owner.id);
                      setOwnerForm({
                        name: owner.name,
                        email: owner.email,
                        storedAdmin: owner.storedAdmin ? "1" : "0",
                      });
                      setOwnerErrors({});
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className={secondaryButton}
                    disabled={inviteOwnerId === owner.id}
                    onClick={() => createInvite(owner.id)}
                  >
                    {inviteOwnerId === owner.id ? "Creating link" : "Create invite link"}
                  </Button>
                </div>
                {invite ? (
                  <div className="mt-4 min-w-0">
                    <p className="text-sm leading-relaxed text-white/70">
                      This link works once and expires in 72 hours. Copy it now. It will not be
                      shown again.
                    </p>
                    <p className="mt-3 break-all text-sm leading-relaxed text-white">{invite.url}</p>
                    <Button
                      type="button"
                      variant="outline"
                      className={`mt-4 ${secondaryButton}`}
                      onClick={() => copyInvite(owner.id, invite.url)}
                    >
                      {invite.copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-14">
        <h2 className="text-2xl font-bold text-white">Cars</h2>
        <form
          className="mt-8 grid gap-5 rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:p-8"
          onSubmit={saveCar}
        >
          <PortalField id="car-owner" label="Owner" error={carErrors.ownerId}>
            <select
              id="car-owner"
              value={carForm.ownerId}
              onChange={(event) => setCarForm({ ...carForm, ownerId: event.target.value })}
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
          <PortalField id="car-year" label="Year" error={carErrors.year}>
            <Input
              id="car-year"
              inputMode="numeric"
              value={carForm.year}
              onChange={(event) => setCarForm({ ...carForm, year: event.target.value })}
              className={portalInputClass}
              aria-invalid={carErrors.year ? true : undefined}
              aria-describedby={carErrors.year ? "car-year-error" : undefined}
            />
          </PortalField>
          <PortalField id="car-make" label="Make" error={carErrors.make}>
            <Input
              id="car-make"
              value={carForm.make}
              onChange={(event) => setCarForm({ ...carForm, make: event.target.value })}
              className={portalInputClass}
            />
          </PortalField>
          <PortalField id="car-model" label="Model" error={carErrors.model}>
            <Input
              id="car-model"
              value={carForm.model}
              onChange={(event) => setCarForm({ ...carForm, model: event.target.value })}
              className={portalInputClass}
            />
          </PortalField>
          <PortalField id="car-color" label="Color" error={carErrors.color}>
            <Input
              id="car-color"
              value={carForm.color}
              onChange={(event) => setCarForm({ ...carForm, color: event.target.value })}
              className={portalInputClass}
            />
          </PortalField>
          <PortalField id="car-plate" label="Plate" error={carErrors.licensePlate}>
            <Input
              id="car-plate"
              autoComplete="off"
              value={carForm.licensePlate}
              onChange={(event) =>
                setCarForm({ ...carForm, licensePlate: event.target.value })
              }
              className={portalInputClass}
            />
          </PortalField>
          <PortalField id="car-vin" label="VIN" error={carErrors.vin}>
            <Input
              id="car-vin"
              autoComplete="off"
              value={carForm.vin}
              onChange={(event) => setCarForm({ ...carForm, vin: event.target.value })}
              className={portalInputClass}
              aria-invalid={carErrors.vin ? true : undefined}
              aria-describedby={carErrors.vin ? "car-vin-error" : undefined}
            />
          </PortalField>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Button type="submit" className={primaryButton} disabled={saving}>
              {carId ? "Save car" : "Add car"}
            </Button>
            {carId ? (
              <Button
                type="button"
                variant="outline"
                className={secondaryButton}
                onClick={() => {
                  setCarId(null);
                  setCarForm(emptyCar());
                  setCarErrors({});
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
        {cars.length === 0 ? (
          <p className="mt-10 text-base leading-relaxed text-white/70">No cars yet.</p>
        ) : (
          <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {cars.map((car) => {
              const href = carAdminHref(car);
              return (
              <li
                key={car.id}
                className="min-w-0 overflow-hidden rounded-xl bg-navy-mid p-6 ring-1 ring-white/10"
              >
                <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
                  {car.year}
                </p>
                <h3 className="mt-2 text-2xl font-bold wrap-anywhere text-white">
                  <a href={href} className="hover:text-gold hover:underline">
                    {car.make} {car.model}
                  </a>
                </h3>
                <p className="mt-3 min-w-0 text-base leading-relaxed wrap-anywhere text-white/80">
                  {car.ownerName ?? "Owner"} · {car.color}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-white/70">
                  Plate{" "}
                  <a href={href} className="text-white hover:text-gold hover:underline">
                    {car.licensePlate.trim() ? car.licensePlate : "No plate"}
                  </a>
                </p>
                <p className="mt-2 min-w-0 text-sm leading-relaxed wrap-anywhere text-white/70">
                  VIN {car.vin}
                </p>
                <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2">
                  <Button variant="outline" className={secondaryButton} asChild>
                    <a href={href}>Ledger</a>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className={secondaryButton}
                    onClick={() => {
                      setCarId(car.id);
                      setCarForm({
                        ownerId: String(car.ownerId),
                        year: String(car.year),
                        make: car.make,
                        model: car.model,
                        color: car.color,
                        licensePlate: car.licensePlate,
                        vin: car.vin,
                      });
                      setCarErrors({});
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className={secondaryButton}
                    disabled={saving}
                    onClick={() => removeCar(car.id)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </section>
    </PortalShell>
  );
}
