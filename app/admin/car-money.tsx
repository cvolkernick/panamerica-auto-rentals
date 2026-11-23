"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";

import { portalRequest } from "@/components/portal/api";
import { PortalField, PortalNotice, portalInputClass } from "@/components/portal/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from "@/lib/portal/expenses";
import {
  centsToDollarInput,
  dollarsToCents,
  formatMonthLabel,
  formatUsdFromCents,
  todayEastern,
} from "@/lib/portal/ledger";
import type { ExpenseJson, MoneyReportJson, MoneyTotalsJson, PortalErrorJson } from "@/lib/portal/types";
import { parseExpenseCreate } from "@/lib/portal/validate";

import { CarStatement } from "./car-statement";

const primaryButton =
  "h-11 bg-red px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-red/90";
const secondaryButton =
  "h-11 border-white/25 bg-transparent px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-white/10 hover:text-white";
const controlClass = `${portalInputClass} w-full min-w-0 [color-scheme:dark]`;

type ExpenseForm = {
  entryDate: string;
  category: ExpenseCategory;
  amount: string;
  note: string;
};

function subscribeToNothing() {
  return () => {};
}

function useEasternToday(): string {
  return useSyncExternalStore(subscribeToNothing, () => todayEastern(), () => "");
}

function blankForm(entryDate: string): ExpenseForm {
  return { entryDate, category: "maintenance", amount: "", note: "" };
}

function fieldsFrom(error: PortalErrorJson | null): Record<string, string> {
  const fields = { ...(error?.fields ?? {}) };
  if (fields.amountCents && !fields.amount) fields.amount = fields.amountCents;
  return fields;
}

function money(cents: number | null): string {
  return cents === null ? "—" : formatUsdFromCents(cents);
}

function Totals({ totals }: { totals: MoneyTotalsJson }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <div>
        <dt className="font-heading text-xs tracking-[0.16em] text-white/55 uppercase">Income</dt>
        <dd className="mt-1 text-2xl font-bold text-white">{formatUsdFromCents(totals.incomeCents)}</dd>
      </div>
      <div>
        <dt className="font-heading text-xs tracking-[0.16em] text-white/55 uppercase">Expenses</dt>
        <dd className="mt-1 text-2xl font-bold text-white">{formatUsdFromCents(totals.expenseCents)}</dd>
      </div>
      <div>
        <dt className="font-heading text-xs tracking-[0.16em] text-white/55 uppercase">Net before fee</dt>
        <dd className="mt-1 text-2xl font-bold text-white">{formatUsdFromCents(totals.netCents)}</dd>
      </div>
    </dl>
  );
}

export function CarMoney({ carId, mode }: { carId: number; mode: "owner" | "admin" }) {
  const today = useEasternToday();
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const [report, setReport] = useState<MoneyReportJson | null>(null);
  const [formOverride, setFormOverride] = useState<ExpenseForm | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const month = monthOverride ?? (today ? today.slice(0, 7) : "");
  const form = formOverride ?? blankForm(today);
  const reportPath =
    mode === "admin"
      ? `/api/portal/admin/cars/${carId}/report?month=${month}`
      : `/api/portal/cars/${carId}/report?month=${month}`;

  useEffect(() => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
    let cancelled = false;
    (async () => {
      const result = await portalRequest<MoneyReportJson>(reportPath);
      if (cancelled) return;
      if (!result.ok || !result.data) {
        setLoadError("Could not load this report.");
        setReport(null);
        return;
      }
      setLoadError("");
      setReport(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [month, reportPath, reloadToken]);

  async function saveExpense(event: FormEvent) {
    event.preventDefault();
    const cents = dollarsToCents(form.amount);
    const parsed = parseExpenseCreate({
      entryDate: form.entryDate,
      category: form.category,
      amountCents: cents ?? form.amount,
      note: form.note,
    });
    const fields = parsed.ok ? {} : { ...parsed.fields };
    if (cents === null) fields.amount = "Enter a dollar amount greater than zero, such as 125.50.";
    if (!parsed.ok || cents === null) {
      setErrors(fields);
      return;
    }
    setSaving(true);
    setNotice("");
    const result = await portalRequest<{ expense: ExpenseJson }>(
      editingId
        ? `/api/portal/admin/cars/${carId}/expenses/${editingId}`
        : `/api/portal/admin/cars/${carId}/expenses`,
      {
        method: editingId ? "PATCH" : "POST",
        body: {
          entryDate: parsed.value.entryDate,
          category: parsed.value.category,
          amountCents: parsed.value.amountCents,
          note: parsed.value.note,
        },
      }
    );
    setSaving(false);
    if (!result.ok) {
      setErrors(fieldsFrom(result.error));
      setNotice("Could not save the expense.");
      return;
    }
    setEditingId(null);
    setFormOverride(blankForm(today));
    setErrors({});
    setNotice(editingId ? "Expense saved." : "Expense added.");
    setReloadToken((value) => value + 1);
  }

  async function removeExpense(id: number) {
    if (!window.confirm("Delete this expense?")) return;
    setSaving(true);
    setNotice("");
    const result = await portalRequest(`/api/portal/admin/cars/${carId}/expenses/${id}`, {
      method: "DELETE",
    });
    setSaving(false);
    if (!result.ok) {
      setNotice("Could not delete the expense.");
      return;
    }
    if (editingId === id) {
      setEditingId(null);
      setFormOverride(blankForm(today));
    }
    setNotice("Expense deleted.");
    setReloadToken((value) => value + 1);
  }

  const monthReady = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const monthLabel = monthReady ? formatMonthLabel(month) : "this month";
  const totals = report?.monthTotals;

  return (
    <section id="car-money" className="mt-14 min-w-0 scroll-mt-6 overflow-hidden">
      <h2 className="text-2xl font-bold text-white">Net report</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">
        Income is payout minus sales tax. Tax is collected for the state and is not profit. Turo
        payouts are already net of sales tax. {report?.attribution} The monthly statement adds the
        Panamerica management fee and carries any shortfall into the next month.
      </p>
      <div className="mt-8 max-w-xs">
        <PortalField id={`money-month-${carId}`} label="Month">
          <Input
            id={`money-month-${carId}`}
            type="month"
            value={month}
            onChange={(event) => setMonthOverride(event.target.value)}
            className={controlClass}
          />
        </PortalField>
      </div>
      {loadError ? <PortalNotice>{loadError}</PortalNotice> : null}
      {notice ? <PortalNotice>{notice}</PortalNotice> : null}
      {totals ? (
        <div className="mt-8 rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:p-8">
          <h3 className="font-heading text-xs tracking-[0.16em] text-gold uppercase">{monthLabel}</h3>
          <div className="mt-4">
            <Totals totals={totals} />
          </div>
          <dl className="mt-6 grid gap-3 text-sm leading-relaxed text-white/80 sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt>Payout</dt>
              <dd>{formatUsdFromCents(totals.payoutCents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Tax collected</dt>
              <dd>{money(totals.taxCents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Gross before tax</dt>
              <dd>{money(totals.grossCents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Platform fees</dt>
              <dd>{money(totals.platformFeesCents)}</dd>
            </div>
            {totals.pendingTripCount > 0 ? (
              <div className="flex justify-between gap-4 sm:col-span-2">
                <dt>Pending deposit</dt>
                <dd>{formatUsdFromCents(totals.pendingPayoutCents)}</dd>
              </div>
            ) : null}
          </dl>
          <div className="mt-6 grid gap-3 text-sm leading-relaxed text-white/80 sm:grid-cols-2">
            <p>
              To date through {monthLabel}: {formatUsdFromCents(report.toDate.netCents)} net before fee
            </p>
            <p>All time: {formatUsdFromCents(report.allTime.netCents)} net before fee</p>
          </div>
          {report.platforms.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-white/80">
              {report.platforms.map((platform) => (
                <li key={platform.platform}>
                  {platform.platform}: {formatUsdFromCents(platform.incomeCents)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {monthReady ? (
        <CarStatement carId={carId} mode={mode} month={month} today={today} reloadToken={reloadToken} />
      ) : null}

      <h3 className="mt-10 text-xl font-bold text-white">Trips</h3>
      <div className="mt-4 min-w-0 overflow-hidden rounded-xl ring-1 ring-white/10">
        <table className="w-full min-w-0 text-left text-sm text-white">
          <caption className="sr-only">Trips starting in {monthLabel}</caption>
          <thead className="bg-white/5 text-white/70">
            <tr>
              <th className="px-3 py-3 font-heading text-xs tracking-[0.14em] uppercase">Trip</th>
              <th className="px-3 py-3 font-heading text-xs tracking-[0.14em] uppercase">Payout</th>
              <th className="px-3 py-3 font-heading text-xs tracking-[0.14em] uppercase">Tax</th>
            </tr>
          </thead>
          <tbody>
            {report && report.trips.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-white/70">
                  No trips start this month.
                </td>
              </tr>
            ) : null}
            {report?.trips.map((trip) => (
              <tr key={trip.id} className="border-t border-white/10">
                <td className="px-3 py-3 align-top wrap-anywhere">
                  <span className="font-heading tracking-[0.12em] text-gold uppercase">{trip.platform}</span>
                  <span className="mt-1 block text-white/80">
                    {trip.startDate}
                    {trip.endDate ? ` – ${trip.endDate}` : ""} · {trip.status}
                  </span>
                  {trip.countsAsIncome ? null : (
                    <span className="mt-1 block text-white/60">Not in income yet</span>
                  )}
                  {trip.hasPending ? (
                    <span className="mt-1 block text-white/60">
                      Pending deposit {money(trip.pendingPayoutCents)}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-3 align-top">{formatUsdFromCents(trip.payoutCents)}</td>
                <td className="px-3 py-3 align-top">{money(trip.taxCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-10 text-xl font-bold text-white">Expenses</h3>
      <ul className="mt-4 divide-y divide-white/10 rounded-xl bg-navy-mid px-5 ring-1 ring-white/10">
        {report && report.expenses.length === 0 ? (
          <li className="py-4 text-sm text-white/70">No expenses this month.</li>
        ) : null}
        {report?.expenses.map((expense) => (
          <li key={expense.id} className="flex min-w-0 flex-wrap items-start justify-between gap-3 py-4">
            <div className="min-w-0">
              <p className="text-white">
                {expense.entryDate} · {EXPENSE_CATEGORY_LABELS[expense.category]} ·{" "}
                {formatUsdFromCents(expense.amountCents)}
              </p>
              {expense.note ? <p className="mt-1 wrap-anywhere text-sm text-white/70">{expense.note}</p> : null}
            </div>
            {mode === "admin" ? (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className={secondaryButton}
                  onClick={() => {
                    setEditingId(expense.id);
                    setFormOverride({
                      entryDate: expense.entryDate,
                      category: expense.category,
                      amount: centsToDollarInput(expense.amountCents),
                      note: expense.note ?? "",
                    });
                    setErrors({});
                  }}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={secondaryButton}
                  disabled={saving}
                  onClick={() => removeExpense(expense.id)}
                >
                  Delete
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {mode === "admin" ? (
        <form
          className="mt-8 grid gap-5 rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:p-8"
          onSubmit={saveExpense}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <PortalField id={`expense-date-${carId}`} label="Date" error={errors.entryDate}>
              <Input
                id={`expense-date-${carId}`}
                type="date"
                value={form.entryDate}
                onChange={(event) => setFormOverride({ ...form, entryDate: event.target.value })}
                className={controlClass}
                required
              />
            </PortalField>
            <PortalField id={`expense-category-${carId}`} label="Category" error={errors.category}>
              <select
                id={`expense-category-${carId}`}
                value={form.category}
                onChange={(event) =>
                  setFormOverride({ ...form, category: event.target.value as ExpenseCategory })
                }
                className={`${controlClass} rounded-lg border border-input bg-transparent px-2.5`}
              >
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {EXPENSE_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </PortalField>
          </div>
          {form.category === "commission" ? (
            <p className="text-sm text-white/70">
              The Panamerica management fee is now added to each statement automatically. Log Commission only for a
              charge that is not the management fee.
            </p>
          ) : null}
          <PortalField id={`expense-amount-${carId}`} label="Amount" error={errors.amount}>
            <Input
              id={`expense-amount-${carId}`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="125.50"
              value={form.amount}
              onChange={(event) => setFormOverride({ ...form, amount: event.target.value })}
              className={controlClass}
              required
            />
          </PortalField>
          <PortalField id={`expense-note-${carId}`} label="Note" error={errors.note}>
            <Textarea
              id={`expense-note-${carId}`}
              value={form.note}
              onChange={(event) => setFormOverride({ ...form, note: event.target.value })}
              className={`${controlClass} min-h-24`}
            />
          </PortalField>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" className={primaryButton} disabled={saving}>
              {editingId ? "Save expense" : "Add expense"}
            </Button>
            {editingId ? (
              <Button
                type="button"
                variant="outline"
                className={secondaryButton}
                onClick={() => {
                  setEditingId(null);
                  setFormOverride(blankForm(today));
                  setErrors({});
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
