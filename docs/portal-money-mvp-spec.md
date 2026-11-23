# Panamerica owner portal money MVP

Build-ready spec. No code push, no deploy, and no production D1 writes were done while writing this.

- Approved by Chris at 10:48 PM ET (America/New_York) on Sunday, November 22, 2026, with the caveat that trip income must cover every platform the fleet uses, starting with Turo and Wheelbase.
- Test case: Justin Strickland's cars (already the owner-portal test case). Do not put other customer PII in code, fixtures, logs, or this document.
- Repo: `cvolkernick/panamerica-auto-rentals`
- Live site: `https://www.panamericafleet.com` (Cloudflare Pages + D1). Apex `/owner`, `/admin`, and `/api/portal` already 308 to www.
- Baseline: `origin/main` is now `50571dd3c1a6f2e91c9250dd6a9b08fbf88b1797` (after PRs #25 and #26). Earlier portal-schema snapshot: `2dcd3ed47a1c835b87bfddd2faa16afd225a6894` ("Publish final owner documents; remove draft labeling (#24)", November 19, 2026, 7:35 PM ET). PRs #25 and #26 were fleet-card updates only; portal schema is unchanged.

This release is one PR with three parts:

1. Multi-platform trip income import by CSV, admin only. Turo and Wheelbase first. Every trip is tagged with a platform. Each platform has its own column mapper, so a later platform is a new mapper plus tests, not a rewrite.
2. Manual expense entry per car in admin (date, category, amount, note). Owners can read expenses on their own cars and cannot edit them.
3. Per-car net report (income minus expenses) by month and to date. Owners see only their own cars. Admin sees all.

Do not merge, deploy, or apply the new migration to production D1 as part of the implementation PR. After CI is green, send the head SHA for a gate. Screenshots against Justin's cars happen only after that go, and only on a later deploy.

## 1. Current portal (as of `2dcd3ed`)

The public site is a Next.js static export. `/owner/` and `/admin/` are static shells that call Pages Functions at `/api/portal/*`. Booking on `/fleet` is unchanged. Fleet cards must never show a price. The owner onboarding checklist stays internal. Portal URLs are not in the nav, footer, or sitemap.

### 1.1 Auth model

- Email and password on `/owner/` and `/admin/`. No Cloudflare Access / Zero Trust.
- Browser derives an Argon2id key in WebAssembly. The Worker stores HMAC-SHA256 of that key with `PORTAL_PEPPER` and compares in constant time. The database never stores the password or the raw derived key.
- Server-side session row in D1. HttpOnly cookie `__Host-portal_session` (`Secure`, `SameSite=Lax`, `Path=/`, no `Domain`). Sessions last 7 days. Logout deletes the session. A new login rotates the session id.
- State-changing requests must be same-origin and must send the CSRF token from login or `GET /api/portal/session`.
- `owners.is_admin` marks an admin. `ADMIN_EMAILS` can also grant admin to an existing owners row. It does not create a login by itself.
- Every owner car query is `WHERE owner_id = <signed-in owner>`. Admin routes require admin.
- An admin can create a one-time invite link (`/owner/invite/?t=...`), 72-hour expiry, SHA-256 of the token stored, never the token.
- `PORTAL_DEV_AUTH` is a local bypass only, ignored on `www.panamericafleet.com`, `panamericafleet.com`, and `*.pages.dev`.
- Do not paste, log, or commit the portal password, `PORTAL_PEPPER`, setup tokens, or password hashes.

### 1.2 Current D1 schema

Database name `panamerica-portal`, Pages binding name `DB`. Migrations are applied manually with `wrangler d1 execute` and are not run from a deploy step. There is no `wrangler.toml` in the repo; the binding lives in the Pages project settings.

`migrations/0001_init.sql` — `owners` and `cars`:

- `owners`: `id`, `name`, `email` (NOCASE unique), `is_admin` (0/1), `created_at`
- `cars`: `id`, `owner_id` (FK, ON DELETE RESTRICT), `year`, `make`, `model`, `color`, `license_plate`, `vin` (NOCASE unique), `created_at`, `updated_at`
- VIN is the only unique car key. `license_plate` is required on write (letters, numbers, spaces, or hyphens, max 12) but is not unique in the schema. Admin plate lookup ignores case, spaces, and dashes and takes `LIMIT 1`.
- Cars have no listing name, no Turo vehicle id, and no Wheelbase vehicle id today.
- Seeded owner only: Panamerica Auto Rentals, `panamerica.cars@gmail.com`, admin. No car rows are seeded.

`migrations/0002_auth.sql` — `owners.password_hash`, `sessions` (`id_hash`, `owner_id`, `csrf_secret`, `expires_at`, `created_at`), `login_attempts`.

`migrations/0003_owner_invites.sql` — `owner_invites` (`token_hash`, `owner_id`, `created_at`, `expires_at`, `used_at`).

`migrations/0004_car_ledger.sql` — `car_ledger`: `id`, `car_id`, `entry_date` (`YYYY-MM-DD`), `type` (`trip_income`, `commission`, `maintenance`, `cleaning`, `tolls`, `insurance`, `payout`, `other`), `amount_cents` (always positive), `note` (max 200), `created_at`, `updated_at`, `created_by`. `trip_income` is money in; every other type is a deduction or a payout. Admin-only. Owners cannot see this ledger.

### 1.3 Current routes

Unauthenticated:

- `POST /api/portal/login`
- `POST /api/portal/logout` (also authenticated)
- `POST /api/portal/setup-password` (setup token; should stay unset in production)
- `POST /api/portal/invite`

Signed-in owner:

- `GET /api/portal/session`
- `GET /api/portal/cars` — only that owner's cars
- `GET /api/portal/cars/:id` — only if `owner_id` matches

Admin (`owners.is_admin` or `ADMIN_EMAILS`):

- `GET, POST /api/portal/admin/owners`
- `GET, PATCH /api/portal/admin/owners/:id`
- `POST /api/portal/admin/owners/:id/invite`
- `GET, POST /api/portal/admin/cars`
- `GET, PATCH, DELETE /api/portal/admin/cars/:id` (delete conflicts with `car_has_ledger`)
- `GET /api/portal/admin/cars/by-plate/:key`
- `GET, POST /api/portal/admin/cars/:id/ledger`
- `PATCH, DELETE /api/portal/admin/cars/:id/ledger/:entryId`

UI: `/owner/` lists year, make, model, color, plate, and VIN. `/admin/` manages owners and cars. `/admin/cars/<plate>` (or `/admin/cars/id-<id>`) shows the car, its owner, and the ledger.

### 1.4 Relationship to `car_ledger`

Do not write imported trips or the new expenses into `car_ledger`. Do not fold `car_ledger` rows into the new net report. Two books would double-count.

Leave the existing admin ledger UI and table in place for this PR, clearly separate from the new money views. A later cleanup can migrate leftover ledger rows or retire the table. The owner-facing report and the new admin money views read only from `trips` and `expenses`.

## 2. Export formats — confirmed vs unconfirmed

### 2.1 Turo trip earnings CSV — confirmed

This is the importer format for `platform = turo`.

**How to get it.** On the Turo host web dashboard (not the mobile app): Business / Earnings, pick a date range (all time for the first import), Download / Export CSV. Third-party guides say Turo may email a download link rather than attaching the file. Official Turo help mentions the trip earnings CSV (for example the Canada-taxes host page) but does not publish a column guide.

**Confirmed column list (47 columns, exact header text).** Confirmed from a real Panamerica trip-earnings file already on the box (`/workspace/turo/turo_earnings_2026-11-04.csv`, 62 trip rows). The headers match the FleetEarnings column guide (updated October 13, 2026, [fleetearnings.com/blog/how-to-read-turo-earnings-csv](https://fleetearnings.com/blog/how-to-read-turo-earnings-csv/)) and the Dhanurgo field reference ([dhanurgo.mintlify.app/data-reference/trip-earnings-csv](https://dhanurgo.mintlify.app/data-reference/trip-earnings-csv)). MyFleetOS also describes this as a 47-column Turo earnings export ([myfleetos.com/turo-csv-import](https://www.myfleetos.com/turo-csv-import), updated September 16, 2026).

| # | CSV column | Role in this MVP |
| --- | --- | --- |
| 1 | Reservation ID | `external_trip_id`. Unique per row in the confirmed file. 8-digit in that sample. |
| 2 | Guest | **Do not persist.** Do not log. |
| 3 | Vehicle | Listing text. In the confirmed file every row ends with a parenthetical plate, used as a fallback match key. |
| 4 | Vehicle name | Make/year/model text. Not unique. Do not match cars by this alone. |
| 5 | Vehicle id | Turo listing id. Remembered after a successful or admin-confirmed match. |
| 6 | VIN | Primary match key. In the confirmed file every row had a 17-character VIN. Treat empty VIN as possible on later files. |
| 7 | Trip start | Trip start, used for `start_at` and the report month. |
| 8 | Trip end | Trip end. |
| 9 | Pickup location | Do not persist (can be an address). |
| 10 | Return location | Do not persist (can be an address). |
| 11 | Trip status | See status rules below. |
| 12–14 | Check-in odometer, Check-out odometer, Distance traveled | Out of scope for this MVP. Do not require them. |
| 15 | Trip days | Optional, informational. Do not trust over start/end. |
| 16 | Trip price | Stored as `gross_cents` (base rental, not an all-in gross). |
| 17–26 | Boost price; 3-day, 1-week, 2-week, 3-week, 1-month, 2-month, 3-month discount; Non-refundable discount; Early bird discount; Host promotional credit | Not stored as first-class columns. Do not recompute totals from them. |
| 27–45 | Delivery, Excess distance, Extras, Cancellation fee, Additional usage, Late fee, Improper return fee, Airport operations fee, Airport parking credit, Tolls & tickets, On-trip EV charging, Post-trip EV charging, Smoking, Cleaning, Fines (paid to host), Gas reimbursement, Gas fee, Other fees | Same: do not recompute `Total earnings`. |
| 46 | Sales tax | Not used as payout. Turo has said host earnings are shown net of sales tax since December 15, 2023. |
| 47 | Total earnings | Stored as `payout_cents`. This is the host earnings figure for the trip. |

**Confirmed parse rules from the real file (these beat third-party docs where they disagree):**

- Encoding: UTF-8 with optional BOM. Parse with `utf-8-sig`.
- Dates: `YYYY-MM-DD HH:MM AM` or `YYYY-MM-DD HH:MM PM` (12-hour, no timezone). Store the naive local text plus a `start_date` / `end_date` of `YYYY-MM-DD`. Do not invent UTC.
- Money: values include a `$` sign. Discounts and some fees use a leading minus with a space, like `- $12.34`. The parser must accept `$12.34`, `- $12.34`, `-$12.34`, `(12.34)`, plain `12.34`, and thousands commas. Dhanurgo's claim that the file has no `$` was not true of this Panamerica export; support both.
- `Trip status` values seen in the real file: `Completed`, `Booked`, `In-progress`, `Guest cancellation`, `Host cancellation`.
- Reservation IDs were unique in the sample. Re-import is still keyed on `(platform, external_trip_id)`.
- Turo does not publish this column list and has changed the layout before. If a required header is missing, reject the file with a clear error and do not guess.

**Turo amounts — what is confirmed and what is not:**

- Confirmed payout / host earnings: `Total earnings`. Use it as-is. Do not sum line items to rebuild it. Third-party guides warn that the middle columns may not add up, in part because host share is not documented per column.
- Confirmed base rental: `Trip price`. Store as `gross_cents`. This is not all-in gross (it excludes delivery, extras, and many fees).
- **Unconfirmed at trip level: platform fees.** The 47-column trip earnings file has no "Turo fee" or "host share" column. A separate monthly "Earnings Report" CSV is described by Dhanurgo as having `Gross earnings`, `Turo fee`, and `Net earnings`, but no such file was found in Panamerica mail or on the box, so those headers are **not confirmed**. Leave `platform_fees_cents` NULL for Turo imports in this MVP. Do not invent a fee by subtraction.

**Status rules for the net report:**

- Import every well-formed row, including future and cancelled trips.
- Count toward income only when status is `Completed`, or when status is a cancellation and `payout_cents` is not zero (a cancellation fee is income).
- `Booked` and `In-progress` are stored and hidden from income totals until a later import updates the status. Re-import must update the same row.

**Caveat, reimbursements.** `Total earnings` can include toll, ticket, fuel, EV, cleaning, and smoking reimbursements, which are not profit if the matching cost is missing. This MVP still uses `Total earnings` as payout. A later split can flag reimbursements. Admin should still enter the matching expense when there is one.

### 2.2 Turo activity-style 8-column file — not the importer

Panamerica Gmail (`panamerica.cars@gmail.com`) had exactly one CSV attachment: `earnings_export_20260617.csv`, sent June 16, 2026 (email timestamp June 17, 2026, 2:08 AM ET) as "the CSV for the earnings." It is **not** the official 47-column trip earnings export.

Confirmed headers only: `Type`, `Reservation URL`, `Vehicle`, `Vehicle ID`, `Date`, `Earnings`, `Payment`, `Failed payment`. Grain is mixed (trip-labeled rows and payment rows; multiple rows can share one reservation URL). The `Type` column can identify guests, so this format must not be the source of truth and must not be stored raw.

Do not build the Turo mapper for this file in this MVP. If a later mapper is added, it needs its own idempotency rules and must drop guest-identifying text.

No official Turo "download your trip earnings" email with a 47-column attachment was found in that inbox. Weekly "Your earnings are on the way!" payout notices are not a trip export.

### 2.3 Wheelbase — confirmed two-file join (see §§14–15)

**Confirmed.** Chris provided Reservation Details and Transaction Log samples at 11:05 PM ET on November 22, 2026, and answered remaining match/tax/unknown-Type questions at 11:16 PM ET. Wheelbase is fully implemented per §§14–15; it is no longer a stub. Real samples contain guest PII and must not be committed. Use the anonymized fixtures in this transfer folder (`wheelbase_reservations_fixture.csv`, `wheelbase_transactions_fixture.csv`).

Wheelbase's own help still says the Reservation Details **export has significantly more columns** than the on-screen report. Official help below is background only. Do not guess column names or payout math beyond §§14–15.

**What official help does confirm (on-screen Reservation Details report, not confirmed as CSV headers).** Source: [Reservation details report reference guide](https://help.wheelbasepro.com/hc/en-us/articles/12598506024603-Reservation-details-report-reference-guide) (updated January 7, 2025) and [How can I see which reservations have outstanding balances?](https://help.wheelbasepro.com/hc/en-us/articles/12598084873627-How-can-I-see-which-reservations-have-outstanding-balances).

Path: Wheelbase dashboard → Reports → Reservation Details → filter by rental and/or date range (created, departs, returned) → export.

On-screen figures named in that guide:

| On-screen field | Official meaning | Notes (authoritative mapping is §§14–15) |
| --- | --- | --- |
| Rental Amount | Base rental amount | Candidate for `gross_cents` only after the export header is confirmed |
| Add-ons | Line-item add-ons (excludes insurance, premium services) | Unconfirmed in CSV |
| Mileage, Mileage Fee, Generator, Generator Fee | Usage and fees | Out of scope unless needed for payout |
| Subtotal | Booking total less taxes and renter fee; updates after return | Unconfirmed as host earnings |
| Tax | Tax on the booking | Not payout |
| Renter Fees | Outdoorsy guest service fee | Guest-side |
| Total | Total booking cost the guest pays | **Not host payout** |
| Paid, Due | Amount paid / outstanding | Not host payout |
| CC Fees | Transaction processing fees | Candidate fee component only after confirmation |
| Owner Fees | Outdoorsy lead fee on a confirmed marketplace booking | Candidate fee component only after confirmation |
| Renter Services Fee | Premium services and protection packages | Guest-side |
| Consigned Payout, Consigned Status | Link/status for consigned-owner payout reports | Only relevant if the row is a consigned unit |

**Resolved by the confirmed exports in §§14–15.** The MVP uses both files, joined on Booking ID: Reservation Details (trip-grained gross, tax, vehicle, dates) plus the Transaction Log (payment-grained CC Fee, Wheelbase Fee, Credit, Debit, Deposit Date). `external_trip_id` is Booking ID. Payout is Σ Credit − Σ Debit, not the guest-facing Total and not a guessed "Total Net Revenue" column. Vehicle match is plate-first, as in §15.

Do not put guest names into the repo. Official help for context: [ID numbers guide](https://help.wheelbasepro.com/hc/en-us/articles/12557348563483-How-to-find-ID-Numbers-for-Customers-Reservations-and-Vehicles), [Revenue Performance](https://help.wheelbasepro.com/hc/en-us/articles/47257464556443-Understanding-Your-Revenue-Performance-Report), [Transaction Log reference](https://help.wheelbasepro.com/hc/en-us/articles/12598677128731-Transaction-Log-reference-guide).

### 2.4 Auto-detection

- Turo trip earnings: all required headers present (`Reservation ID`, `VIN`, `Vehicle`, `Vehicle id`, `Trip start`, `Trip end`, `Trip status`, `Trip price`, `Total earnings`). Admin can still set the platform explicitly.
- Wheelbase: reservations file detects on confirmed headers including `Booking ID` and `Subtotal`. Transactions file detects on confirmed headers including `Reservation`, `Deposit Date`, `Type`, `CC Fee`, `Wheelbase Fee`, `Credit`, and `Debit`. Both files are required and are joined on Booking ID as in §§14–15.
- If headers match no registered mapper, reject the upload. Never invent a mapping.

## 3. D1 migration (`migrations/0005_trips_expenses.sql`)

Apply later with `wrangler d1 execute`, the same way as `0004`. Do not run it from a deploy step. Do not execute it against `--remote` / production as part of the implementation PR. `tests/portal/memory-d1.ts` already loads every `migrations/*.sql` file, so tests will pick this up.

All amounts are integer cents. Trip payout may be negative or zero (Turo documents negatives such as `- $6.06`). Expense amounts stay strictly positive, like `car_ledger`.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE car_platform_ids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL,
  platform TEXT NOT NULL COLLATE NOCASE,
  external_vehicle_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by INTEGER NOT NULL,
  FOREIGN KEY (car_id) REFERENCES cars (id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES owners (id) ON DELETE RESTRICT,
  UNIQUE (platform, external_vehicle_id)
);

CREATE INDEX idx_car_platform_ids_car ON car_platform_ids (car_id);

CREATE TABLE trip_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL COLLATE NOCASE,
  original_filename TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('preview', 'committed', 'discarded')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by INTEGER NOT NULL,
  committed_at TEXT,
  FOREIGN KEY (created_by) REFERENCES owners (id) ON DELETE RESTRICT
);

CREATE TABLE trip_import_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL,
  row_number INTEGER NOT NULL,
  external_trip_id TEXT,
  external_vehicle_id TEXT,
  vin TEXT,
  plate TEXT,
  start_at TEXT,
  end_at TEXT,
  start_date TEXT,
  end_date TEXT,
  status_raw TEXT,
  gross_cents INTEGER,
  platform_fees_cents INTEGER,
  payout_cents INTEGER,
  match_status TEXT NOT NULL CHECK (
    match_status IN ('matched', 'unmatched', 'ambiguous', 'invalid')
  ),
  car_id INTEGER,
  error TEXT,
  FOREIGN KEY (import_id) REFERENCES trip_imports (id) ON DELETE CASCADE,
  FOREIGN KEY (car_id) REFERENCES cars (id) ON DELETE SET NULL
);

CREATE INDEX idx_trip_import_rows_import ON trip_import_rows (import_id, match_status);

CREATE TABLE trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL,
  platform TEXT NOT NULL COLLATE NOCASE,
  external_trip_id TEXT NOT NULL,
  start_at TEXT,
  end_at TEXT,
  start_date TEXT NOT NULL CHECK (
    start_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
  ),
  end_date TEXT,
  status TEXT NOT NULL,
  counts_as_income INTEGER NOT NULL CHECK (counts_as_income IN (0, 1)),
  gross_cents INTEGER,
  platform_fees_cents INTEGER,
  payout_cents INTEGER NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  import_id INTEGER,
  FOREIGN KEY (car_id) REFERENCES cars (id) ON DELETE RESTRICT,
  FOREIGN KEY (import_id) REFERENCES trip_imports (id) ON DELETE SET NULL,
  UNIQUE (platform, external_trip_id)
);

CREATE INDEX idx_trips_car_date ON trips (car_id, start_date);
CREATE INDEX idx_trips_car_income ON trips (car_id, counts_as_income, start_date);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL,
  entry_date TEXT NOT NULL CHECK (
    entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
  ),
  category TEXT NOT NULL CHECK (
    category IN (
      'maintenance',
      'cleaning',
      'tolls',
      'insurance',
      'commission',
      'fuel',
      'registration',
      'parking',
      'supplies',
      'other'
    )
  ),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  note TEXT CHECK (note IS NULL OR length(note) <= 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by INTEGER NOT NULL,
  FOREIGN KEY (car_id) REFERENCES cars (id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES owners (id) ON DELETE RESTRICT
);

CREATE INDEX idx_expenses_car_date ON expenses (car_id, entry_date);
```

Notes:

- `platform` is free-text at the database layer (plus an application registry). Adding a platform later should not require a migration.
- Do not store guest names, pickup/return addresses, or the raw CSV in `trips`. `trip_imports` stores only the original filename, counts, and actor — not the file bytes.
- `car_platform_ids` remembers a platform vehicle id after the first confirmed match so later imports skip review.
- Deleting a car that has trips or expenses should stay restricted (same idea as `car_has_ledger`). Extend the delete conflict reason, for example `car_has_trips` / `car_has_expenses`.

## 4. Column mappers

Put mappers in something like `lib/portal/import/`:

- `types.ts` — `PlatformMapper` and `MappedTrip` (platform, external_trip_id, external_vehicle_id, vin, plate, start/end, status, gross_cents, platform_fees_cents, payout_cents, counts_as_income).
- `registry.ts` — `getMapper(platform | headers)` and the list of known platforms (`turo`, `wheelbase`, …).
- `money.ts` — shared currency parser (see §2.1).
- `turo.ts` — full implementation against the confirmed 47-column file.
- `wheelbase.ts` — full implementation of the confirmed two-file join in §§14–15, against the anonymized fixtures. `canParse` accepts the confirmed reservations and transactions headers. `parse` joins on Booking ID (from the transactions `Reservation` field, parse `#<id> - <name>` and drop the name). Car match: treat `Vehicle Internal ID` as a plate first; fallback to the text after the last hyphen for older `<Model>-<PLATE>` rows. `gross_cents` = Subtotal; tax is pass-through (sum of headers ending in `Tax`), shown on its own line, and excluded from owner income; `platform_fees_cents` = Σ CC Fee + Σ Wheelbase Fee; `payout_cents` = Σ Credit − Σ Debit. A Deposit Date of `0001-01-01` means pending. Unknown `Type` values park the raw row in an admin review list and do not fail the rest of the file.
- `match.ts` — car matching (next section).

Turo required headers: `Reservation ID`, `VIN`, `Vehicle`, `Vehicle id`, `Trip start`, `Trip end`, `Trip status`, `Trip price`, `Total earnings`. Extra columns are ignored. Missing required headers fail the whole file.

Turo plate extraction: from `Vehicle`, take the last parenthetical group, trim, and normalize like `getCarByPlateKey` (uppercase, strip spaces and dashes). If there is no parenthetical group, plate is empty.

Turo `counts_as_income`: true when status is `Completed`, or when status is `Guest cancellation` or `Host cancellation` and `payout_cents !== 0`. Otherwise false.

Wheelbase `counts_as_income`: a trip counts as income as soon as money is collected (`payout_cents !== 0`), including in-progress statuses such as `On Vacation`. `Returned`, `Completed`, and `Complete` count even when payout is zero. A cancellation counts only when payout is not zero. Chris decided this at 12:32 AM ET on November 23, 2026. Pending deposit rows stay inside that payout; they are flagged, not excluded.

A new platform later is: a mapper module, a registry entry, an anonymized fixture, and tests. No change to `trips` or the report queries.

## 5. Car matching and the unmatched review screen

Priority, first hit wins only when the hit is unique and unambiguous:

1. **Remembered platform vehicle id.** Normalized `platform` + `external_vehicle_id` in `car_platform_ids`.
2. **VIN.** Strip spaces and dashes, uppercase, compare to `cars.vin` (already stored uppercase / 17 characters, no I/O/Q). One match → matched. VIN is unique, so this cannot be ambiguous.
3. **Plate.** Normalized plate from the row against `REPLACE(REPLACE(UPPER(cars.license_plate), ' ', ''), '-', '')`. Exactly one car → matched. Zero → continue. Two or more → `ambiguous` (the plate column is not unique).
4. Otherwise `unmatched`.

Never auto-match on Vehicle name / make-model-year text alone. Two cars of the same model would collide (the confirmed Turo file had repeated vehicle names).

Admin review screen (new page, for example `/admin/imports/:id`):

- Summary: filename, platform, total rows, matched, unmatched, ambiguous, invalid.
- Tables for unmatched and ambiguous rows, showing only non-PII fields: row number, external trip id, dates, status, payout, VIN, plate, platform vehicle id. Never show guest names even if the CSV had them.
- Each unresolved row has a car picker (search by year/make/model/plate/VIN among all cars). Saving the assignment sets `car_id` and, when a platform vehicle id is present, upserts `car_platform_ids`.
- Admin can discard invalid rows or the whole preview.
- Commit is blocked until every row is `matched` or explicitly skipped as `invalid`.
- Commit upserts `trips` on `(platform, external_trip_id)`: insert new, update existing (car, dates, status, amounts, `counts_as_income`). Then mark the import `committed`.
- Re-uploading the same Turo file (or a later overlapping export) must not create duplicates.

If a VIN in the file is well-formed but belongs to no car, it stays unmatched — do not auto-create cars.

## 6. Manual expenses

Admin on the per-car page, next to (not inside) the existing ledger:

- Fields: date (`YYYY-MM-DD`, default today in America/New_York, same helper as the ledger), category (closed list in §3), amount in dollars (positive, reuse `dollarsToCents`), note (optional, max 200).
- Admin can create, edit, and delete.
- CSRF and same-origin rules are the same as other admin writes.

Owners:

- Read-only list and totals on the owner report for that car.
- No create / edit / delete routes under the owner API.

## 7. Net report

Income for a period is payout minus tax collected for that car's trips where `counts_as_income = 1` and `start_date` is in the period. Tax is pass-through and is not owner income (§§14–15). Turo leaves `tax_cents` null, so Turo income equals Total earnings. A trip that crosses a month boundary is attributed entirely to `start_date` (call this out in the UI). Do not prorate in this MVP.

Expenses for a period are the sum of `amount_cents` where `entry_date` is in the period.

```
income_cents     = SUM(payout_cents - COALESCE(tax_cents, 0)) WHERE car_id = ? AND counts_as_income = 1 AND start_date >= ? AND start_date < ?
expense_cents    = SUM(expenses.amount_cents) WHERE car_id = ? AND entry_date >= ? AND entry_date < ?
net_cents        = income_cents - expense_cents
```

Also return:

- To-date totals: the same sums with no start bound (or from a far-past date) through the exclusive end of the selected month, plus an all-time variant.
- Income split by `platform`.
- Month list / month picker in America/New_York, reusing `monthBounds`, `currentMonthEastern`, and `formatUsdFromCents`.

Owner API must join or filter `cars.owner_id = <session owner>`. Admin API can query any car and may also offer a fleet-wide rollup (optional in this PR; per-car is required).

UI:

- Owner: on `/owner/`, each car card (or a details section) shows the selected month's income, expenses, and net, plus to-date net, and a short trip/expense list. No guest names.
- Admin: the same figures on `/admin/cars/<plate>`, plus the import entry point (for example `/admin/imports` upload + review).
- Public fleet pages stay unchanged and must not show these amounts.

## 8. New API routes

All of these follow the existing handler patterns in `lib/portal/handler.ts`: session, CSRF on writes, admin gate, owner isolation, JSON errors.

Admin:

- `POST /api/portal/admin/imports` — multipart or raw CSV body, `platform` field or auto-detect, size cap 5 MiB. Creates a `preview` import and returns the review payload. Do not log CSV contents.
- `GET /api/portal/admin/imports/:id` — review payload.
- `POST /api/portal/admin/imports/:id/rows/:rowId/match` — `{ carId }`.
- `POST /api/portal/admin/imports/:id/commit`
- `POST /api/portal/admin/imports/:id/discard`
- `GET, POST /api/portal/admin/cars/:id/expenses`
- `PATCH, DELETE /api/portal/admin/cars/:id/expenses/:expenseId`
- `GET /api/portal/admin/cars/:id/report?month=YYYY-MM`

Owner:

- `GET /api/portal/cars/:id/report?month=YYYY-MM` — 404 if the car is not that owner's.
- `GET /api/portal/cars/:id/expenses?month=YYYY-MM` — read-only, same isolation. Or fold expenses into the report payload and skip a second route.

Do not expose import or expense write routes to non-admins.

## 9. Tests

Add `tests/portal/import.test.ts`, `tests/portal/turo-mapper.test.ts`, `tests/portal/expenses.test.ts`, and `tests/portal/report.test.ts`, in the same `node:test` + `memory-d1` style as `tests/portal/ledger.test.ts`. Fixtures must use fake VINs like the existing `1TSTCAR0000000001` pattern, fake plates, and no guest names.

Required coverage:

- Turo mapper: all 47 confirmed headers; money parser for `$12.34`, `- $12.34`, `-$12.34`, plain `12.34`, and `$1,234.56`; date parse for AM/PM; plate from trailing `(PLATE)`; VIN normalize; status → `counts_as_income`; missing required header fails; extra columns ignored; Guest column is parsed only to be dropped.
- Idempotent re-import: second upload of the same Reservation ID updates amounts/status and does not insert a second trip.
- `Booked` / `In-progress` rows are stored with `counts_as_income = 0` and are excluded from month income; a later import that changes status to `Completed` includes them.
- Cancellation with a non-zero `Total earnings` counts as income; zero does not.
- Match: VIN hit; plate fallback when VIN is empty; remembered `Vehicle id`; ambiguous plate goes to review; Vehicle name alone does not match; unknown VIN stays unmatched; commit blocked while unmatched remain; admin assign writes `car_platform_ids`.
- Expenses: admin create/edit/delete; owner can read and cannot write (403/404); validation (positive cents, category, date, note length).
- Report: month and to-date math; owner cannot read another owner's car; admin can; Turo + a second platform (use a tiny in-test stub mapper) combine into one net; `car_ledger` rows are not included.
- Wheelbase mapper: two-file join on Booking ID; plate match on the full `Vehicle Internal ID` with fallback to the text after the last hyphen; gross = Subtotal; tax pass-through on its own line; fees = CC Fee + Wheelbase Fee; payout = Σ Credit − Σ Debit; Deposit Date `0001-01-01` is pending; unknown `Type` values park the raw row in an admin review list while the rest of the file imports; unmatched booking ids on either side go to review; guest fields are dropped and never stored. Wrong or incomplete headers still fail closed with a clear error.
- Auth: unauthenticated 401, non-admin 403, CSRF, `pages.dev` rejection still holds.
- `npm test` and `npm run build` stay green. Do not touch public fleet price display.

## 10. Out of scope

- Receipt uploads.
- Automatic Helm / connector import.
- Turo or Wheelbase OAuth, or any browser session scraping.
- The unofficial 8-column Turo activity export.
- Prorating trips across months.
- Tax packages, 1099 exports, or owner payout execution (Zelle, etc.).
- Migrating or deleting `car_ledger`.
- Contacting Justin or any owner. Chris and Grok handle that.
- Production D1 writes, Pages deploys, merges, and password changes.

## 11. Launch and verify (after the PR is approved, not in the implementation PR)

1. Apply `0005_trips_expenses.sql` to production D1 once, by hand, the same way as `0004`.
2. Deploy the approved SHA.
3. On admin, upload a current Turo trip earnings CSV (all time or year-to-date). Resolve any unmatched rows for Justin's cars. Confirm a second upload does not duplicate trips.
4. Enter a few manual expenses on those cars.
5. Check the owner view (Justin, or an admin impersonation path if one exists — today it does not; use Justin's sign-in only if Chris so orders) and the admin report: month income, expenses, net, to-date, Turo + Wheelbase combined once a Wheelbase file exists.
6. Send screenshots to Grok, then Chris, before calling it live for owners. Do not DM Justin.

## 12. Blockers

1. **Wheelbase CSV headers and payout formula are confirmed** (Chris samples 11/22 11:05 PM ET, answers 11:16 PM ET). Implement the two-file join and math in §§14–15 with the anonymized fixtures. Do not commit the real samples, and do not guess beyond those sections.
2. Turo trip-level platform fees are not in the confirmed 47-column export. `platform_fees_cents` stays NULL for Turo unless a confirmed trip-level fee column appears later.
3. No official Turo trip-earnings attachment was in Panamerica Gmail; confirmation came from a local file on the box plus third-party guides that match it. The first live import should still be checked against one trip receipt in Turo, because Turo has changed this layout before.

## 13. Cloud-agent prompt (open a PR only)

Copy everything in the block below into the cloud agent. It must not force-push.

```
You are implementing the Panamerica owner portal money MVP in cvolkernick/panamerica-auto-rentals, branched from current origin/main (expected baseline 50571dd3c1a6f2e91c9250dd6a9b08fbf88b1797 after PRs #25 and #26; rebase onto latest main if it has moved).

Read and follow panam-portal-money-mvp-2026-11-22.md from this transfer folder (or the copy of that spec committed with the PR, if you are working only in the repo). Use the anonymized fixtures in the same folder: wheelbase_reservations_fixture.csv, wheelbase_transactions_fixture.csv, and turo_earnings_fixture.csv. Do not use real sample exports. Implement exactly that slice: (1) admin CSV trip import with a pluggable per-platform mapper, Turo fully implemented against the confirmed 47-column trip earnings export, Wheelbase fully implemented per sections 14-15 (the two-file join on Booking ID; plate match with a fallback to the text after the last hyphen; gross = Subtotal; tax pass-through on its own line; fees = CC Fee + Wheelbase Fee; payout = sum Credit - sum Debit; a Deposit Date of 0001-01-01 means pending; unknown Type values park the raw row in an admin review list while the rest of the file imports); (2) admin manual expenses, owners read-only; (3) per-car net report (income minus expenses) by month and to date, owners see only their own cars, admin sees all.

Hard rules:
- Open a pull request only. Do not merge. Do not deploy. Do not run wrangler d1 execute --remote or any production D1 write. Do not change Pages env vars or secrets.
- Explicitly forbid any force-push, including --force-with-lease. If you need to fix a commit, add a new commit instead. Never git push --force or --force-with-lease.
- No secrets in the repo, fixtures, logs, or PR body: no portal password, no PORTAL_PEPPER, no setup tokens, no password hashes, no webhook URLs or keys.
- No customer PII in fixtures, tests, commit messages, or the PR: no guest names, no real addresses, no real reservation ids from production, no real owner emails other than the already-seeded panamerica.cars@gmail.com in tests that already use it. Use the existing fake VIN pattern (1TSTCAR0000000001 and similar).
- Fleet cards must never show a price. Do not change public fleet pricing display. The owner onboarding checklist stays internal.
- Do not write imported trips or new expenses into car_ledger, and do not include car_ledger rows in the new net report.
- Wheelbase is no longer a stub. Implement wheelbase.ts fully against the confirmed two-file format in sections 14-15 and the anonymized fixtures. Do not guess mappings beyond those sections.
- Do not persist guest name, phone, email, or address from Wheelbase or Turo, or Turo pickup/return location. Do not log raw CSV contents.
- Follow existing portal patterns: lib/portal/handler.ts routing, CSRF + same-origin on writes, owner isolation via owner_id, admin gates, integer cents, America/New_York date helpers, tests in tests/portal with node:test and tests/portal/memory-d1.ts (it auto-loads every migrations/*.sql file). Add migrations/0005_trips_expenses.sql as specified. npm test and npm run build must pass.

PR title idea: "Add owner portal trip import, expenses, and net report". In the PR body, summarize the Turo mapping, the Wheelbase two-file join and payout math, the match order (platform vehicle id, VIN, plate with last-hyphen fallback, then review), and that production apply/deploy is not included.

When the branch is pushed and the PR is open, comment the PR URL and the head SHA. Stop there.
```

## Sources

- Current schema and routes: `origin/main` of `cvolkernick/panamerica-auto-rentals` at `2dcd3ed`, files under `migrations/`, `lib/portal/`, `docs/owner-portal.md`, `app/owner/`, `app/admin/`.
- Turo 47-column headers and parse quirks: local Panamerica file `/workspace/turo/turo_earnings_2026-11-04.csv` (headers and formats only; no guest data copied here).
- [How to read your Turo earnings export (CSV), column by column](https://fleetearnings.com/blog/how-to-read-turo-earnings-csv/), FleetEarnings, October 13, 2026.
- [Trip Earnings CSV](https://dhanurgo.mintlify.app/data-reference/trip-earnings-csv) and [Earnings Report CSV](https://dhanurgo.mintlify.app/data-reference/earnings-report-csv), Dhanurgo (third-party; Earnings Report headers not confirmed with a Panamerica file).
- [Turo CSV Import — How It Works](https://www.myfleetos.com/turo-csv-import), MyFleetOS, September 16, 2026.
- [Canada taxes | Hosts](https://help.turo.com/en_us/canada-taxes-or-hosts-H1CKSNeEc.md), Turo help, mentions downloading the trip earnings CSV; no official column guide.
- Panamerica Gmail, read-only: one earnings CSV attachment dated June 17, 2026, 8 columns, not the trip-earnings format; no Wheelbase export attachment.
- [Reservation details report reference guide](https://help.wheelbasepro.com/hc/en-us/articles/12598506024603-Reservation-details-report-reference-guide), Wheelbase help, January 7, 2025.
- [Create payout reports for consigned units](https://help.wheelbasepro.com/hc/en-us/articles/12597914651163-Create-payout-reports-for-consigned-units), [Transaction Log reference guide](https://help.wheelbasepro.com/hc/en-us/articles/12598677128731-Transaction-Log-reference-guide), [How can I see a breakdown of payouts received?](https://help.wheelbasepro.com/hc/en-us/articles/12598824144539-How-can-I-see-a-breakdown-of-payouts-received), [Understanding Your Revenue Performance Report](https://help.wheelbasepro.com/hc/en-us/articles/47257464556443-Understanding-Your-Revenue-Performance-Report), [How to find ID Numbers](https://help.wheelbasepro.com/hc/en-us/articles/12557348563483-How-to-find-ID-Numbers-for-Customers-Reservations-and-Vehicles).

## 14. Wheelbase CONFIRMED (Chris samples 11/22 11:05 PM; samples in /workspace/specs/samples/, contain guest PII: do not commit; build anonymized fixtures)
Two files joined on Booking ID.
- Reservations export: Booking ID, Status, Source, Rental ID, Rental Name, Vehicle Internal ID (format "<Model>-<PLATE>", e.g. Rio-<plate>; plate = text after last hyphen, pending Chris confirm), Start/End (date) + Start Time/End Time (seconds after midnight), Nights, Rental Amount, Addon Amount, Discount, Mileage Fee, Subtotal, tax columns (names vary by jurisdiction: treat any header ending in "Tax" as tax), Total, Amount Paid, Due, Mileage Out/In/Used, CC Fees, Outdoorsy Remitted Taxes, Partner Commission. Guest name/phone/email/address: never store.
- Transactions export: Date, Deposit Date (0001-01-01 = not yet deposited -> pending), Reservation ("#<BookingID> - <guest>": parse id, drop name), Type (Full Reservation Charge, Manual Charge, Wheelbase Fee Payment, others unknown), Amount, CC Fee, Wheelbase Fee, Credit, Debit, Partner Commission. Multiple rows per booking (split charges).
- Per booking: gross = Subtotal (excl tax); tax_collected = sum tax cols (pass-through, excluded from owner income); platform_fees = sum CC Fee + Wheelbase Fee; payout = sum Credit - sum Debit; deposited vs pending by Deposit Date. Owner income is payout minus tax collected. Verified on Chris's samples (real booking ids and amounts are not copied here). Anonymized fixtures reproduce split charges, a pending deposit row (`0001-01-01`), and one unknown Type row.
- `counts_as_income`: count the trip as soon as money is collected (`payout_cents !== 0`), including in-progress statuses such as `On Vacation` (Chris, 12:32 AM ET, November 23, 2026). `Returned`, `Completed`, and `Complete` count even when payout is zero. A cancellation counts only when payout is not zero. A pending deposit stays in the payout and is flagged.
- Unmatched booking ids either side -> review screen. Unknown Type values: import the rest of the file, park the raw row in an admin review list, never guess or drop (see §15).

## 15. Chris answers 11/22 11:16 PM
1. Vehicle Internal ID is now just the plate (sample predates change). Match on full value as plate; fallback: text after last hyphen for older rows.
2. Confirmed: sales tax is pass-through, excluded from owner income, shown on its own line.
3. No other transaction types yet. Unknown types: import the rest of the file, park unknown rows in an admin review list with the raw row kept, flag them in admin, never guess or drop; mapping gets updated when one appears.
