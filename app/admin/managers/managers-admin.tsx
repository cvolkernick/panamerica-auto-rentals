"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, type FormEvent } from "react";

import { portalRequest } from "@/components/portal/api";
import { InviteLinkPanel, useInviteLinks } from "@/components/portal/invite-link";
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
import type { CarJson, OwnerJson, PortalErrorJson, SessionJson } from "@/lib/portal/types";

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
  const [accounts, setAccounts] = useState<OwnerJson[]>([]);
  const [form, setForm] = useState({ name: "", email: "", percent: "", effectiveFrom: todayEastern() });
  const [accountForm, setAccountForm] = useState({ email: "", ownerId: "", confirm: false });
  const [accountErrors, setAccountErrors] = useState<Record<string, string>>({});
  const inviteLinks = useInviteLinks();
  const [addedId, setAddedId] = useState<number | null>(null);
  const [addMode, setAddMode] = useState<"new" | "existing">("new");
  const [pick, setPick] = useState({ ownerId: "", confirm: false });
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
      const [managerResult, carResult, ownerResult] = await Promise.all([
        portalRequest<{ managers: ManagerRow[]; currentAssignments: AssignmentJson[] }>(
          "/api/portal/admin/managers"
        ),
        portalRequest<{ cars: CarJson[] }>("/api/portal/admin/cars"),
        portalRequest<{ owners: OwnerJson[] }>("/api/portal/admin/owners"),
      ]);
      if (cancelled) return;
      if (!managerResult.ok || !managerResult.data || !carResult.ok || !carResult.data) {
        return setGate({ kind: "error" });
      }
      setEmail(session.data.email);
      setManagers(managerResult.data.managers);
      setCurrent(managerResult.data.currentAssignments);
      setCars(carResult.data.cars);
      setAccounts(ownerResult.ok && ownerResult.data ? ownerResult.data.owners : []);
      setGate({ kind: "ready" });
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function openDetail(id: number) {
    const result = await portalRequest<Detail>(`/api/portal/admin/managers/${id}`);
    if (result.ok && result.data) {
      if (result.data.manager.id !== detail?.manager.id) {
        setAccountForm({ email: "", ownerId: "", confirm: false });
        setAccountErrors({});
      }
      setDetail(result.data);
    } else setMessage("Could not load that manager.");
  }

  async function saveManager(event: FormEvent) {
    event.preventDefault();
    const shareBps = percentToBps(form.percent);
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Enter a name.";
    const existing = !editId && addMode === "existing";
    if (!editId && !existing && !form.email.trim()) next.email = "Enter the manager's email. It becomes their sign-in.";
    if (existing && !/^[1-9]\d*$/.test(pick.ownerId)) next.ownerId = "Choose the account.";
    if (existing && !pick.confirm) next.confirm = "Confirm this exact account before adding the manager.";
    if (!editId && shareBps === null) next.shareBps = "Enter a percent from 0 to 100, up to two decimals.";
    if (Object.keys(next).length) return setErrors(next);
    setSaving(true);
    setMessage("");
    const result = await portalRequest<{ manager: ManagerJson }>(
      editId ? `/api/portal/admin/managers/${editId}` : "/api/portal/admin/managers",
      editId
        ? { method: "PATCH", body: { name: form.name } }
        : {
            method: "POST",
            body: existing
              ? { name: form.name, ownerId: Number(pick.ownerId), confirm: true, shareBps, effectiveFrom: form.effectiveFrom }
              : { name: form.name, email: form.email, shareBps, effectiveFrom: form.effectiveFrom },
          }
    );
    setSaving(false);
    if (!result.ok) {
      setErrors(fieldsFrom(result.error));
      return setMessage(
        result.error?.reason === "account_has_manager"
          ? "That account is already linked to another manager."
          : result.error?.reason === "email_has_account"
            ? "That email already has a portal account. It was not linked. To use it, choose Existing account and confirm it."
            : "Could not save the manager."
      );
    }
    if (existing) {
      setErrors({});
      setForm({ name: "", email: "", percent: "", effectiveFrom: todayEastern() });
      setPick({ ownerId: "", confirm: false });
      setAddMode("new");
      setMessage("Manager added on the existing login. They sign in as usual and open /manager/.");
      return setReloadToken((value) => value + 1);
    }
    setErrors({});
    setForm({ name: "", email: "", percent: "", effectiveFrom: todayEastern() });
    const createdId = !editId ? result.data?.manager.id : undefined;
    if (createdId) {
      // Same as owners: the new login gets a one-time invite link right away.
      setAddedId(createdId);
      const invited = await inviteManager(createdId);
      setMessage(
        invited
          ? "Manager added with a new login. Copy the invite link below and send it to them. They set their password from it, then sign in at /manager/."
          : "Manager added with a new login, but the invite link was not made. Use Invite link in the list to try again."
      );
    } else {
      setMessage("Manager saved.");
    }
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

  async function accountAction(action: "account" | "link") {
    if (!detail) return;
    const body =
      action === "account"
        ? { email: accountForm.email }
        : { ownerId: Number(accountForm.ownerId), confirm: accountForm.confirm };
    if (action === "link" && (!/^[1-9]\d*$/.test(accountForm.ownerId) || !accountForm.confirm)) {
      return setAccountErrors({
        ownerId: /^[1-9]\d*$/.test(accountForm.ownerId) ? "" : "Choose the account.",
        confirm: accountForm.confirm ? "" : "Confirm this exact account before linking.",
      });
    }
    setSaving(true);
    setMessage("");
    const result = await portalRequest<Detail>(`/api/portal/admin/managers/${detail.manager.id}/${action}`, {
      method: "POST",
      body,
    });
    setSaving(false);
    if (!result.ok || !result.data) {
      setAccountErrors(fieldsFrom(result.error));
      const reason = result.error?.reason;
      return setMessage(
        reason === "email_has_account"
          ? "That email already has a portal account. It was not linked. To use it, link that account by its id and confirm."
          : reason === "account_has_manager"
            ? "That account is already linked to another manager."
            : reason === "manager_already_linked"
              ? "This manager already has a login."
              : "Could not set up the login."
      );
    }
    setAccountErrors({});
    setAccountForm({ email: "", ownerId: "", confirm: false });
    setDetail(result.data);
    if (action === "account") {
      const invited = await inviteManager(result.data.manager.id);
      setMessage(
        invited
          ? "Login created. Copy the invite link below and send it to them."
          : "Login created, but the invite link was not made. Use Create invite link to try again."
      );
    } else setMessage("Account linked.");
    setReloadToken((v) => v + 1);
  }

  /** Same token, expiry, and "a new link replaces older unused ones" rule as owner invites. */
  async function inviteManager(id: number): Promise<boolean> {
    setSaving(true);
    const path = `/api/portal/admin/managers/${id}/invite`;
    let result = await inviteLinks.create(id, path);
    if (!result.ok && result.error?.reason === "account_has_password") {
      const reset = window.confirm(
        "This login already has a password and can sign in at /manager/. Make a new invite link anyway? Once used, it replaces their current password."
      );
      if (reset) result = await inviteLinks.create(id, path, { reset: true });
      else {
        setSaving(false);
        setMessage("No link made. They sign in as usual and open /manager/.");
        return false;
      }
    }
    setSaving(false);
    if (!result.ok || !result.data) {
      const reason = result.error?.reason;
      setMessage(reason === "manager_not_linked" ? "Set up a login first." : "Could not make an invite link.");
      return false;
    }
    return true;
  }

  async function makeInvite() {
    if (!detail) return;
    setMessage("");
    if (await inviteManager(detail.manager.id)) {
      setMessage("Invite link made. It works once and expires in 72 hours. Send it to the manager directly.");
    }
  }

  async function copyInvite(id: number) {
    if (!(await inviteLinks.copy(id))) setMessage("Select the link and copy it.");
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
                  <th className={th}>Login</th>
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
                  <Fragment key={m.id}>
                  <tr className="border-t border-white/10">
                    <td className={td}>{m.name}</td>
                    <td className={`${td} wrap-anywhere`}>{m.accountEmail ?? "Not linked"}</td>
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
                          setForm({ name: m.name, email: "", percent: "", effectiveFrom: todayEastern() });
                          setErrors({});
                        }}
                      >
                        Edit
                      </button>
                      {m.accountId !== null ? (
                        <>
                          {" "}
                          ·{" "}
                          <button
                            type="button"
                            className="text-gold hover:underline"
                            disabled={saving}
                            onClick={async () => {
                              setMessage("");
                              setAddedId(null);
                              await inviteManager(m.id);
                            }}
                          >
                            {inviteLinks.pendingId === m.id ? "Creating link" : "Invite link"}
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                  {inviteLinks.invites[m.id] && addedId !== m.id && detail?.manager.id !== m.id ? (
                    <tr>
                      <td colSpan={8} className="pb-4">
                        <InviteLinkPanel
                          url={inviteLinks.invites[m.id].url}
                          copied={inviteLinks.invites[m.id].copied}
                          onCopy={() => copyInvite(m.id)}
                        />
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {editId ? null : (
          <div className="mt-6 flex flex-wrap gap-3" role="group" aria-label="Add manager from">
            <Button
              type="button"
              variant="outline"
              aria-pressed={addMode === "new"}
              className={`${secondaryButton} ${addMode === "new" ? "bg-white/10" : ""}`}
              onClick={() => setAddMode("new")}
            >
              New login
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-pressed={addMode === "existing"}
              className={`${secondaryButton} ${addMode === "existing" ? "bg-white/10" : ""}`}
              onClick={() => setAddMode("existing")}
            >
              Existing account
            </Button>
          </div>
        )}
        <form className={`mt-6 grid gap-5 sm:grid-cols-[2fr_2fr_1fr_1fr_auto] sm:items-end ${card}`} onSubmit={saveManager}>
          {!editId && addMode === "existing" ? (
            <div className="grid gap-3 sm:col-span-5">
              <p className="text-sm leading-relaxed text-white/70">
                For someone who already signs in (for example, an owner who also manages). Choose that exact
                account and confirm it. They keep their login and password. An email match never links an account.
                An owner with no car yet shows as manager-only until their car is added or the owner role is
                added again on the Owners page.
              </p>
              <PortalField id="manager-account" label="Account" error={errors.ownerId}>
                <select
                  id="manager-account"
                  className={selectClass}
                  value={pick.ownerId}
                  onChange={(e) => {
                    const chosen = accounts.find((a) => String(a.id) === e.target.value);
                    setPick({ ownerId: e.target.value, confirm: false });
                    if (chosen && !form.name.trim()) setForm({ ...form, name: chosen.name });
                  }}
                >
                  <option value="">Choose an account</option>
                  {accounts
                    .filter((a) => !managers.some((m) => m.accountId === a.id))
                    .map((a) => (
                      <option key={a.id} value={String(a.id)}>
                        {a.name} · {a.email} (#{a.id})
                      </option>
                    ))}
                </select>
              </PortalField>
              <label className="flex items-start gap-3 text-sm text-white/80">
                <input
                  type="checkbox"
                  disabled={!pick.ownerId}
                  checked={pick.confirm}
                  onChange={(e) => setPick({ ...pick, confirm: e.target.checked })}
                />
                <span>
                  {(() => {
                    const chosen = accounts.find((a) => String(a.id) === pick.ownerId);
                    return chosen
                      ? `I confirm ${chosen.name} (${chosen.email}, #${chosen.id}) is this manager.`
                      : "Choose an account, then confirm it.";
                  })()}
                </span>
              </label>
              {errors.confirm ? <p className="text-sm text-white/80">{errors.confirm}</p> : null}
            </div>
          ) : null}
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
              {addMode === "existing" ? (
                <p className="text-sm leading-relaxed text-white/60">Signs in with the chosen account.</p>
              ) : (
              <PortalField id="manager-email" label="Sign-in email" error={errors.email}>
                <Input
                  id="manager-email"
                  type="email"
                  autoComplete="off"
                  className={portalInputClass}
                  value={form.email}
                  maxLength={254}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </PortalField>
              )}
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
                  setForm({ name: "", email: "", percent: "", effectiveFrom: todayEastern() });
                  setErrors({});
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
        {addedId !== null && inviteLinks.invites[addedId] ? (
          <div className={`mt-6 ${card}`}>
            <h3 className="font-heading text-sm tracking-[0.16em] text-gold uppercase">
              Invite link for {managers.find((m) => m.id === addedId)?.name ?? "the new manager"}
            </h3>
            <InviteLinkPanel
              url={inviteLinks.invites[addedId].url}
              copied={inviteLinks.invites[addedId].copied}
              onCopy={() => copyInvite(addedId)}
            />
          </div>
        ) : null}
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
          <div className={`mt-6 ${card}`}>
            <h3 className="font-heading text-sm tracking-[0.16em] text-gold uppercase">Login</h3>
            {detail.manager.accountId !== null ? (
              <div className="mt-4 grid gap-4">
                <p className="text-sm leading-relaxed text-white/80">
                  Signs in as <span className="wrap-anywhere text-white">{detail.manager.accountEmail}</span> at
                  /manager/. The manager view is read-only and shows only this manager&apos;s cars, for the dates they
                  managed them.
                </p>
                <div>
                  <Button type="button" variant="outline" className={secondaryButton} disabled={saving} onClick={makeInvite}>
                    {inviteLinks.pendingId === detail.manager.id ? "Creating link" : "Create invite link"}
                  </Button>
                </div>
                {inviteLinks.invites[detail.manager.id] ? (
                  <InviteLinkPanel
                    url={inviteLinks.invites[detail.manager.id].url}
                    copied={inviteLinks.invites[detail.manager.id].copied}
                    onCopy={() => copyInvite(detail.manager.id)}
                  />
                ) : null}
              </div>
            ) : (
              <div className="mt-4 grid gap-6 lg:grid-cols-2">
                <form
                  className="grid gap-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void accountAction("account");
                  }}
                >
                  <p className="text-sm leading-relaxed text-white/70">
                    New login: enter an email that has no portal account yet.
                  </p>
                  <PortalField id="account-email" label="Sign-in email" error={accountErrors.email}>
                    <Input
                      id="account-email"
                      type="email"
                      autoComplete="off"
                      className={portalInputClass}
                      value={accountForm.email}
                      onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value })}
                    />
                  </PortalField>
                  <div>
                    <Button type="submit" className={primaryButton} disabled={saving}>
                      Create login
                    </Button>
                  </div>
                </form>
                <form
                  className="grid gap-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void accountAction("link");
                  }}
                >
                  <p className="text-sm leading-relaxed text-white/70">
                    Existing account (for example, an owner who also manages): choose that exact account and
                    confirm it. An email match never links an account.
                  </p>
                  <PortalField id="account-owner-id" label="Account" error={accountErrors.ownerId}>
                    <select
                      id="account-owner-id"
                      className={selectClass}
                      value={accountForm.ownerId}
                      onChange={(e) => setAccountForm({ ...accountForm, ownerId: e.target.value, confirm: false })}
                    >
                      <option value="">Choose an account</option>
                      {accounts
                        .filter((a) => !managers.some((m) => m.accountId === a.id))
                        .map((a) => (
                          <option key={a.id} value={String(a.id)}>
                            {a.name} · {a.email} (#{a.id})
                          </option>
                        ))}
                    </select>
                  </PortalField>
                  <label className="flex items-start gap-3 text-sm text-white/80">
                    <input
                      type="checkbox"
                      disabled={!accountForm.ownerId}
                      checked={accountForm.confirm}
                      onChange={(e) => setAccountForm({ ...accountForm, confirm: e.target.checked })}
                    />
                    <span>
                      {(() => {
                        const chosen = accounts.find((a) => String(a.id) === accountForm.ownerId);
                        return chosen
                          ? `I confirm ${chosen.name} (${chosen.email}, #${chosen.id}) is this manager.`
                          : "Choose an account, then confirm it.";
                      })()}
                    </span>
                  </label>
                  {accountErrors.confirm ? <p className="text-sm text-white/80">{accountErrors.confirm}</p> : null}
                  <div>
                    <Button type="submit" variant="outline" className={secondaryButton} disabled={saving}>
                      Link account
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </div>
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
