"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { portalRequest } from "@/components/portal/api";
import { PortalField, PortalNotice, portalInputClass } from "@/components/portal/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dollarsToCents, formatMonthLabel, formatUsdFromCents } from "@/lib/portal/ledger";
import type { CarStatementJson, PayoutJson } from "@/lib/portal/types";

import { StatementSheet } from "./statement-sheet";

const primaryButton =
  "h-11 bg-red px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-red/90";
const secondaryButton =
  "h-11 border-white/25 bg-transparent px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-white/10 hover:text-white";
const controlClass = `${portalInputClass} w-full min-w-0 [color-scheme:dark]`;

function signed(cents: number): string {
  return cents < 0 ? `(${formatUsdFromCents(-cents)})` : formatUsdFromCents(cents);
}

export function statementPath(mode: "owner" | "admin", carId: number, month: string): string {
  return mode === "admin"
    ? `/api/portal/admin/cars/${carId}/statement?month=${month}`
    : `/api/portal/cars/${carId}/statement?month=${month}`;
}

export function CarStatement({
  carId,
  mode,
  month,
  today,
  reloadToken,
}: {
  carId: number;
  mode: "owner" | "admin";
  month: string;
  today: string;
  reloadToken: number;
}) {
  const [data, setData] = useState<CarStatementJson | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [localReload, setLocalReload] = useState(0);
  const [amount, setAmount] = useState("");
  const [paidDate, setPaidDate] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const monthReady = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);

  useEffect(() => {
    if (!monthReady) return;
    let cancelled = false;
    (async () => {
      const result = await portalRequest<CarStatementJson>(statementPath(mode, carId, month));
      if (cancelled) return;
      if (!result.ok || !result.data) {
        setLoadError("Could not load the statement.");
        setData(null);
        return;
      }
      setLoadError("");
      setData(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [carId, mode, month, monthReady, reloadToken, localReload]);

  async function recordPayout(event: FormEvent) {
    event.preventDefault();
    const cents = dollarsToCents(amount);
    if (cents === null) {
      setErrors({ amount: "Enter a dollar amount greater than zero, such as 450.00." });
      return;
    }
    setSaving(true);
    setNotice("");
    const result = await portalRequest<{ payout: PayoutJson }>(`/api/portal/admin/cars/${carId}/payouts`, {
      method: "POST",
      body: { periodMonth: month, paidDate: paidDate ?? today, amountCents: cents, note },
    });
    setSaving(false);
    if (!result.ok) {
      const fields = { ...(result.error?.fields ?? {}) };
      if (fields.amountCents) fields.amount = fields.amountCents;
      setErrors(fields);
      setNotice("Could not record the payout.");
      return;
    }
    setErrors({});
    setAmount("");
    setNote("");
    setNotice("Payout recorded.");
    setLocalReload((value) => value + 1);
  }

  async function removePayout(id: number) {
    if (!window.confirm("Delete this payout record?")) return;
    setSaving(true);
    setNotice("");
    const result = await portalRequest(`/api/portal/admin/cars/${carId}/payouts/${id}`, { method: "DELETE" });
    setSaving(false);
    setNotice(result.ok ? "Payout deleted." : "Could not delete the payout.");
    if (result.ok) setLocalReload((value) => value + 1);
  }

  const printHref = `/${mode === "admin" ? "admin" : "owner"}/statement/?car=${carId}&month=${month}`;
  const history = data ? [...data.history].reverse().slice(0, 12) : [];

  return (
    <section id="car-statement" className="mt-10 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-xl font-bold text-white">Monthly statement</h3>
        {monthReady ? (
          <Link href={printHref} className="font-heading text-xs tracking-[0.16em] text-gold uppercase hover:underline">
            Printable statement
          </Link>
        ) : null}
      </div>
      {loadError ? <PortalNotice>{loadError}</PortalNotice> : null}
      {notice ? <PortalNotice>{notice}</PortalNotice> : null}
      {data ? (
        <div className="mt-4">
          <StatementSheet data={data} variant="dark" />
          <p className="mt-3 text-sm text-white/75">
            Owed across all months, net of payouts recorded: {formatUsdFromCents(data.totalPayoutDueCents)}
          </p>
        </div>
      ) : null}

      {mode === "admin" && data ? (
        <div className="mt-6 rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:p-8">
          <h4 className="font-heading text-xs tracking-[0.16em] text-gold uppercase">
            Payouts for {formatMonthLabel(month)}
          </h4>
          <ul className="mt-3 divide-y divide-white/10 text-sm text-white">
            {data.statement.payouts.length === 0 ? <li className="py-2 text-white/70">None recorded.</li> : null}
            {data.statement.payouts.map((payout) => (
              <li key={payout.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  {payout.paidDate} · {formatUsdFromCents(payout.amountCents)}
                  {payout.note ? ` · ${payout.note}` : ""}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className={secondaryButton}
                  disabled={saving}
                  onClick={() => removePayout(payout.id)}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
          {data.statement.month <= data.currentMonth ? (
            <form className="mt-5 grid gap-5 sm:grid-cols-3" onSubmit={recordPayout}>
              <PortalField id={`payout-date-${carId}`} label="Paid on" error={errors.paidDate}>
                <Input
                  id={`payout-date-${carId}`}
                  type="date"
                  value={paidDate ?? today}
                  onChange={(event) => setPaidDate(event.target.value)}
                  className={controlClass}
                  required
                />
              </PortalField>
              <PortalField id={`payout-amount-${carId}`} label="Amount" error={errors.amount}>
                <Input
                  id={`payout-amount-${carId}`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={data.statement.payoutDueCents > 0 ? (data.statement.payoutDueCents / 100).toFixed(2) : "450.00"}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className={controlClass}
                  required
                />
              </PortalField>
              <PortalField id={`payout-note-${carId}`} label="Note (optional)" error={errors.note}>
                <Input
                  id={`payout-note-${carId}`}
                  maxLength={80}
                  autoComplete="off"
                  placeholder={`${formatMonthLabel(month)} payout`}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  className={controlClass}
                />
              </PortalField>
              <p className="text-xs text-white/60 sm:col-span-3">
                No bank, account, or Zelle details. Records what was paid for this month only.
              </p>
              <div className="sm:col-span-3">
                <Button type="submit" className={primaryButton} disabled={saving}>
                  Record payout
                </Button>
              </div>
            </form>
          ) : (
            <p className="mt-3 text-sm text-white/70">Payouts can be recorded once the month starts.</p>
          )}
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="mt-6 overflow-x-auto rounded-xl ring-1 ring-white/10">
          <table className="w-full min-w-[40rem] text-left text-sm text-white">
            <caption className="sr-only">Running balance by month</caption>
            <thead className="bg-white/5 text-white/70">
              <tr>
                {["Month", "Carried in", "Income", "Expenses", "Fee", "Closing", "Paid", "Due / carried"].map((label) => (
                  <th key={label} className="px-3 py-2 font-heading text-xs tracking-[0.12em] uppercase">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.month} className="border-t border-white/10 tabular-nums">
                  <td className="px-3 py-2">
                    {row.month}
                    {row.open ? " (open)" : ""}
                  </td>
                  <td className="px-3 py-2">{signed(row.carryInCents)}</td>
                  <td className="px-3 py-2">{formatUsdFromCents(row.incomeCents)}</td>
                  <td className="px-3 py-2">{signed(-row.expenseCents)}</td>
                  <td className="px-3 py-2">{signed(-row.managementFeeCents)}</td>
                  <td className="px-3 py-2">{signed(row.closingBalanceCents)}</td>
                  <td className="px-3 py-2">{formatUsdFromCents(row.paidCents)}</td>
                  <td className="px-3 py-2">
                    {row.carryOutCents < 0 ? `${signed(row.carryOutCents)} carried` : `${formatUsdFromCents(row.payoutDueCents)} due`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
