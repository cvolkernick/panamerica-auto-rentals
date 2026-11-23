import { EXPENSE_CATEGORY_LABELS, isExpenseCategory } from "@/lib/portal/expenses";
import { formatMonthLabel, formatUsdFromCents } from "@/lib/portal/ledger";
import type { CarStatementJson } from "@/lib/portal/types";

function pct(bps: number): string {
  return `${bps / 100}%`;
}

function categoryLabel(category: string): string {
  return isExpenseCategory(category) ? EXPENSE_CATEGORY_LABELS[category] : category;
}

function signed(cents: number): string {
  return cents < 0 ? `(${formatUsdFromCents(-cents)})` : formatUsdFromCents(cents);
}

/**
 * The monthly statement for one car. Used on the car page (dark) and on the
 * printable page (paper). No guest names: trips show platform, dates, and status only.
 */
export function StatementSheet({
  data,
  variant,
}: {
  data: CarStatementJson;
  variant: "dark" | "paper";
}) {
  const s = data.statement;
  const paper = variant === "paper";
  const frame = paper
    ? "rounded-none bg-white p-8 text-neutral-900 ring-1 ring-neutral-300 print:ring-0 print:p-0"
    : "rounded-xl bg-navy-mid p-5 text-white ring-1 ring-white/10 sm:p-8";
  const muted = paper ? "text-neutral-600" : "text-white/65";
  const rule = paper ? "border-neutral-300" : "border-white/10";
  const accent = paper ? "text-neutral-900" : "text-gold";
  const monthLabel = formatMonthLabel(s.month);
  const tripRows = s.trips;

  return (
    <article className={frame} data-statement-sheet>
      <header className={`flex flex-wrap items-baseline justify-between gap-3 border-b pb-4 ${rule}`}>
        <div>
          <p className={`font-heading text-xs tracking-[0.2em] uppercase ${accent}`}>
            Panamerica owner statement
          </p>
          <h3 className="mt-1 text-2xl font-bold">
            {data.car.year} {data.car.make} {data.car.model}
          </h3>
          <p className={`mt-1 text-sm ${muted}`}>Plate {data.car.licensePlate}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold">{monthLabel}</p>
          <p className={`text-sm ${muted}`}>{s.open ? "Month still open, figures may change" : "Month closed"}</p>
        </div>
      </header>

      <section className="mt-6">
        <h4 className={`font-heading text-xs tracking-[0.16em] uppercase ${muted}`}>Trips starting this month</h4>
        {tripRows.length === 0 ? (
          <p className={`mt-2 text-sm ${muted}`}>No trips.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead className={muted}>
              <tr>
                <th className="py-1 pr-2 font-normal">Trip</th>
                <th className="py-1 pr-2 font-normal">Days</th>
                <th className="py-1 pr-2 text-right font-normal">Income</th>
                <th className="py-1 pr-2 text-right font-normal">Fee rate</th>
                <th className="py-1 text-right font-normal">Fee</th>
              </tr>
            </thead>
            <tbody>
              {tripRows.map((trip) => (
                <tr key={trip.id} className={`border-t ${rule}`}>
                  <td className="py-1.5 pr-2 align-top">
                    <span className="uppercase">{trip.platform}</span> {trip.startDate}
                    {trip.endDate ? ` – ${trip.endDate}` : ""} · {trip.status}
                    {trip.countsAsIncome ? null : <span className={`block text-xs ${muted}`}>Not counted yet</span>}
                  </td>
                  <td className="py-1.5 pr-2 align-top">{trip.days}</td>
                  <td className="py-1.5 pr-2 text-right align-top">
                    {trip.countsAsIncome ? formatUsdFromCents(trip.incomeCents) : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right align-top">{trip.countsAsIncome ? pct(trip.feeRateBps) : "—"}</td>
                  <td className="py-1.5 text-right align-top">
                    {trip.countsAsIncome ? formatUsdFromCents(trip.feeCents) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-6">
        <h4 className={`font-heading text-xs tracking-[0.16em] uppercase ${muted}`}>Statement</h4>
        <dl className="mt-2 text-sm">
          <Line label="Shortfall carried in" value={signed(s.carryInCents)} rule={rule} />
          <Line label="Rental income" value={formatUsdFromCents(s.incomeCents)} rule={rule} />
          {s.expenses.map((expense) => (
            <Line
              key={expense.id}
              label={`Expense · ${expense.entryDate} · ${categoryLabel(expense.category)}${expense.note ? ` · ${expense.note}` : ""}`}
              value={signed(-expense.amountCents)}
              rule={rule}
              indent
            />
          ))}
          <Line label="Expenses" value={signed(-s.expenseCents)} rule={rule} />
          <Line
            label="Panamerica management fee (on rental income, before expenses)"
            value={signed(-s.managementFeeCents)}
            rule={rule}
          />
          <Line label="Closing balance" value={signed(s.closingBalanceCents)} rule={rule} strong />
          <Line label="Payouts recorded" value={signed(-s.paidCents)} rule={rule} />
          {s.payouts.map((payout) => (
            <Line
              key={payout.id}
              label={`Paid ${payout.paidDate}${payout.note ? ` · ${payout.note}` : ""}`}
              value={formatUsdFromCents(payout.amountCents)}
              rule={rule}
              indent
            />
          ))}
          {s.carryOutCents < 0 ? (
            <Line label="Shortfall carried to next month" value={signed(s.carryOutCents)} rule={rule} strong />
          ) : (
            <Line
              label={s.open ? "Payout due if the month closed today" : "Payout due"}
              value={formatUsdFromCents(s.payoutDueCents)}
              rule={rule}
              strong
            />
          )}
        </dl>
        {s.overpaidCents > 0 ? (
          <p className={`mt-3 text-sm ${muted}`}>
            Payouts recorded are {formatUsdFromCents(s.overpaidCents)} more than this month now supports, after a
            later trip update. The difference comes out of later rental income.
          </p>
        ) : null}
      </section>

      <footer className={`mt-6 border-t pt-4 text-xs leading-relaxed ${rule} ${muted}`}>
        <p>{data.rules.fee}</p>
        <p className="mt-1">
          Fee tiers by trip length: {data.feeTiers.map((tier) => `${tier.label} ${pct(tier.bps)}`).join(" · ")}.
        </p>
        <p className="mt-1">{data.rules.carry}</p>
        <p className="mt-1">{data.rules.attribution}</p>
      </footer>
    </article>
  );
}

function Line({
  label,
  value,
  rule,
  strong,
  indent,
}: {
  label: string;
  value: string;
  rule: string;
  strong?: boolean;
  indent?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-4 border-t py-1.5 ${rule} ${strong ? "font-bold" : ""} ${indent ? "pl-4 text-xs" : ""}`}>
      <dt className="min-w-0 wrap-anywhere">{label}</dt>
      <dd className="shrink-0 tabular-nums">{value}</dd>
    </div>
  );
}
