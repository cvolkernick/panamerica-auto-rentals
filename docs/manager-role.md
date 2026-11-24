# Manager role: phase 1 (admin setup + accrued share)

Spec: Chris t1702u (11/24 1:16 AM ET). This PR is phase 1 only.

## In this phase
- **Managers** (`managers` table, migration `0008_managers.sql`): a name and one share of the
  company fee in basis points (`share_bps`, 1250 = 12.5%), applied across all of that manager's cars.
- **Assignments** (`car_manager_assignments`): each car has at most one open assignment
  (partial unique index). Reassigning closes the open row on the new date and opens a new one,
  so history keeps start (inclusive) and end (exclusive) dates. "Undo last" reverts the latest change.
- **Accrued share**: per trip, the company fee from `statement.ts` (tier fee on the platform's
  actual net payout: 20% under 7 days, 15% for 7-21, 10% over 21) times the manager's share,
  rounded half up to the cent. A trip belongs to whoever managed the car on the trip's start
  date, the same attribution rule statements use. Read-only: owner statements, expenses,
  payouts and the per-car running balance are unchanged.
- **Admin page** `/admin/managers/`: add or edit managers, assign or reassign cars with a start
  date, see each manager's accrued share by month and assignment history.

## API (admin session + CSRF only)
| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/portal/admin/managers` | |
| POST | `/api/portal/admin/managers` | `{ name, shareBps }` |
| GET / PATCH | `/api/portal/admin/managers/:id` | `{ name?, shareBps? }` |
| GET / POST | `/api/portal/admin/cars/:id/managers` | `{ managerId \| null, startDate }` |
| POST | `/api/portal/admin/cars/:id/managers/undo` | |

## Later phases (not built)
- Phase 2: manager sign-in; managers see full income and expenses for their assigned cars only.
- Phase 3: reimbursement claims (manager-submitted, admin approve or reject, never auto-posted to
  the owner statement; an admin may create a separate linked owner expense), and recorded
  payouts to managers (share payouts and reimbursements) with payout history and a
  remaining-due balance. Receipt photos stay outside the system (Chris t1717u).

## Open questions for Chris
1. Fees accrue to whoever managed the car when the trip happened (by trip start date). Confirm.
2. Changing a manager's share re-figures all of their past accrual at the new rate. Should a
   share change apply only from its effective date instead?
3. Panamerica-owned cars: the fee is still computed by the statement code. Should managers earn a
   share on those cars too?

## Apply (after Grok's go, not part of this PR)
`npx wrangler d1 execute panamerica-portal --remote --file=migrations/0008_managers.sql`, after a
fresh `d1 export` backup. Additive only; rollback is `DROP TABLE car_manager_assignments; DROP TABLE managers;`.
