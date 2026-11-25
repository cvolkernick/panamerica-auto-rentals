"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { portalRequest } from "@/components/portal/api";
import { PortalRoleSwitcher } from "@/components/portal/role-switcher";
import { PortalLogin, PortalLogout, PortalNotice, PortalShell } from "@/components/portal/ui";
import { sessionRoleFlags } from "@/lib/portal/destinations";
import { formatMonthLabel, formatUsdFromCents } from "@/lib/portal/ledger";
import { bpsToPercentLabel, type ManagerAccrual, type RateJson } from "@/lib/portal/managers";
import type { SessionJson } from "@/lib/portal/types";

const card = "rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:p-8";
const th = "py-2 pr-4 text-left font-heading text-xs tracking-[0.14em] text-white/55 uppercase";
const td = "py-2 pr-4 align-top text-white/90";
const selectClass =
  "h-11 rounded-lg border border-white/25 bg-transparent px-2.5 text-base text-white [&>option]:text-black";

type Window = { startDate: string; endDate: string | null };

type ManagedCar = {
  id: number;
  ownerId: number;
  year: number;
  make: string;
  model: string;
  color: string;
  licensePlate: string;
  vin: string;
  windows: Window[];
  current: boolean;
  months: string[];
};

type Self = {
  manager: { id: number; name: string; shareBps: number | null; rates: RateJson[] };
  accrual: ManagerAccrual;
};

type Statement = {
  month: string;
  windows: Window[];
  trips: {
    id: number;
    platform: string;
    startDate: string;
    endDate: string | null;
    days: number;
    incomeCents: number;
    feeCents: number;
    shareBps: number;
    shareCents: number;
  }[];
  expenses: { id: number; entryDate: string; category: string; amountCents: number; note: string | null }[];
  totals: { tripCount: number; incomeCents: number; expenseCents: number; feeCents: number; shareCents: number };
};

type Gate =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "not-manager"; email: string; owner: boolean }
  | { kind: "error" }
  | { kind: "ready"; session: SessionJson; self: Self; cars: ManagedCar[] };

const usd = formatUsdFromCents;

function windowLabel(w: Window): string {
  return w.endDate ? `${w.startDate} to before ${w.endDate}` : `${w.startDate} to now`;
}

function CarStatement({ car }: { car: ManagedCar }) {
  const [month, setMonth] = useState(car.months[car.months.length - 1] ?? "");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    (async () => {
      const result = await portalRequest<Statement>(
        `/api/portal/manager/cars/${car.id}/statement?month=${encodeURIComponent(month)}`
      );
      if (cancelled) return;
      setFailed(!result.ok || !result.data);
      setStatement(result.ok && result.data ? result.data : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [car.id, month]);

  if (!month) return null;
  return (
    <div className="mt-6">
      <label className="flex flex-wrap items-center gap-3 text-sm text-white/70">
        <span className="font-heading text-xs tracking-[0.16em] uppercase">Month</span>
        <select className={selectClass} value={month} onChange={(e) => setMonth(e.target.value)}>
          {car.months.map((m) => (
            <option key={m} value={m}>
              {formatMonthLabel(m)}
            </option>
          ))}
        </select>
      </label>
      {failed ? <PortalNotice>Could not load this month.</PortalNotice> : null}
      {statement ? (
        <div className="mt-4 grid gap-4">
          <p className="text-sm text-white/60">
            Shown only for the days you managed this car: {statement.windows.map(windowLabel).join(", ")}.
          </p>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Trip income", usd(statement.totals.incomeCents)],
              ["Expenses", usd(statement.totals.expenseCents)],
              ["Company fee", usd(statement.totals.feeCents)],
              ["Your share", usd(statement.totals.shareCents)],
            ].map(([term, value]) => (
              <div key={term}>
                <dt className="font-heading text-xs tracking-[0.14em] text-white/55 uppercase">{term}</dt>
                <dd className="mt-1 text-lg font-bold text-white">{value}</dd>
              </div>
            ))}
          </dl>
          {statement.trips.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr>
                    <th className={th}>Start</th>
                    <th className={th}>Days</th>
                    <th className={th}>Income</th>
                    <th className={th}>Company fee</th>
                    <th className={th}>Rate</th>
                    <th className={th}>Your share</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.trips.map((t) => (
                    <tr key={t.id} className="border-t border-white/10">
                      <td className={td}>{t.startDate}</td>
                      <td className={td}>{t.days}</td>
                      <td className={td}>{usd(t.incomeCents)}</td>
                      <td className={td}>{usd(t.feeCents)}</td>
                      <td className={td}>{bpsToPercentLabel(t.shareBps)}</td>
                      <td className={td}>{usd(t.shareCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-white/60">No trips in your days this month.</p>
          )}
          {statement.expenses.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Expense</th>
                    <th className={th}>Amount</th>
                    <th className={th}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.expenses.map((e) => (
                    <tr key={e.id} className="border-t border-white/10">
                      <td className={td}>{e.entryDate}</td>
                      <td className={td}>{e.category}</td>
                      <td className={td}>{usd(e.amountCents)}</td>
                      <td className={td}>{e.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ManagerPortal() {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await portalRequest<SessionJson>("/api/portal/session");
      if (cancelled) return;
      if (session.network || (!session.ok && session.status !== 401)) return setGate({ kind: "error" });
      if (session.status === 401 || !session.data) return setGate({ kind: "signed-out" });
      if (!session.data.roles?.manager) {
        return setGate({
          kind: "not-manager",
          email: session.data.email,
          owner: Boolean(session.data.roles?.owner),
        });
      }
      const [self, cars] = await Promise.all([
        portalRequest<Self>("/api/portal/manager"),
        portalRequest<{ cars: ManagedCar[] }>("/api/portal/manager/cars"),
      ]);
      if (cancelled) return;
      if (!self.ok || !self.data || !cars.ok || !cars.data) return setGate({ kind: "error" });
      setGate({ kind: "ready", session: session.data, self: self.data, cars: cars.data.cars });
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  if (gate.kind === "signed-out") return <PortalLogin onSuccess={() => setReloadToken((v) => v + 1)} />;
  if (gate.kind === "loading" || gate.kind === "error") {
    return (
      <PortalShell eyebrow="Manager" title="Managed cars">
        <PortalNotice>{gate.kind === "loading" ? "Loading." : "Could not load the manager view. Refresh and try again."}</PortalNotice>
      </PortalShell>
    );
  }
  if (gate.kind === "not-manager") {
    return (
      <PortalShell eyebrow="403" title="This login is not a manager">
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70">
          Signed in as {gate.email}. Panamerica has not linked this login to a manager.
          {gate.owner ? (
            <>
              {" "}
              <Link href="/owner/" className="text-gold hover:underline">
                Open your cars
              </Link>
              .
            </>
          ) : null}
        </p>
      </PortalShell>
    );
  }

  const { session, self, cars } = gate;
  return (
    <PortalShell
      eyebrow="Manager"
      title="Managed cars"
      lede={
        <>
          Signed in as {session.email}. Your share: {self.manager.shareBps === null ? "not started" : bpsToPercentLabel(self.manager.shareBps)} of
          the company fee on trips that start while you manage the car. This view is read-only.
        </>
      }
      switcher={<PortalRoleSwitcher roles={sessionRoleFlags(session)} current="manager" />}
      actions={<PortalLogout onDone={() => setReloadToken((v) => v + 1)} />}
    >
      <section className={`mt-10 ${card}`} aria-labelledby="earnings-title">
        <h2 id="earnings-title" className="font-heading text-sm tracking-[0.16em] text-gold uppercase">
          Your earnings
        </h2>
        <p className="mt-3 text-3xl font-bold text-white">{usd(self.accrual.accruedCents)}</p>
        <p className="mt-1 text-sm text-white/60">
          Accrued on {self.accrual.tripCount} trips. Payouts to managers come in a later phase.
        </p>
        {self.accrual.months.length > 0 ? (
          <table className="mt-6 w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Month</th>
                <th className={th}>Trips</th>
                <th className={th}>Company fee</th>
                <th className={th}>Your share</th>
              </tr>
            </thead>
            <tbody>
              {self.accrual.months.map((m) => (
                <tr key={m.month} className="border-t border-white/10">
                  <td className={td}>{formatMonthLabel(m.month)}</td>
                  <td className={td}>{m.tripCount}</td>
                  <td className={td}>{usd(m.feeCents)}</td>
                  <td className={td}>{usd(m.shareCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {cars.length === 0 ? (
        <p className="mt-10 text-base leading-relaxed text-white/70">No cars assigned yet.</p>
      ) : (
        <ul className="mt-10 grid gap-10">
          {cars.map((car) => (
            <li key={car.id} className={`min-w-0 ${card}`}>
              <p className="font-heading text-xs tracking-[0.28em] text-gold uppercase">
                {car.year} · {car.current ? "Managing now" : "Managed before"}
              </p>
              <h2 className="mt-2 text-2xl font-bold break-words text-white">
                {car.make} {car.model}
              </h2>
              <p className="mt-2 text-sm text-white/70 wrap-anywhere">
                {car.color} · {car.licensePlate} · VIN {car.vin}
              </p>
              <p className="mt-2 text-sm text-white/60">Your dates: {car.windows.map(windowLabel).join(", ")}</p>
              <CarStatement car={car} />
            </li>
          ))}
        </ul>
      )}
    </PortalShell>
  );
}
