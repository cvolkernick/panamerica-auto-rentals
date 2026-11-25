# Manager role

## Phase 1 (shipped in #30): admin setup + accrued share

Spec: Chris t1702u (11/24 1:16 AM ET). Phase 1 is built.

### In this phase
- **Managers** (`managers` table, migration `0008_managers.sql`): a name, plus one share of the
  company fee in basis points (1250 = 12.5%) applied across all of that manager's cars.
- **Share rate history** (`manager_share_rates`): the share is dated. Creating a manager seeds
  its first rate with an effective date. A change is a new rate row with a later effective date
  and applies **forward only**: each trip uses the rate in effect on its start date, so past
  accrued share is never re-rated. Rates are append-only: a date on or before the latest rate
  (backdating or a duplicate) is refused, and PATCH never changes the share. An assignment can't
  start before the manager's first rate, so every assigned trip has a rate.
- **Assignments** (`car_manager_assignments`): each car has at most one open assignment
  (partial unique index). Reassigning closes the open row on the new date and opens a new one,
  so history keeps start (inclusive) and end (exclusive) dates. "Undo last" reverts the latest change.
  Reassign (close + insert), undo of a reassign (delete + reopen) and manager create (manager +
  first rate) each run as one D1 batch, so a failed step rolls the whole write back.
- **Accrued share**: per trip, the company fee from `statement.ts` (tier fee on the platform's
  actual net payout: 20% under 7 days, 15% for 7-21, 10% over 21) times the manager's share in
  effect on the trip's start date,
  rounded half up to the cent. A trip belongs to whoever managed the car on the trip's start
  date, the same attribution rule statements use. Read-only: owner statements, expenses,
  payouts and the per-car running balance are unchanged.
- **Admin page** `/admin/managers/`: add or edit managers, assign or reassign cars with a start
  date, change a manager's share with a start date, see rate history, accrued share by month,
  per-trip rate and share, and assignment history.

A manager in phase 1 was a name row only. Phase 2 (below) links each manager to a portal
login account and adds the read-only manager view.

### API (admin session + CSRF only)
| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/portal/admin/managers` | |
| POST | `/api/portal/admin/managers` | `{ name, email, shareBps, effectiveFrom }` (new login account + first rate; phase 2) |
| GET / PATCH | `/api/portal/admin/managers/:id` | `{ name }` (shareBps is refused) |
| GET / POST | `/api/portal/admin/managers/:id/rates` | `{ shareBps, effectiveFrom }`, after the latest rate |
| GET / POST | `/api/portal/admin/cars/:id/managers` | `{ managerId \| null, startDate }` |
| POST | `/api/portal/admin/cars/:id/managers/undo` | |

## Phase 2 prerequisite: tie managers to portal login accounts (built, see "Phase 2 build" below)

Chris t1732u (11/24 8:33 PM ET): managers should be tied to login accounts. Every manager
should be able to sign in with their account and have the manager role. Today a manager is
a flat name value on `managers`, not an account. This section is the prerequisite for
phase 2 sign-in and scoped car access. Spec merged in #34; implemented in the phase 2 build
PR (issue #33).

Phase 2 is **read-only except auth**. After sign-in, manager APIs and `/manager/` only
read assigned-car income, expenses, earnings, statements, and assignment or rate
history, each limited to that manager's assignment date windows. The only writes in
phase 2 are auth: login, logout, session, CSRF, and invite password setup. Managers
do not create or edit trips, expenses, assignments, rates, payouts, or reimbursements
in this phase. Reimbursement claims are phase 3; approval stays admin-only.

### Why a link on `managers`, not a new users table

There is no general `users` table. Portal login accounts are rows in `owners`: unique
email, `password_hash` (migration 0002), `is_admin`, sessions (`sessions.owner_id`), and
one-time invites (`owner_invites.owner_id`). `POST /api/portal/login` already authenticates
any `owners` row. A parallel users table would require moving sessions, password hashes,
and invites.

The manager record stays in `managers` (share rates and assignments already point here).
The account link is:

- `managers.account_id` — nullable unique foreign key to `owners.id`, `ON DELETE RESTRICT`.
- A partial unique index on `account_id` where it is not null, so unlinked phase-1 rows
  can coexist during backfill.
- The manager role is this foreign key: a signed-in account has the manager role when a
  `managers` row points at it. `GET /api/portal/session` should return every role that
  applies (`isAdmin`, owner, manager, and `managerId` when linked) so the client can
  route to `/admin/`, `/owner/`, and `/manager/` as appropriate. Both the owner and
  manager roles can be true on the same account.
- One account can hold both roles. The same `owners` row may own cars
  (`cars.owner_id`) and also be referenced by `managers.account_id`. A manager may
  manage their own car (for example, a manager who later buys a car and keeps
  managing the rest of the fleet).
- Owner view and manager view stay separate (a role switch or separate routes:
  `/owner/` and `/manager/`). Each is scoped to its own data. The two views do not
  mix: owning a car does not grant manager-range access to it, and managing a car
  does not grant the owner statement for it, unless that same account also owns it.
- `is_admin` stays an independent flag on the same account. Linking a manager row
  does not grant or revoke admin. Admin routes still require `is_admin`.
- Approvals of reimbursements, expenses, and payouts are admin-only. Owners and
  managers do not approve them, so one account with both roles creates no approval
  conflict. No extra self-approval safeguard is needed.

### Admin creates or invites a manager account

Reuse the existing owner invite flow. Do not add a second password scheme, and do not put
passwords, hashes, or invite tokens in this repo or in docs.

1. Admin creates a manager with name, **email**, share, and effective date. If that
   email is new (no `owners` row), one D1 batch inserts the `owners` row
   (`is_admin = 0`), the `managers` row (name + `account_id`), and the first share
   rate. If that email already belongs to an owner account, the create is refused.
   **Email match must never auto-link an existing owner.** To attach a manager row
   to an existing account, the admin must explicitly confirm the specific
   `owner_id` (a separate link action that takes that id, not an inferred email
   match). If that `owner_id` already has a `managers` row, the link is refused
   (`account_id` is unique).
2. Admin sends a one-time invite, either through the existing
   `POST /api/portal/admin/owners/:id/invite` or a thin wrapper
   `POST /api/portal/admin/managers/:id/invite` that calls the same `createOwnerInvite`
   helper. The token is stored as SHA-256 only, 72-hour TTL, older unused invites marked
   used, same as owners. Skip the invite when the account already has a password
   (an explicitly linked existing owner); they can sign in as they do today and use
   `/manager/` once the row is linked.
3. When an invite is needed, the manager opens `/manager/invite/` (a shell that
   hits the same `GET`/`POST /api/portal/invite`) and sets a password in the
   browser (Argon2id, as documented in `docs/owner-portal.md`). The Worker stores
   only the peppered HMAC.
4. The manager signs in with the same `POST /api/portal/login`. Sessions, CSRF,
   device cookie, and rate limits are unchanged. After login, the client routes
   from the session roles: `/manager/` for the manager view, `/owner/` for the
   owner view when that role also applies.

`PORTAL_SETUP_TOKEN` stays an operator bootstrap for the seeded admin account. It is not
how managers are onboarded, and it should stay unset in production.

Until a manager row has an `account_id` and the account can authenticate (invite
completed, or an already-passworded owner account that was explicitly linked),
that manager cannot sign in with the manager role.

### Migration plan for existing manager rows (forward only)

Additive migration after 0008 (for example `0009_manager_accounts.sql`), applied later
with `wrangler d1 execute` after the checks below, not as part of this docs PR and not
from a deploy step.

Before apply:

- Take a fresh `d1 export` backup.
- Take a D1 Time Travel bookmark.
- Run a read-only pre-apply check that `managers.account_id` does not already
  exist. If the column is already there, stop and do not apply.

0009 itself:

- Add nullable `managers.account_id` and the partial unique index. 0009 does
  **not** make `account_id` NOT NULL.
- Do not invent emails in SQL. Phase 1 rows have only a name. An admin links
  each existing manager by supplying an email. If the email is new, create an
  `owners` row, set `account_id`, then invite. If the email already belongs to
  an owner, do not link until the admin explicitly confirms that specific
  `owner_id`. Assignments, rates, and accrued share do not change.
- New manager creates require an email and an account in the same batch when
  the email is new; name-only creates are refused going forward. Linking to an
  existing owner is always the explicit `owner_id` confirmation path, never an
  automatic email match.
- A later migration may make `account_id` NOT NULL only once every existing
  row is linked. That is not part of 0009.
- Rollback of the 0009 additive step is drop the index and the column. Do not
  drop `managers` or the other phase-1 tables.

### What a manager can and cannot see

This is the authz contract phase 2 must implement once accounts exist. The portal does
not store guest PII, and that stays a hard rule. Phase 2 access is read-only except
auth, as stated above.

**Can (scoped to this manager, on `/manager/` and manager APIs):**

- Sign in and load `/manager/` (static shell, noindex, not in the nav, footer, or
  sitemap — same pattern as `/owner/` and `/admin/`). If the same account also owns
  cars, `/owner/` stays available as a separate view.
- Cars they manage, or previously managed, as defined by their
  `car_manager_assignments` rows. Year, make, model, color, plate, and VIN.
- Income, expenses, and earnings for those cars **only inside their assignment
  date ranges** (start inclusive, end exclusive). For an open assignment
  (`end_date IS NULL`), that includes current data. After a reassignment closes
  the row, they can still open the car in the manager view, but only for the
  periods they were the active manager, including earnings for those periods, and
  nothing after `end_date` (and nothing before `start_date`).
- Their own share rate, assignment history, and accrued share, using the existing
  rule: a trip belongs to whoever managed the car on the trip's start date.

**Cannot:**

- `/admin/*` or `/api/portal/admin/*` unless the same account is `is_admin` (403
  `not_admin`).
- Owner-portal data for a car they do not own. Owner routes stay scoped to
  `cars.owner_id`. Managing a car does not open the owner statement, and owning
  a car does not widen the manager date window.
- Cars they have no assignment for, including another manager's cars (404 on
  manager APIs, same as an owner asking for a car they do not own).
- Income, expenses, or earnings on a managed car outside their assignment date
  ranges, including anything after the assignment ended.
- Owner name, owner email, or any other owner PII in the manager view (same rule
  as the team connector: manager car JSON may carry `ownerId` only). The owner
  view, when this account also owns the car, keeps today's owner-portal fields
  for that car.
- Guest data of any kind. Expense notes that look like an email or phone number stay
  rejected.
- Other managers' accrual, share rates, or assignments.
- Changing share rates, assignments, owners, or cars, or any other non-auth write
  in phase 2.
- Approving reimbursements, expenses, or payouts (admin-only, including when this
  account is also an owner). Bank details and payout execution stay out of the
  manager view. Submitting a reimbursement claim is phase 3; approval is still
  admin-only.
- Fleet-wide admin lists and imports, unless the same account is `is_admin`.

### Authz tests to require (phase 2 implementation)

- Signed out: 401 on manager APIs (login form on `/manager/`).
- Signed-in owner who is not a manager: 403 on manager APIs.
- Signed-in manager who is not `is_admin`: 403 `not_admin` on every
  `/api/portal/admin/*` route, including managers admin and connector docs.
- Owner APIs stay scoped to `cars.owner_id`; manager APIs stay scoped to this
  manager's assignment date ranges. An account with both roles: a car they own
  but do not manage appears only in the owner view; a car they manage but do
  not own appears only in the manager view, date-scoped; a car they own and
  manage appears in both, each with that view's scope.
- Signed-in manager cannot read or write a car they have no assignment for,
  including another manager's car (404).
- After a reassignment closes their open row, income and expense reads for
  dates inside the closed window still succeed; dates on or after `end_date`
  do not.
- Date-scoped earnings, statements, and log rows, including a month that
  straddles `end_date`: rows on or after `end_date` are omitted; rows inside
  the window are present.
- Manager JSON (list, car, statement, log) never includes owner name or email.
- Invite tokens that are already used, expired, or issued for a different
  account all fail the same way and do not authenticate or set a password.
- A dual-role account that is not `is_admin` gets 403 on approval and payout
  routes.
- Phase 2 manager routes reject non-auth writes (trips, expenses, assignments,
  rates, reimbursements).
- Session JSON reports the manager role only when `account_id` matches, and can
  report owner and manager together.
- Linking a manager row does not grant or revoke `is_admin`.
- Creating a manager with an email that already belongs to an owner does not
  link that account. Linking requires an explicit confirmed `owner_id`. Creating
  or linking when that `owner_id` already has a `managers` row is refused.
- An unlinked phase-1 manager row still cannot authenticate.

## Phase 2 build (issue #33)

Migration `0009_manager_accounts.sql`: nullable `managers.account_id` (FK to `owners.id`,
`ON DELETE RESTRICT`) plus partial unique index `idx_managers_account_id`. No NOT NULL, no data.

### Admin API additions (admin session + CSRF only)
| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/api/portal/admin/managers` | `{ name, email, shareBps, effectiveFrom }` | Email required. 409 `email_has_account` if the email already has an account; nothing is linked. |
| POST | `/api/portal/admin/managers/:id/account` | `{ email }` | Unlinked row only. New account (`is_admin = 0`) + link in one batch. Same 409 for an existing email. |
| POST | `/api/portal/admin/managers/:id/link` | `{ ownerId, confirm: true }` | Explicit link to that exact existing account. An `email` field is refused. 409 `account_has_manager` / `manager_already_linked`. |
| POST | `/api/portal/admin/managers/:id/invite` | | `createOwnerInvite` with a `/manager/invite/?t=` link. 409 `manager_not_linked`, or `account_has_password` (they sign in as today). |

`POST /api/portal/invite` accepts an optional `email`. When present it must match the invite's
account, or the request fails as `invite_invalid` (same as used or expired) and the token is
not consumed. Both invite pages send it.

### Session roles
`GET /api/portal/session` and `POST /api/portal/login` add
`roles: { admin, owner, manager }` and `managerId`. `manager` is true only when a managers
row has `account_id` = this account. `owner` is true when the account owns at least one car,
or is not a manager (an owner account with no cars yet keeps today's owner view). `admin` is
the existing effective admin flag.

### Manager API (signed-in manager; GET only; anything else is 405)
| Path | Returns |
| --- | --- |
| `/api/portal/manager` | own name, share, rate history, assignments, accrued share |
| `/api/portal/manager/cars` | cars with any assignment row for this manager, with `windows` and openable `months` |
| `/api/portal/manager/cars/:id` | one such car (404 if never assigned to this manager) |
| `/api/portal/manager/cars/:id/statement?month=YYYY-MM` | trips (with fee and share), expenses, totals inside the windows; 404 `outside_assignment` if the month has no day in a window |
| `/api/portal/manager/cars/:id/ledger[?month=]` | car ledger rows inside the windows, excluding `payout` rows |

401 signed out; 403 `not_manager` for an account with no linked managers row. Car JSON is
year, make, model, color, plate, VIN, and `ownerId` only (no owner join). Trip rows carry no
external trip id.

Pages: `/manager/` (sign-in shell, noindex, not in nav, footer, or sitemap) and
`/manager/invite/` (same `InvitePortal` as `/owner/invite/`). `_routes.json`, `_headers`,
`robots.ts`, and the apex redirect include `/manager`.

## Later phases (not built)

- Phase 2 (built, issue #33): manager sign-in; managers see
  income, expenses, and earnings for the date ranges they were the active
  manager, under the authz contract in this document. Owner and manager views
  stay separate when one account has both roles. Phase 2 is read-only except
  auth.
- Phase 3: reimbursement claims (manager-submitted, admin approve or reject, never auto-posted to
  the owner statement; an admin may create a separate linked owner expense), and recorded
  payouts to managers (share payouts and reimbursements) with payout history and a
  remaining-due balance. Receipt photos stay outside the system (Chris t1717u).
  Approval stays admin-only, including when the claimant is also an owner.

## Decisions and open questions
1. Resolved (Grok, 11/24): fees accrue to whoever managed the car on the trip's start date.
2. Resolved (Grok, 11/24): a share change applies forward only from its effective date, with
   dated rate history; past accrual is never re-rated.
3. Resolved (Chris, 5:22 PM ET 11/24): managers earn a share on all cars, including
   Panamerica-owned ones. This matches the build: the statement code computes a fee on every
   car, and the share follows it.
4. Resolved (Chris, 8:52 PM ET 11/24, t1733u; clarified 8:53 PM ET, t1734u): one person
   can be both a car owner and a manager on the same account. Owner and manager views
   stay separate, each scoped to its own data. A manager may manage their own car.
   Approvals of reimbursements, expenses, and payouts are admin-only, so both roles on
   one account create no approval conflict.
5. Resolved (Grok, 11/24 gate on #34): use a `/manager/invite/` page that calls the same
   `GET`/`POST /api/portal/invite` API.
6. Resolved (Grok, 11/24 gate on #34): `account_id` stays nullable in 0009. A later
   migration may make it NOT NULL only once every existing row is linked, not in 0009.
7. Resolved (Chris, 8:52 PM ET 11/24, t1733u): after a car is reassigned, the old
   manager sees that car's data only for the date ranges they were the active manager
   (`car_manager_assignments`, start inclusive, end exclusive), including earnings for
   those periods, and nothing after.

## Apply (after Grok's go, not part of a docs PR)
Phase 1: `npx wrangler d1 execute panamerica-portal --remote --file=migrations/0008_managers.sql`,
after a fresh `d1 export` backup. Additive only (three new tables, no change to existing ones);
rollback is `DROP TABLE car_manager_assignments; DROP TABLE manager_share_rates; DROP TABLE managers;`.

Phase 2: `migrations/0009_manager_accounts.sql`, only after Grok's go, never from a deploy step.
The code tolerates a missing `managers.account_id` (no manager role, sessions keep working), so
the code ships first:
1. Merge and deploy the phase 2 code.
2. Check `/workspace/state/holds.json`.
3. Fresh backup outside the repo, mode 600:
   `npx wrangler d1 export panamerica-portal --remote --output=<backup dir>/pre-0009.sql`.
4. Time Travel bookmark: `npx wrangler d1 time-travel info panamerica-portal` and record it.
5. Read-only pre-check: `npx wrangler d1 execute panamerica-portal --remote --command="SELECT COUNT(*) AS n FROM pragma_table_info('managers') WHERE name = 'account_id'"`.
   Stop if `n` is 1.
6. Apply only 0009 by hand: `npx wrangler d1 execute panamerica-portal --remote --file=migrations/0009_manager_accounts.sql`.
7. Check login and `GET /api/portal/session`, then a linked manager reading `/api/portal/manager`.

Rollback: `DROP INDEX idx_managers_account_id; ALTER TABLE managers DROP COLUMN account_id;`
(or restore the Time Travel bookmark). Never drop `managers` or the other phase-1 tables.
