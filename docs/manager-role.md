# Manager role: phase 1 (admin setup + accrued share)

Spec: Chris t1702u (11/24 1:16 AM ET). This PR is phase 1 only.

## In this phase
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

## API (admin session + CSRF only)
| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/portal/admin/managers` | |
| POST | `/api/portal/admin/managers` | `{ name, shareBps, effectiveFrom }` (seeds the first rate) |
| GET / PATCH | `/api/portal/admin/managers/:id` | `{ name }` (shareBps is refused) |
| GET / POST | `/api/portal/admin/managers/:id/rates` | `{ shareBps, effectiveFrom }`, after the latest rate |
| GET / POST | `/api/portal/admin/cars/:id/managers` | `{ managerId \| null, startDate }` |
| POST | `/api/portal/admin/cars/:id/managers/undo` | |

## Later phases (not built)
- Phase 2: manager sign-in; managers see full income and expenses for their assigned cars only.
- Phase 3: reimbursement claims (manager-submitted, admin approve or reject, never auto-posted to
  the owner statement; an admin may create a separate linked owner expense), and recorded
  payouts to managers (share payouts and reimbursements) with payout history and a
  remaining-due balance. Receipt photos stay outside the system (Chris t1717u).

## Decisions and open questions
1. Resolved (Grok, 11/24): fees accrue to whoever managed the car on the trip's start date.
2. Resolved (Grok, 11/24): a share change applies forward only from its effective date, with
   dated rate history; past accrual is never re-rated.
3. **Open (Chris):** should managers earn a share on Panamerica-owned cars? Current default,
   unchanged: yes. The statement code computes a fee on every car, and the share follows it.

## Apply (after Grok's go, not part of this PR)
`npx wrangler d1 execute panamerica-portal --remote --file=migrations/0008_managers.sql`, after a
fresh `d1 export` backup. Additive only (three new tables, no change to existing ones); rollback is
`DROP TABLE car_manager_assignments; DROP TABLE manager_share_rates; DROP TABLE managers;`.
