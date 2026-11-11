"use client";

import { Fragment, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";

import { portalRequest } from "@/components/portal/api";
import { PortalField, PortalNotice, portalInputClass } from "@/components/portal/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  LEDGER_TYPE_LABELS,
  LEDGER_TYPES,
  centsToDollarInput,
  dollarsToCents,
  formatMonthLabel,
  formatUsdFromCents,
  todayEastern,
  type LedgerType,
} from "@/lib/portal/ledger";
import type { CarJson, LedgerEntryJson, LedgerTotalsJson, PortalErrorJson } from "@/lib/portal/types";
import { parseLedgerCreate } from "@/lib/portal/validate";

const primaryButton =
  "h-11 bg-red px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-red/90";
const secondaryButton =
  "h-11 border-white/25 bg-transparent px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-white/10 hover:text-white";
const controlClass = `${portalInputClass} w-full min-w-0 [color-scheme:dark]`;

type LedgerForm = {
  entryDate: string;
  type: LedgerType;
  amount: string;
  note: string;
};

type LedgerList = {
  entries: LedgerEntryJson[];
  month: string | null;
  totals: LedgerTotalsJson;
};

const emptyTotals = (): LedgerTotalsJson => ({
  incomeCents: 0,
  deductionCents: 0,
  netCents: 0,
});

function subscribeToNothing() {
  return () => {};
}

function easternTodaySnapshot() {
  return todayEastern();
}

function noEasternToday() {
  return "";
}

function useEasternToday(): string {
  return useSyncExternalStore(subscribeToNothing, easternTodaySnapshot, noEasternToday);
}

const blankForm = (entryDate: string): LedgerForm => ({
  entryDate,
  type: "trip_income",
  amount: "",
  note: "",
});

function fieldsFrom(error: PortalErrorJson | null): Record<string, string> {
  const fields = { ...(error?.fields ?? {}) };
  if (fields.amountCents && !fields.amount) fields.amount = fields.amountCents;
  return fields;
}

function EntryActions({
  disabled,
  onEdit,
  onDelete,
}: {
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" className={secondaryButton} disabled={disabled} onClick={onEdit}>
        Edit
      </Button>
      <Button
        type="button"
        variant="destructive"
        className={secondaryButton}
        disabled={disabled}
        onClick={onDelete}
      >
        Delete
      </Button>
    </div>
  );
}

export function CarLedger({ car, onClose }: { car: CarJson; onClose: () => void }) {
  const today = useEasternToday();
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const [entries, setEntries] = useState<LedgerEntryJson[]>([]);
  const [totals, setTotals] = useState<LedgerTotalsJson>(emptyTotals);
  const [formOverride, setFormOverride] = useState<LedgerForm | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadedMonth, setLoadedMonth] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const month = monthOverride ?? (today ? today.slice(0, 7) : "");
  const form = formOverride ?? blankForm(today);

  useEffect(() => {
    document.getElementById("car-ledger-title")?.focus();
  }, [car.id]);

  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    (async () => {
      const result = await portalRequest<LedgerList>(
        `/api/portal/admin/cars/${car.id}/ledger?month=${encodeURIComponent(month)}`
      );
      if (cancelled) return;
      setLoadedMonth(month);
      if (!result.ok || !result.data) {
        setEntries([]);
        setTotals(emptyTotals());
        setLoadError(result.error?.fields?.month ?? "Could not load the ledger.");
        return;
      }
      setEntries(result.data.entries);
      setTotals(result.data.totals);
      setLoadError("");
    })();
    return () => {
      cancelled = true;
    };
  }, [car.id, month, reloadToken]);

  function resetForm() {
    setEditingId(null);
    setFormOverride(blankForm(todayEastern()));
    setErrors({});
  }

  function editEntry(entry: LedgerEntryJson) {
    setEditingId(entry.id);
    setFormOverride({
      entryDate: entry.entryDate,
      type: entry.type,
      amount: centsToDollarInput(entry.amountCents),
      note: entry.note ?? "",
    });
    setErrors({});
    setNotice("");
    document.getElementById("ledger-date")?.focus();
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    const cents = dollarsToCents(form.amount);
    const parsed = parseLedgerCreate({
      entryDate: form.entryDate,
      type: form.type,
      amountCents: cents ?? form.amount,
      note: form.note,
    });
    const fields = parsed.ok ? {} : { ...parsed.fields };
    if (cents === null) {
      fields.amount = "Enter a dollar amount greater than zero, such as 125.50.";
    }
    if (!parsed.ok || cents === null) {
      setErrors(fields);
      return;
    }
    setSaving(true);
    setNotice("");
    const result = await portalRequest<{ entry: LedgerEntryJson }>(
      editingId
        ? `/api/portal/admin/cars/${car.id}/ledger/${editingId}`
        : `/api/portal/admin/cars/${car.id}/ledger`,
      {
        method: editingId ? "PATCH" : "POST",
        body: {
          entryDate: parsed.value.entryDate,
          type: parsed.value.type,
          amountCents: parsed.value.amountCents,
          note: parsed.value.note,
        },
      }
    );
    setSaving(false);
    if (!result.ok) {
      setErrors(fieldsFrom(result.error));
      setNotice("Could not save the entry.");
      return;
    }
    setNotice(editingId ? "Entry saved." : "Entry added.");
    resetForm();
    setReloadToken((value) => value + 1);
  }

  async function removeEntry(id: number) {
    if (!window.confirm("Delete this ledger entry?")) return;
    setSaving(true);
    setNotice("");
    const result = await portalRequest<{ ok: boolean }>(
      `/api/portal/admin/cars/${car.id}/ledger/${id}`,
      { method: "DELETE" }
    );
    setSaving(false);
    if (!result.ok) {
      setNotice("Could not delete the entry.");
      return;
    }
    if (editingId === id) resetForm();
    setNotice("Entry deleted.");
    setReloadToken((value) => value + 1);
  }

  const monthReady = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const monthLabel = monthReady ? formatMonthLabel(month) : "this month";
  const monthLoaded = monthReady && loadedMonth === month;
  const shownEntries = monthLoaded ? entries : [];
  const shownTotals = monthLoaded ? totals : emptyTotals();

  return (
    <section id="car-ledger" className="mt-10 min-w-0 scroll-mt-6 overflow-hidden">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2
            id="car-ledger-title"
            tabIndex={-1}
            className="text-2xl font-bold text-white outline-none"
          >
            Ledger
          </h2>
          <p className="mt-2 min-w-0 text-base leading-relaxed wrap-anywhere text-white/80">
            {car.year} {car.make} {car.model}
            {car.licensePlate ? ` · Plate ${car.licensePlate}` : ""}
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">
            Trip income is money in. Every other type is a deduction. Amounts are entered in dollars.
          </p>
        </div>
        <Button type="button" variant="outline" className={secondaryButton} onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="mt-8 max-w-xs min-w-0">
        <PortalField id="ledger-month" label="Month" error={errors.month}>
          <Input
            id="ledger-month"
            type="month"
            value={month}
            onChange={(event) => setMonthOverride(event.target.value)}
            className={controlClass}
          />
        </PortalField>
      </div>

      <form
        className="mt-8 grid min-w-0 gap-5 rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:p-8"
        onSubmit={saveEntry}
      >
        <div className="grid min-w-0 gap-5 sm:grid-cols-2">
          <PortalField id="ledger-date" label="Date" error={errors.entryDate}>
            <Input
              id="ledger-date"
              type="date"
              value={form.entryDate}
              onChange={(event) => setFormOverride({ ...form, entryDate: event.target.value })}
              className={controlClass}
              aria-invalid={errors.entryDate ? true : undefined}
              aria-describedby={errors.entryDate ? "ledger-date-error" : undefined}
              required
            />
          </PortalField>
          <PortalField id="ledger-type" label="Type" error={errors.type}>
            <select
              id="ledger-type"
              value={form.type}
              onChange={(event) => setFormOverride({ ...form, type: event.target.value as LedgerType })}
              className={`${controlClass} rounded-lg border border-input bg-transparent px-2.5`}
            >
              {LEDGER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {LEDGER_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </PortalField>
        </div>
        <PortalField id="ledger-amount" label="Amount" error={errors.amount}>
          <Input
            id="ledger-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="125.50"
            value={form.amount}
            onChange={(event) => setFormOverride({ ...form, amount: event.target.value })}
            className={controlClass}
            aria-invalid={errors.amount ? true : undefined}
            aria-describedby={errors.amount ? "ledger-amount-error" : undefined}
            required
          />
        </PortalField>
        <PortalField id="ledger-note" label="Note" error={errors.note}>
          <Textarea
            id="ledger-note"
            value={form.note}
            maxLength={200}
            onChange={(event) => setFormOverride({ ...form, note: event.target.value })}
            className="min-h-24 w-full min-w-0 border-white/15 bg-white/5 text-base text-white md:text-base"
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={errors.note ? "ledger-note-error" : undefined}
          />
        </PortalField>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Button type="submit" className={primaryButton} disabled={saving}>
            {editingId ? "Save entry" : "Add entry"}
          </Button>
          {editingId ? (
            <Button type="button" variant="outline" className={secondaryButton} onClick={resetForm}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>

      {notice ? <PortalNotice>{notice}</PortalNotice> : null}
      {loadError ? <PortalNotice>{loadError}</PortalNotice> : null}

      <h3 className="mt-8 text-lg font-bold text-white">{monthLabel}</h3>
      <dl className="mt-3 grid min-w-0 gap-4 rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:grid-cols-3">
        {(
          [
            ["Income", shownTotals.incomeCents],
            ["Deductions", shownTotals.deductionCents],
            ["Net", shownTotals.netCents],
          ] as const
        ).map(([label, cents]) => (
          <div key={label} className="min-w-0">
            <dt className="font-heading text-xs tracking-[0.16em] text-white/55 uppercase">{label}</dt>
            <dd className="mt-1 text-xl font-bold wrap-anywhere text-white">{formatUsdFromCents(cents)}</dd>
          </div>
        ))}
      </dl>

      {!month ? (
        <p className="mt-6 text-base leading-relaxed text-white/70">Choose a month.</p>
      ) : !monthLoaded ? (
        <PortalNotice>Loading.</PortalNotice>
      ) : shownEntries.length === 0 ? (
        <p className="mt-6 text-base leading-relaxed text-white/70">No entries this month.</p>
      ) : null}

      {shownEntries.length > 0 ? (
        <>
          <ul className="mt-6 grid min-w-0 gap-3 sm:hidden">
            {shownEntries.map((entry) => (
              <li
                key={entry.id}
                className="min-w-0 overflow-hidden rounded-xl bg-navy-mid p-4 ring-1 ring-white/10"
              >
                <dl className="grid min-w-0 gap-3">
                  <div className="min-w-0">
                    <dt className="font-heading text-xs tracking-[0.16em] text-white/55 uppercase">Date</dt>
                    <dd className="mt-1 text-white">{entry.entryDate}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="font-heading text-xs tracking-[0.16em] text-white/55 uppercase">Type</dt>
                    <dd className="mt-1 text-white">{LEDGER_TYPE_LABELS[entry.type]}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="font-heading text-xs tracking-[0.16em] text-white/55 uppercase">Amount</dt>
                    <dd className="mt-1 text-white">{formatUsdFromCents(entry.amountCents)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="font-heading text-xs tracking-[0.16em] text-white/55 uppercase">Note</dt>
                    <dd className="mt-1 min-w-0 leading-relaxed wrap-anywhere text-white/80">
                      {entry.note ?? "—"}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4">
                  <EntryActions
                    disabled={saving}
                    onEdit={() => editEntry(entry)}
                    onDelete={() => removeEntry(entry.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-6 hidden min-w-0 overflow-hidden rounded-xl ring-1 ring-white/10 sm:block">
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <caption className="sr-only">Ledger entries for {monthLabel}</caption>
              <thead className="font-heading text-xs tracking-[0.14em] text-white/55 uppercase">
                <tr>
                  <th scope="col" className="w-[22%] px-3 py-3 font-normal">
                    Date
                  </th>
                  <th scope="col" className="w-[22%] px-3 py-3 font-normal">
                    Type
                  </th>
                  <th scope="col" className="w-[18%] px-3 py-3 font-normal">
                    Amount
                  </th>
                  <th scope="col" className="w-[38%] px-3 py-3 font-normal">
                    Note
                  </th>
                </tr>
              </thead>
              <tbody>
                {shownEntries.map((entry) => (
                  <Fragment key={entry.id}>
                    <tr className="border-t border-white/10 align-top">
                      <td className="px-3 pt-3 text-white">{entry.entryDate}</td>
                      <td className="px-3 pt-3 text-white">{LEDGER_TYPE_LABELS[entry.type]}</td>
                      <td className="px-3 pt-3 wrap-anywhere text-white">
                        {formatUsdFromCents(entry.amountCents)}
                      </td>
                      <td className="min-w-0 px-3 pt-3 leading-relaxed wrap-anywhere text-white/80">
                        {entry.note ?? "—"}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={4} className="px-3 pt-3 pb-4">
                        <EntryActions
                          disabled={saving}
                          onEdit={() => editEntry(entry)}
                          onDelete={() => removeEntry(entry.id)}
                        />
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
