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
import { carAdminHref } from "@/lib/portal/car-path";
import { formatMonthLabel, formatUsdFromCents, todayEastern } from "@/lib/portal/ledger";
import {
  bpsToPercentLabel,
  percentToBps,
  type AssignmentJson,
  type ManagerAccrual,
  type ManagerJson,
} from "@/lib/portal/managers";
import type { CarJson, PortalErrorJson, SessionJson } from "@/lib/portal/types";

const primaryButton =
  "h-11 bg-red px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-red/90";
const secondaryButton =
  "h-11 border-white/25 bg-transparent px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-white/10 hover:text-white";
const selectClass = `${portalInputClass} w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5`;
const card = "rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:p-8";
const th = "py-2 pr-4 text-left font-heading text-xs tracking-[0.14em] text-white/55 uppercase";
const td = "py-2 pr-4 align-top text-white/90";

type Gate =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "forbidden"; email?: string }
  | { kind: "not-admin" }
  | { kind: "error" }
  | { kind: "ready" };

type ManagerRow = ManagerJson & {
  currentCars: AssignmentJson[];
  accruedCents: number;
  feeCents: number;
  tripCount: number;
};

type Detail = { manager: ManagerJson; assignments: AssignmentJson[]; accrual: ManagerAccrual };

function fieldsFrom(error: PortalErrorJson | null): Record<string, string> {
  return error?.fields ?? {};
}

function carLabel(car: { year: number; make: string; model: string; licensePlate: string }): string {
  return `${car.year} ${car.make} ${car.model}${car.licensePlate ? ` (${car.licensePlate})` : ""}`;
}

function usd(cents: number): string {
  return formatUsdFromCents(cents);
}

function shareLabel(bps: number | null): string {
  return bps === null ? "Not started" : bpsToPercentLabel(bps);
}

export function ManagersAdmin() {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [managers, setManagers] = useState<ManagerRow[]>([]);
  const [current, setCurrent] = useState<AssignmentJson[]>([]);
  const [cars, setCars] = useState<CarJson[]>([]);
  const [form, setForm] = useState({ name: "", percent: "", effectiveFrom: todayEastern() });
  const [rateForm, setRateForm] = useState({ percent: "", effectiveFrom: todayEastern() });
  const [rateErrors, setRateErrors] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [assign, setAssign] = useState<Record<number, { managerId: string; startDate: string }>>({});
  const [assignErrors, setAssignErrors] = useState<Record<number, Record<string, string>>>({});
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await portalRequest<SessionJson>("/api/portal/session");
      if (cancelled) return;
      if (session.network || (!session.ok && session.status !== 401 && session.status !== 403)) {
        setGate({ kind: "error" });
        return;
      }
      if (session.status === 401) return setGate({ kind: "signed-out" });
      if (session.status === 403) return setGate({ kind: "forbidden", email: session.error?.email });
      if (!session.data?.owner.isAdmin) {
        setEmail(session.data?.email ?? "");
        return setGate({ kind: "not-admin" });
      }
      const [managerResult, carResult] = await Promise.all([
        portalRequest<{ managers: ManagerRow[]; currentAssignments: AssignmentJson[] }>(
          "/api/portal/admin/managers"
        ),
        portalRequest<{ cars: CarJson[] }>("/api/portal/admin/cars"),
      ]);
      if (cancelled) return;
      if (!managerResult.ok || !managerResult.data || !carResult.ok || !carResult.data) {
        return setGate({ kind: "error" });
      }
      setEmail(session.data.email);
      setManagers(managerResult.data.managers);
      setCurrent(managerResult.data.currentAssignments);
      setCars(carResult.data.cars);
      setGate({ kind: "ready" });
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function openDetail(id: number) {
    const result = await portalRequest<Detail>(`/api/portal/admin/managers/${id}`);
    if (result.ok && result.data) setDetail(result.data);
    else setMessage("Could not load that manager.");
  }

  async function saveManager(event: FormEvent) {
    event.preventDefault();
    const shareBps = percentToBps(form.percent);
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Enter a name.";
    if (!editId && shareBps === null) next.shareBps = "Enter a percent from 0 to 100, up to two decimals.";
    if (Object.keys(next).length) return setErrors(next);
    setSaving(true);
    setMessage("");
    const result = await portalRequest<{ manager: ManagerJson }>(
      editId ? `/api/portal/admin/managers/${editId}` : "/api/portal/admin/managers",
      editId
        ? { method: "PATCH", body: { name: form.name } }
        : { method: "POST", body: { name: form.name, shareBps, effectiveFrom: form.effectiveFrom } }
    );
    setSaving(false);
    if (!result.ok) {
      setErrors(fieldsFrom(result.error));
      return setMessage("Could not save the manager.");
    }
    setErrors({});
    setForm({ name: "", percent: "", effectiveFrom: todayEastern() });
    setMessage(editId ? "Manager saved." : "Manager added.");
    if (editId && detail?.manager.id === editId) await openDetail(editId);
    setEditId(null);
    setReloadToken((value) => value + 1);
  }

  async function addRate(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    const shareBps = percentToBps(rateForm.percent);
    if (shareBps === null) return setRateErrors({ shareBps: "Enter a percent from 0 to 100, up to two decimals." });
    setSaving(true);
    setMessage("");
    const result = await portalRequest<Detail>(`/api/portal/admin/managers/${detail.manager.id}/rates`, {
      method: "POST",
      body: { shareBps, effectiveFrom: rateForm.effectiveFrom },
    });
    setSaving(false);
    if (!result.ok || !result.data) {
      setRateErrors(fieldsFrom(result.error));
      return setMessage("Could not change the share.");
    }
    setRateErrors({});
    setRateForm({ percent: "", effectiveFrom: todayEastern() });
    setDetail(result.data);
    setMessage("Share change saved. It applies from its date forward; earlier trips keep their rate.");
    setReloadToken((value) => value + 1);
  }

  function assignFor(carId: number) {
    const open = current.find((row) => row.carId === carId);
    return assign[carId] ?? { managerId: open ? String(open.managerId) : "", startDate: todayEastern() };
  }

  async function saveAssignment(carId: number) {
    const value = assignFor(carId);
    setSaving(true);
    setMessage("");
    const result = await portalRequest(`/api/portal/admin/cars/${carId}/managers`, {
      method: "POST",
      body: { managerId: value.managerId === "" ? null : Number(value.managerId), startDate: value.startDate },
    });
    setSaving(false);
    if (!result.ok) {
      setAssignErrors((prev) => ({ ...prev, [carId]: fieldsFrom(result.error) }));
      return setMessage("Could not change the manager.");
    }
    setAssignErrors((prev) => ({ ...prev, [carId]: {} }));
    setAssign((prev) => {
      const next = { ...prev };
      delete next[carId];
      return next;
    });
    setMessage("Manager updated.");
    if (detail) await openDetail(detail.manager.id);
    setReloadToken((v) => v + 1);
  }

  async function undo(carId: number) {
    setSaving(true);
    const result = await portalRequest(`/api/portal/admin/cars/${carId}/managers/undo`, { method: "POST" });
    setSaving(false);
    setMessage(result.ok ? "Last manager change undone." : "Nothing to undo for that car.");
    if (detail) await openDetail(detail.manager.id);
    setReloadToken((v) => v + 1);
  }

  if (gate.kind === "signed-out") return <PortalLogin onSuccess={() => setReloadToken((v) => v + 1)} />;
  if (gate.kind === "forbidden") return <PortalForbidden email={gate.email} />;
  if (gate.kind === "not-admin") {
    return (
      <PortalShell eyebrow="403" title="Admin only">
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70">
          {email ? <>Signed in as {email}. </> : null}This login is not an admin.
        </p>
      </PortalShell>
    );
  }
  if (gate.kind === "loading" || gate.kind === "error") {
    return (
      <PortalShell eyebrow="Admin" title="Managers">
        <PortalNotice>{gate.kind === "loading" ? "Loading." : "Could not load the portal. Refresh and try again."}</PortalNotice>
      </PortalShell>
    );
  }

  return (
    <PortalShell
      eyebrow="Admin"
      title="Managers"
      lede={
        <>
          Signed in as {email}. Each manager earns one share of the company fee on every trip
          that starts while they manage the car. Each car has one manager at a time; reassigning
          keeps the history. Payouts to managers and reimbursement claims come in a later phase.
        </>
      }
      actions={
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/admin/" className="font-heading text-sm tracking-[0.16em] text-gold uppercase hover:text-white">
            Back
          </Link>
          <PortalLogout onDone={() => setReloadToken((v) => v + 1)} />
        </div>
      }
    >
      {message ? <PortalNotice>{message}</PortalNotice> : null}

      <section className="mt-14" aria-labelledby="managers-title">
        <h2 id="managers-title" className="text-2xl font-bold text-white">
          Managers
        </h2>
        <div className={`mt-6 overflow-x-auto ${card}`}>
          {managers.length === 0 ? (
            <p className="text-white/70">No managers yet. Add one below.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Share</th>
                  <th className={th}>Current cars</th>
                  <th className={th}>Trips</th>
                  <th className={th}>Company fee</th>
                  <th className={th}>Accrued share</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {managers.map((m) => (
                  <tr key={m.id} className="border-t border-white/10">
                    <td className={td}>{m.name}</td>
                    <td className={td}>
                      {shareLabel(m.shareBps)}
                      {m.nextRate ? (
                        <span className="block text-xs text-white/55">
                          {bpsToPercentLabel(m.nextRate.shareBps)} from {m.nextRate.effectiveFrom}
                        </span>
                      ) : null}
                    </td>
                    <td className={td}>
                      {m.currentCars.length === 0
                        ? "None"
                        : m.currentCars.map((a) => (a.car ? carLabel(a.car) : `Car ${a.carId}`)).join(", ")}
                    </td>
                    <td className={td}>{m.tripCount}</td>
                    <td className={td}>{usd(m.feeCents)}</td>
                    <td className={`${td} font-bold text-white`}>{usd(m.accruedCents)}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      <button type="button" className="text-gold hover:underline" onClick={() => openDetail(m.id)}>
                        Details
                      </button>{" "}
                      ·{" "}
                      <button
                        type="button"
                        className="text-gold hover:underline"
                        onClick={() => {
                          setEditId(m.id);
                          setForm({ name: m.name, percent: "", effectiveFrom: todayEastern() });
                          setErrors({});
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <form className={`mt-6 grid gap-5 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end ${card}`} onSubmit={saveManager}>
          <PortalField id="manager-name" label={editId ? "Edit name" : "New manager name"} error={errors.name}>
            <Input
              id="manager-name"
              className={portalInputClass}
              value={form.name}
              maxLength={80}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </PortalField>
          {editId ? (
            <p className="text-sm leading-relaxed text-white/60">
              Name only. Change the share from the manager&apos;s details, with a start date.
            </p>
          ) : (
            <>
          <PortalField id="manager-share" label="Share of company fee (%)" error={errors.shareBps}>
              <Input
                id="manager-share"
                className={portalInputClass}
                inputMode="decimal"
                placeholder="10"
                value={form.percent}
                onChange={(e) => setForm({ ...form, percent: e.target.value })}
              />
            </PortalField>
              <PortalField id="manager-effective" label="Share starts" error={errors.effectiveFrom}>
                <Input
                  id="manager-effective"
                  type="date"
                  className={portalInputClass}
                  value={form.effectiveFrom}
                  onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
                />
              </PortalField>
            </>
          )}
          <div className="flex gap-3">
            <Button type="submit" className={primaryButton} disabled={saving}>
              {editId ? "Save" : "Add manager"}
            </Button>
            {editId ? (
              <Button
                type="button"
                variant="outline"
                className={secondaryButton}
                onClick={() => {
                  setEditId(null);
                  setForm({ name: "", percent: "", effectiveFrom: todayEastern() });
                  setErrors({});
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="mt-14" aria-labelledby="assign-title">
        <h2 id="assign-title" className="text-2xl font-bold text-white">
          Car assignments
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/60">
          The date is the first day the new manager has the car. Trips that start before it stay
          with the previous manager.
        </p>
        <div className="mt-6 grid gap-4">
          {cars.map((car) => {
            const open = current.find((row) => row.carId === car.id);
            const value = assignFor(car.id);
            const err = assignErrors[car.id] ?? {};
            return (
              <div key={car.id} data-car-id={car.id} className={`grid gap-4 lg:grid-cols-[2fr_1.5fr_1fr_auto] lg:items-end ${card}`}>
                <div className="min-w-0">
                  <Link href={carAdminHref(car)} className="font-bold text-white hover:text-gold">
                    {carLabel(car)}
                  </Link>
                  <p className="mt-1 text-sm text-white/60">
                    {open ? `${open.managerName} since ${open.startDate}` : "No manager"}
                  </p>
                </div>
                <PortalField id={`assign-manager-${car.id}`} label="Manager" error={err.managerId}>
                  <select
                    id={`assign-manager-${car.id}`}
                    className={selectClass}
                    value={value.managerId}
                    onChange={(e) => setAssign({ ...assign, [car.id]: { ...value, managerId: e.target.value } })}
                  >
                    <option value="">No manager</option>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </PortalField>
                <PortalField id={`assign-date-${car.id}`} label="Starting" error={err.startDate}>
                  <Input
                    id={`assign-date-${car.id}`}
                    type="date"
                    className={portalInputClass}
                    value={value.startDate}
                    onChange={(e) => setAssign({ ...assign, [car.id]: { ...value, startDate: e.target.value } })}
                  />
                </PortalField>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" className={primaryButton} disabled={saving} onClick={() => saveAssignment(car.id)}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className={secondaryButton}
                    disabled={saving}
                    onClick={() => undo(car.id)}
                  >
                    Undo last
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {detail ? (
        <section className="mt-14" aria-labelledby="detail-title">
          <h2 id="detail-title" className="text-2xl font-bold text-white">
            {detail.manager.name}: {shareLabel(detail.manager.shareBps)} of the company fee
          </h2>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className={card}>
              <h3 className="font-heading text-sm tracking-[0.16em] text-gold uppercase">Accrued share by month</h3>
              {detail.accrual.months.length === 0 ? (
                <p className="mt-4 text-white/70">No fee-earning trips on this manager&apos;s cars yet.</p>
              ) : (
                <table className="mt-4 w-full text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Month</th>
                      <th className={th}>Trips</th>
                      <th className={th}>Company fee</th>
                      <th className={th}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.accrual.months.map((m) => (
                      <tr key={m.month} className="border-t border-white/10">
                        <td className={td}>{formatMonthLabel(m.month)}</td>
                        <td className={td}>{m.tripCount}</td>
                        <td className={td}>{usd(m.feeCents)}</td>
                        <td className={td}>{usd(m.shareCents)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-white/25 font-bold">
                      <td className={td}>Total</td>
                      <td className={td}>{detail.accrual.tripCount}</td>
                      <td className={td}>{usd(detail.accrual.feeCents)}</td>
                      <td className={td}>{usd(detail.accrual.accruedCents)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
            <div className={card}>
              <h3 className="font-heading text-sm tracking-[0.16em] text-gold uppercase">Share rate history</h3>
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>From</th>
                    <th className={th}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.manager.rates.map((rate) => (
                    <tr key={rate.id} className="border-t border-white/10">
                      <td className={td}>{rate.effectiveFrom}</td>
                      <td className={td}>{bpsToPercentLabel(rate.shareBps)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <form className="mt-6 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={addRate}>
                <PortalField id="rate-share" label="New share (%)" error={rateErrors.shareBps}>
                  <Input
                    id="rate-share"
                    className={portalInputClass}
                    inputMode="decimal"
                    value={rateForm.percent}
                    onChange={(e) => setRateForm({ ...rateForm, percent: e.target.value })}
                  />
                </PortalField>
                <PortalField id="rate-effective" label="Starting" error={rateErrors.effectiveFrom}>
                  <Input
                    id="rate-effective"
                    type="date"
                    className={portalInputClass}
                    value={rateForm.effectiveFrom}
                    onChange={(e) => setRateForm({ ...rateForm, effectiveFrom: e.target.value })}
                  />
                </PortalField>
                <Button type="submit" className={primaryButton} disabled={saving}>
                  Change share
                </Button>
              </form>
              <p className="mt-3 text-xs leading-relaxed text-white/55">
                Applies from its start date forward. Trips that started earlier keep the rate they
                earned. The date must be after the latest rate.
              </p>
            </div>
            <div className={card}>
              <h3 className="font-heading text-sm tracking-[0.16em] text-gold uppercase">Assignment history</h3>
              {detail.assignments.length === 0 ? (
                <p className="mt-4 text-white/70">No cars assigned yet.</p>
              ) : (
                <table className="mt-4 w-full text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Car</th>
                      <th className={th}>From</th>
                      <th className={th}>Until</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.assignments.map((a) => (
                      <tr key={a.id} className="border-t border-white/10">
                        <td className={td}>{a.car ? carLabel(a.car) : `Car ${a.carId}`}</td>
                        <td className={td}>{a.startDate}</td>
                        <td className={td}>{a.endDate ?? "Current"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          {detail.accrual.trips.length > 0 ? (
            <div className={`mt-6 overflow-x-auto ${card}`}>
              <h3 className="font-heading text-sm tracking-[0.16em] text-gold uppercase">Trips</h3>
              <table className="mt-4 w-full min-w-[560px] text-sm">
                <thead>
                  <tr>
                    <th className={th}>Start</th>
                    <th className={th}>Car</th>
                    <th className={th}>Days</th>
                    <th className={th}>Company fee</th>
                    <th className={th}>Rate</th>
                    <th className={th}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.accrual.trips.map((t) => {
                    const car = cars.find((c) => c.id === t.carId);
                    return (
                      <tr key={`${t.assignmentId}-${t.tripId}`} className="border-t border-white/10">
                        <td className={td}>{t.startDate}</td>
                        <td className={td}>{car ? carLabel(car) : `Car ${t.carId}`}</td>
                        <td className={td}>{t.days}</td>
                        <td className={td}>{usd(t.feeCents)}</td>
                        <td className={td}>{bpsToPercentLabel(t.shareBps)}</td>
                        <td className={td}>{usd(t.shareCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
    </PortalShell>
  );
}
