"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { portalRequest, portalUpload } from "@/components/portal/api";
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
import { isApexHost } from "@/lib/portal/hosts";
import { importIdFromPath, importReviewHref } from "@/lib/portal/import-path";
import { formatUsdFromCents } from "@/lib/portal/ledger";
import type { CarJson, PortalErrorJson, SessionJson } from "@/lib/portal/types";

const primaryButton =
  "h-11 bg-red px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-red/90";
const secondaryButton =
  "h-11 border-white/25 bg-transparent px-5 font-heading tracking-[0.16em] text-white uppercase hover:bg-white/10 hover:text-white";

type Gate =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "forbidden"; email?: string }
  | { kind: "not-admin" }
  | { kind: "error" }
  | { kind: "ready" };

type ImportLine = {
  id: number;
  rowNumber: number;
  externalTripId: string | null;
  externalVehicleId: string | null;
  vin: string | null;
  plate: string | null;
  plateFallback: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  payoutCents: number | null;
  hasPending: boolean;
  matchStatus: string;
  error: string | null;
};

type ReviewItem = {
  id: number;
  rowNumber: number | null;
  kind: string;
  externalTripId: string | null;
  typeRaw: string | null;
  detail: Record<string, string>;
};

type ImportPayload = {
  import: {
    id: number;
    platform: string;
    filename: string;
    status: string;
    counts: {
      total: number;
      matched: number;
      unmatched: number;
      ambiguous: number;
      invalid: number;
    };
  };
  unmatched: ImportLine[];
  ambiguous: ImportLine[];
  invalid: ImportLine[];
  reviewItems: ReviewItem[];
};

type ImportList = {
  imports: {
    id: number;
    platform: string;
    filename: string;
    status: string;
    rowCount: number;
  }[];
};

const REVIEW_FIELDS = [
  "bookingId",
  "Type",
  "Date",
  "Deposit Date",
  "Amount",
  "Credit",
  "Debit",
  "CC Fee",
  "Wheelbase Fee",
  "reason",
  "Status",
  "Vehicle Internal ID",
  "Subtotal",
  "Start",
  "End",
];

function redirectApexToWww(): boolean {
  if (!isApexHost(window.location.hostname)) return false;
  const target = new URL(window.location.href);
  target.hostname = "www.panamericafleet.com";
  target.protocol = "https:";
  window.location.replace(target.toString());
  return true;
}

function fileError(error: PortalErrorJson | null): string {
  return error?.fields?.file || error?.fields?.body || "Could not import that file.";
}

function LineTable({
  title,
  rows,
  cars,
  busy,
  onAssign,
  onSkip,
  onDiscard,
}: {
  title: string;
  rows: ImportLine[];
  cars: CarJson[];
  busy: boolean;
  onAssign: (rowId: number, carId: number) => void;
  onSkip: (rowId: number) => void;
  onDiscard: (rowId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Record<number, string>>({});
  if (rows.length === 0) return null;
  const needle = query.trim().toLowerCase();
  const choices = cars.filter((car) => {
    if (!needle) return true;
    const haystack = `${car.year} ${car.make} ${car.model} ${car.licensePlate} ${car.vin}`.toLowerCase();
    return haystack.includes(needle);
  });
  return (
    <section className="mt-10 min-w-0">
      <h2 className="text-2xl font-bold text-white">{title}</h2>
      <div className="mt-4 max-w-md">
        <PortalField id={`${title}-car-search`} label="Find a car">
          <Input
            id={`${title}-car-search`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={portalInputClass}
            placeholder="Year, make, plate, or VIN"
          />
        </PortalField>
      </div>
      <div className="mt-4 min-w-0 overflow-hidden rounded-xl ring-1 ring-white/10">
        <table className="w-full text-left text-sm text-white">
          <caption className="sr-only">{title}</caption>
          <thead className="bg-white/5 text-white/70">
            <tr>
              <th className="px-3 py-3 font-heading text-xs tracking-[0.14em] uppercase">Row</th>
              <th className="px-3 py-3 font-heading text-xs tracking-[0.14em] uppercase">Trip</th>
              <th className="px-3 py-3 font-heading text-xs tracking-[0.14em] uppercase">Car</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-white/10 align-top">
                <td className="px-3 py-3">{row.rowNumber}</td>
                <td className="px-3 py-3 wrap-anywhere">
                  <p>{row.externalTripId ?? "—"}</p>
                  <p className="mt-1 text-white/70">
                    {row.startDate ?? "—"}
                    {row.endDate ? ` – ${row.endDate}` : ""} · {row.status ?? "—"}
                  </p>
                  <p className="mt-1 text-white/70">
                    Payout {row.payoutCents === null ? "—" : formatUsdFromCents(row.payoutCents)}
                    {row.hasPending ? " · pending deposit" : ""}
                  </p>
                  <p className="mt-1 text-white/70">
                    VIN {row.vin ?? "—"} · Plate {row.plate ?? "—"}
                    {row.plateFallback ? ` · fallback ${row.plateFallback}` : ""}
                  </p>
                  <p className="mt-1 text-white/70">Vehicle id {row.externalVehicleId ?? "—"}</p>
                  {row.error ? <p className="mt-1 text-white/60">{row.error}</p> : null}
                </td>
                <td className="px-3 py-3">
                  {row.matchStatus === "invalid" ? (
                    <Button
                      type="button"
                      variant="outline"
                      className={secondaryButton}
                      disabled={busy}
                      onClick={() => onDiscard(row.id)}
                    >
                      Remove
                    </Button>
                  ) : (
                    <div className="grid gap-2">
                      <select
                        aria-label={`Car for row ${row.rowNumber}`}
                        value={picked[row.id] ?? ""}
                        onChange={(event) => setPicked({ ...picked, [row.id]: event.target.value })}
                        className={`${portalInputClass} rounded-lg border border-input bg-transparent px-2.5`}
                      >
                        <option value="">Choose a car</option>
                        {choices.map((car) => (
                          <option key={car.id} value={car.id}>
                            {car.year} {car.make} {car.model} · {car.licensePlate}
                          </option>
                        ))}
                      </select>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          className={primaryButton}
                          disabled={busy || !picked[row.id]}
                          onClick={() => onAssign(row.id, Number(picked[row.id]))}
                        >
                          Assign
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className={secondaryButton}
                          disabled={busy}
                          onClick={() => onSkip(row.id)}
                        >
                          Skip
                        </Button>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ImportsAdmin() {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [importId, setImportId] = useState<number | null>(null);
  const [payload, setPayload] = useState<ImportPayload | null>(null);
  const [history, setHistory] = useState<ImportList["imports"]>([]);
  const [cars, setCars] = useState<CarJson[]>([]);
  const [platform, setPlatform] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [reservations, setReservations] = useState<File | null>(null);
  const [transactions, setTransactions] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (redirectApexToWww()) return;
    const id = importIdFromPath(window.location.pathname);
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
      setEmail(session.data.email);
      setImportId(id);
      const [list, carList, review] = await Promise.all([
        portalRequest<ImportList>("/api/portal/admin/imports"),
        portalRequest<{ cars: CarJson[] }>("/api/portal/admin/cars"),
        id ? portalRequest<ImportPayload>(`/api/portal/admin/imports/${id}`) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (!list.ok || !list.data || !carList.ok || !carList.data) {
        setGate({ kind: "error" });
        return;
      }
      setHistory(list.data.imports);
      setCars(carList.data.cars);
      if (review && !review.ok) {
        setNotice(review.status === 404 ? "That import was not found." : "Could not load the import.");
      } else if (review?.data) {
        setPayload(review.data);
      }
      setGate({ kind: "ready" });
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    const form = new FormData();
    if (platform) form.set("platform", platform);
    if (platform === "wheelbase") {
      if (!reservations || !transactions) {
        setNotice("Wheelbase needs both the bookings file and the transactions file.");
        return;
      }
      form.set("reservations", reservations);
      form.set("transactions", transactions);
    } else if (!file) {
      setNotice("Choose a CSV to import.");
      return;
    } else {
      form.set("file", file);
    }
    setBusy(true);
    setNotice("");
    const result = await portalUpload<ImportPayload>("/api/portal/admin/imports", form);
    setBusy(false);
    if (!result.ok || !result.data) {
      setNotice(fileError(result.error));
      return;
    }
    window.location.assign(importReviewHref(result.data.import.id));
  }

  async function postAction(path: string, body?: unknown) {
    setBusy(true);
    setNotice("");
    const result = await portalRequest<ImportPayload>(path, { method: "POST", body });
    setBusy(false);
    if (!result.ok || !result.data) {
      setNotice(result.error?.reason === "unresolved_rows"
        ? "Resolve or skip every unmatched row before import."
        : "Could not update this import.");
      return;
    }
    const saved = result.data;
    setPayload(saved);
    setHistory((current) =>
      current.map((item) =>
        item.id === saved.import.id ? { ...item, status: saved.import.status } : item
      )
    );
  }

  if (gate.kind === "signed-out") {
    return <PortalLogin onSuccess={() => setReloadToken((value) => value + 1)} />;
  }
  if (gate.kind === "forbidden") return <PortalForbidden email={gate.email} />;
  if (gate.kind === "not-admin") {
    return (
      <PortalShell eyebrow="403" title="Admin only">
        <p className="mt-4 text-white/70">Signed in as {email}. This page is for admins.</p>
      </PortalShell>
    );
  }
  if (gate.kind === "loading") {
    return (
      <PortalShell eyebrow="Admin" title="Trip import">
        <PortalNotice>Loading.</PortalNotice>
      </PortalShell>
    );
  }
  if (gate.kind === "error") {
    return (
      <PortalShell eyebrow="Admin" title="Trip import">
        <PortalNotice>Could not load imports. Refresh and try again.</PortalNotice>
      </PortalShell>
    );
  }

  const open = payload?.import;
  const blocked = (open?.counts.unmatched ?? 0) + (open?.counts.ambiguous ?? 0) > 0;
  const review = payload;

  return (
    <PortalShell
      eyebrow="Admin"
      title="Trip import"
      lede={
        <>
          Signed in as {email}. Upload a Turo trip earnings CSV, or both Wheelbase files. Guest
          names are not stored.
        </>
      }
      actions={
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/admin/" className="font-heading text-sm tracking-[0.16em] text-gold uppercase">
            Back
          </Link>
          <PortalLogout onDone={() => setReloadToken((value) => value + 1)} />
        </div>
      }
    >
      {notice ? <PortalNotice>{notice}</PortalNotice> : null}
      <form className="mt-8 grid gap-5 rounded-xl bg-navy-mid p-5 ring-1 ring-white/10 sm:p-8" onSubmit={upload}>
        <PortalField id="import-platform" label="Platform">
          <select
            id="import-platform"
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
            className={`${portalInputClass} rounded-lg border border-input bg-transparent px-2.5`}
          >
            <option value="">Detect from the headers</option>
            <option value="turo">Turo</option>
            <option value="wheelbase">Wheelbase</option>
          </select>
        </PortalField>
        {platform === "wheelbase" ? (
          <>
            <PortalField id="import-reservations" label="Bookings CSV (booking-export.csv)">
              <Input
                id="import-reservations"
                type="file"
                accept=".csv,text/csv"
                className={portalInputClass}
                onChange={(event) => setReservations(event.target.files?.[0] ?? null)}
              />
            </PortalField>
            <PortalField id="import-transactions" label="Transactions CSV (transactions-export.csv)">
              <Input
                id="import-transactions"
                type="file"
                accept=".csv,text/csv"
                className={portalInputClass}
                onChange={(event) => setTransactions(event.target.files?.[0] ?? null)}
              />
            </PortalField>
          </>
        ) : (
          <PortalField
            id="import-file"
            label={platform === "turo" ? "Trip earnings CSV (trip_earnings_export_….csv)" : "Trip CSV"}
          >
            <Input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              className={portalInputClass}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </PortalField>
        )}
        <Button type="submit" className={primaryButton} disabled={busy}>
          Upload
        </Button>
      </form>

      {open && review ? (
        <section className="mt-10">
          <h2 className="text-2xl font-bold text-white">
            {open.platform} · {open.filename}
          </h2>
          <p className="mt-2 text-white/70">
            {open.counts.total} rows · {open.counts.matched} matched · {open.counts.unmatched} unmatched
            · {open.counts.ambiguous} ambiguous · {open.counts.invalid} skipped · {open.status}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              className={primaryButton}
              disabled={busy || open.status !== "preview" || blocked}
              onClick={() => postAction(`/api/portal/admin/imports/${open.id}/commit`)}
            >
              Import matched trips
            </Button>
            <Button
              type="button"
              variant="outline"
              className={secondaryButton}
              disabled={busy || open.status !== "preview"}
              onClick={() => {
                if (window.confirm("Discard this preview?")) {
                  void postAction(`/api/portal/admin/imports/${open.id}/discard`);
                }
              }}
            >
              Discard preview
            </Button>
          </div>
          <LineTable
            title="Unmatched"
            rows={review.unmatched}
            cars={cars}
            busy={busy}
            onAssign={(rowId, carId) =>
              postAction(`/api/portal/admin/imports/${open.id}/rows/${rowId}/match`, { carId })
            }
            onSkip={(rowId) => postAction(`/api/portal/admin/imports/${open.id}/rows/${rowId}/skip`)}
            onDiscard={(rowId) => postAction(`/api/portal/admin/imports/${open.id}/rows/${rowId}/discard`)}
          />
          <LineTable
            title="Ambiguous"
            rows={review.ambiguous}
            cars={cars}
            busy={busy}
            onAssign={(rowId, carId) =>
              postAction(`/api/portal/admin/imports/${open.id}/rows/${rowId}/match`, { carId })
            }
            onSkip={(rowId) => postAction(`/api/portal/admin/imports/${open.id}/rows/${rowId}/skip`)}
            onDiscard={(rowId) => postAction(`/api/portal/admin/imports/${open.id}/rows/${rowId}/discard`)}
          />
          <LineTable
            title="Skipped"
            rows={review.invalid}
            cars={cars}
            busy={busy}
            onAssign={(rowId, carId) =>
              postAction(`/api/portal/admin/imports/${open.id}/rows/${rowId}/match`, { carId })
            }
            onSkip={(rowId) => postAction(`/api/portal/admin/imports/${open.id}/rows/${rowId}/skip`)}
            onDiscard={(rowId) => postAction(`/api/portal/admin/imports/${open.id}/rows/${rowId}/discard`)}
          />
          {review.reviewItems.length > 0 ? (
            <section className="mt-10">
              <h2 className="text-2xl font-bold text-white">Needs a mapping</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">
                These rows were not guessed and were not dropped. The rest of the file can still
                import. Unknown transaction types stay here until a mapping is added.
              </p>
              <ul className="mt-4 divide-y divide-white/10 rounded-xl bg-navy-mid px-5 ring-1 ring-white/10">
                {review.reviewItems.map((item) => (
                  <li key={item.id} className="py-4 text-sm text-white/80">
                    <p className="text-white">
                      {item.kind}
                      {item.typeRaw ? ` · ${item.typeRaw}` : ""}
                      {item.externalTripId ? ` · booking ${item.externalTripId}` : ""}
                      {item.rowNumber ? ` · row ${item.rowNumber}` : ""}
                    </p>
                    <dl className="mt-2 grid gap-1">
                      {REVIEW_FIELDS.filter((key) => item.detail[key]).map((key) => (
                        <div key={key} className="grid grid-cols-[10rem_minmax(0,1fr)] gap-2">
                          <dt className="text-white/55">{key}</dt>
                          <dd className="wrap-anywhere">{item.detail[key]}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>
      ) : null}

      {history.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-xl font-bold text-white">Recent imports</h2>
          <ul className="mt-4 divide-y divide-white/10">
            {history.map((item) => (
              <li key={item.id} className="py-3 text-sm text-white/80">
                <a href={importReviewHref(item.id)} className="text-gold hover:underline">
                  {item.platform} · {item.filename}
                </a>
                <span>
                  {" "}
                  · {item.rowCount} rows · {item.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PortalShell>
  );
}
