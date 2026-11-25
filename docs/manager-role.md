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

A manager in this phase is a name row only. It is not linked to a portal login account.
That link is the phase 2 prerequisite below; it is not built yet.

### API (admin session + CSRF only)
| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/portal/admin/managers` | |
| POST | `/api/portal/admin/managers` | `{ name, shareBps, effectiveFrom }` (seeds the first rate) |
| GET / PATCH | `/api/portal/admin/managers/:id` | `{ name }` (shareBps is refused) |
| GET / POST | `/api/portal/admin/managers/:id/rates` | `{ shareBps, effectiveFrom }`, after the latest rate |
| GET / POST | `/api/portal/admin/cars/:id/managers` | `{ managerId \| null, startDate }` |
| POST | `/api/portal/admin/cars/:id/managers/undo` | |

## Phase 2 prerequisite: tie managers to portal login accounts (not built)

Chris t1732u (11/24 8:33 PM ET): managers should be tied to login accounts. Every manager
should be able to sign in with their account and have the manager role. Today a manager is
a flat name value on `managers`, not an account. This section is the prerequisite for
phase 2 sign-in and scoped car access. This PR is docs only: no migration and no code.

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
  `managers` row points at it. `GET /api/portal/session` should return that role and the
  `managerId`, so the client can route to `/manager/`.
- One account, one role. A manager account cannot be `is_admin`, cannot own cars
  (`cars.owner_id` must not point at it), and an owner account cannot also have a
  `managers` row. The admin owners list should not treat manager accounts as car owners.

### Admin creates or invites a manager account

Reuse the existing owner invite flow. Do not add a second password scheme, and do not put
passwords, hashes, or invite tokens in this repo or in docs.

1. Admin creates a manager with name, **email**, share, and effective date. One D1 batch
   inserts the `owners` row (`is_admin = 0`), the `managers` row (name + `account_id`), and
   the first share rate. A duplicate email is refused, same as today's owner create.
2. Admin sends a one-time invite, either through the existing
   `POST /api/portal/admin/owners/:id/invite` or a thin wrapper
   `POST /api/portal/admin/managers/:id/invite` that calls the same `createOwnerInvite`
   helper. The token is stored as SHA-256 only, 72-hour TTL, older unused invites marked
   used, same as owners.
3. The manager opens the invite link (`/owner/invite/` today, or a `/manager/invite/`
   shell that hits the same `GET`/`POST /api/portal/invite`) and sets a password in the
   browser (Argon2id, as documented in `docs/owner-portal.md`). The Worker stores only
   the peppered HMAC.
4. The manager signs in on `/manager/` with the same `POST /api/portal/login`. Sessions,
   CSRF, device cookie, and rate limits are unchanged.

`PORTAL_SETUP_TOKEN` stays an operator bootstrap for the seeded admin account. It is not
how managers are onboarded, and it should stay unset in production.

Until a manager row has an `account_id` and a completed invite, that manager cannot sign
in.

### Migration plan for existing manager rows (forward only)

Additive migration after 0008 (for example `0009_manager_accounts.sql`), applied later
with `wrangler d1 execute` after a D1 export backup, not as part of this docs PR and not
from a deploy step.

- Add nullable `managers.account_id` and the partial unique index.
- Do not invent emails in SQL. Phase 1 rows have only a name. An admin links each
  existing manager by supplying an email (creates the `owners` row, sets `account_id`,
  then invites). Assignments, rates, and accrued share do not change.
- New manager creates require an email and an account in the same batch; name-only
  creates are refused going forward.
- After every existing row is linked, a later migration may make `account_id` NOT NULL
  (open question below).
- Rollback of the additive step is drop the index and the column. Do not drop
  `managers` or the other phase-1 tables.

### What a manager can and cannot see

This is the authz contract phase 2 must implement once accounts exist. The portal does
not store guest PII, and that stays a hard rule.

**Can (scoped to this manager):**

- Sign in and load `/manager/` (static shell, noindex, not in the nav, footer, or
  sitemap — same pattern as `/owner/` and `/admin/`).
- Currently assigned cars only: open `car_manager_assignments` rows (`end_date IS NULL`).
  Year, make, model, color, plate, and VIN.
- Full income and expenses for those cars (the phase 2 product promise).
- Their own share rate, assignment history, and accrued share, using the existing rule:
  a trip belongs to whoever managed the car on the trip's start date. Accrual may
  include trips on cars later reassigned; that is history, not current car access.

**Cannot:**

- `/admin/*` or `/api/portal/admin/*` (403 `not_admin`).
- Owner-portal car lists or money routes keyed by `cars.owner_id` (403). A manager
  account has no owned cars, and must not fall through to the owner query.
- Cars they are not currently assigned, including another manager's cars and
  unassigned cars (404, same as an owner asking for a car they do not own).
- Owner name, owner email, or any other owner PII (same rule as the team connector:
  car JSON may carry `ownerId` only).
- Guest data of any kind. Expense notes that look like an email or phone number stay
  rejected.
- Other managers' accrual, share rates, or assignments.
- Changing share rates, assignments, owners, or cars.
- Bank details, payout execution, or reimbursement posting (phase 3).
- Fleet-wide admin lists and imports.

When an assignment closes, the manager loses current access to that car on the end date
(exclusive, same as the assignment window). They keep their historical accrual for trips
whose start date fell in the window.

### Authz tests to require (phase 2 implementation)

- Signed out: 401 on manager APIs (login form on `/manager/`).
- Signed-in owner who is not a manager: 403 on manager APIs.
- Signed-in manager: 403 `not_admin` on every `/api/portal/admin/*` route, including
  managers admin and connector docs.
- Signed-in manager: 403 on `/api/portal/cars` owner routes (no fall-through to
  `listOwnedCars`).
- Signed-in manager cannot read or write a car they are not currently assigned,
  including another manager's car (404).
- After a reassignment closes their open row, the same car is 404 for current
  income/expense reads.
- Session JSON reports the manager role only when `account_id` matches.
- Admin cannot set `is_admin` on a manager-linked account, and cannot set a manager
  account as `cars.owner_id`.
- Duplicate email on manager create is refused.
- An unlinked phase-1 manager row still cannot authenticate.

## Later phases (not built)

- Phase 2 (depends on the account link above): manager sign-in; managers see full income
  and expenses for their currently assigned cars only, under the authz contract in this
  document.
- Phase 3: reimbursement claims (manager-submitted, admin approve or reject, never auto-posted to
  the owner statement; an admin may create a separate linked owner expense), and recorded
  payouts to managers (share payouts and reimbursements) with payout history and a
  remaining-due balance. Receipt photos stay outside the system (Chris t1717u).

## Decisions and open questions
1. Resolved (Grok, 11/24): fees accrue to whoever managed the car on the trip's start date.
2. Resolved (Grok, 11/24): a share change applies forward only from its effective date, with
   dated rate history; past accrual is never re-rated.
3. Resolved (Chris, 5:22 PM ET 11/24): managers earn a share on all cars, including
   Panamerica-owned ones. This matches the build: the statement code computes a fee on every
   car, and the share follows it.
4. Open: can one person be both a car owner and a manager (same email)? Recommendation: no.
   One account, one role. Revisit only if a real person needs both.
5. Open: reuse `/owner/invite/` for manager password setup, or add a `/manager/invite/`
   shell that calls the same invite API?
6. Open: once every existing manager row is linked, should a follow-up migration make
   `account_id` NOT NULL?
7. Open: after a car is reassigned away, should the manager still open that car's
   income/expense pages for the dates they managed it, or only see those trips inside
   their accrued-share history? Recommendation: accrual history only; current car pages
   follow the open assignment.

## Apply (after Grok's go, not part of a docs PR)
Phase 1: `npx wrangler d1 execute panamerica-portal --remote --file=migrations/0008_managers.sql`,
after a fresh `d1 export` backup. Additive only (three new tables, no change to existing ones);
rollback is `DROP TABLE car_manager_assignments; DROP TABLE manager_share_rates; DROP TABLE managers;`.

The account-link migration is specified in the phase 2 prerequisite above. It is not in this
PR. Apply it only with a later implementation PR, after a fresh export backup, and never
from a deploy step.
