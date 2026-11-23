# Owner portal: management fee, running balance, payouts, and monthly statement

Follows the money MVP (`docs/portal-money-mvp-spec.md`, PR #27, main `c27b840`).
Approved by Chris at 1:03 AM ET (America/New_York) on Monday, November 23, 2026:
"Yes, start building the fee, carry-forward and statement update now."

No merge, deploy, or production D1 write is part of this change. `migrations/0006_payouts.sql`
is applied by hand later, after the PR is approved.

## 1. Chris's rules (his words, 11/23 12:57 to 1:02 AM ET)

1. "Any expenses that are logged should be deducted from any rental proceeds for each period. If there are any expenses that have not been accounted for in a previous period (for example, if the prior period had expense but no rentals, or if the prior period(s)' rental income did not fully cover all outstanding expense), any remainder should be accounted for and deducted from following rental proceeds, until expenses are covered. In other words, expenses should accrue so long as they exceed rental proceeds, and payouts should only be made if there is a net surplus that has accrued."
   The main example is onboarding: road-ready work done before the first rentals, possibly in a month that closes before any rental income.
2. "Panamerica management fee is based strictly on rental revenue, regardless of expense. So Panamerica fees should be calculated *pre* expense, and then included in the period statement as a final expense when the period comes to a close. This would also factor into whether a balance rolls over to the next month or not."
3. "Let's keep all expense/revenues self-contained on a car-by-car basis. Each car should be self-contained and self-sustaining." Nothing is ever pooled across an owner's cars.
4. One flagship management plan with the public trip-length tiers: 20% for trips under 7 days, 15% for 7 to 21 days, 10% over 21 days.

## 2. Management fee

Code: `lib/portal/statement.ts` (`tripLengthDays`, `feeRateBps`, `managementFeeCents`, `feeForTrip`).

- Charged per trip, only on trips with `counts_as_income = 1`. Booked, in-progress, and other
  not-yet-counted trips earn no fee.
- **Fee base (assumption, written down on purpose):** the trip's counted income, the same number
  the net report already uses: `payout_cents - COALESCE(tax_cents, 0)`. For Turo that is the
  payout (Turo payouts are already net of sales tax). For Wheelbase it is the payout after the
  sales-tax pass-through. Platform fees the platform already took (Turo's cut, Wheelbase CC and
  Wheelbase fees) are already out of the payout, so the fee is on what the platform actually
  paid for the car, not on the guest-facing trip price.
- **Trip length:** calendar days from `start_date` to `end_date` (both YYYY-MM-DD, local trip
  dates). A same-day trip, or a trip with no usable end date, counts as 1 day. Clock times are
  not used, so a few hours late on return does not move a trip into another tier.
- **Tiers:** under 7 days 20%; 7 through 21 days 15% (exactly 7 and exactly 21 are both 15%);
  22 days and over 10%. Rates are held as basis points (2000 / 1500 / 1000).
- **Rounding:** per trip, to integer cents, half up: `floor((base * bps + 5000) / 10000)`. A
  month's fee is the sum of its trips' rounded fees (never re-rounded on the total). A base of
  zero or less earns no fee.
- **Cancellation fees:** a Turo guest or host cancellation with a non-zero payout already counts
  as income (MVP rule), so it earns a fee at the booked trip's length.
- **Month:** a trip's fee lands in the month its `start_date` falls in, the same attribution the
  net report uses. Trips are not split across months.
- The fee is shown as the last expense line on the statement, after logged expenses.
- The old manual `commission` expense category still exists for existing rows, but the admin
  form warns that the management fee is now automatic. Logging the fee by hand would double it.

## 3. Running balance per car per month

Code: `buildStatements` in `lib/portal/statement.ts`. Months are America/New_York calendar
months. Trips count in their `start_date` month, expenses in their `entry_date` month, payouts in
their `period_month`.

The run starts at the car's first activity month (earliest trip, expense, or payout) and goes
through the later of the current month and the requested month. For each month `m`:

```
carry_in(m)  = carry_out(m - 1)            (0 for the first month)
closing(m)   = carry_in(m) + income(m) - expenses(m) - fee(m)
left(m)      = closing(m) - paid(m)         (paid = payouts recorded for m)
payout_due(m) = max(0, left(m))
carry_out(m)  = min(0, left(m))
```

- **carry_in** is only ever zero or negative. A month that ends below zero rolls the whole
  shortfall into the next month, which takes it out of the next rental income first. This repeats
  for as many months as it takes.
- A month that ends above zero owes that amount for that month. A positive balance never rolls
  forward; it stays "payout due" on its own month until a payout is recorded against it. The
  statement also shows the total owed across all months.
- The current month is marked open. Its "payout due" is labeled "if the month closed today".
- A month before the car's first activity reads as an empty zero statement.
- Each car is computed only from its own trips, expenses, and payouts. There is no owner-level
  pooling anywhere.

Worked onboarding example (unit and API tests): $800 road-ready work in October, no trips.
October closes at -$800 and carries it. November has a 5-day trip with $500 income: fee $100
(20%), closing -$400, carried. December has a 10-day trip with $1,000 income: fee $150 (15%),
closing +$450, payout due $450.

## 4. Payout records

Migration `migrations/0006_payouts.sql`, table `payouts`:
`id, car_id, period_month (YYYY-MM), paid_date (YYYY-MM-DD), amount_cents (> 0), note (<= 80
chars, optional), created_at, created_by`. `car_id` is `ON DELETE RESTRICT`, and deleting a car
with payouts returns 409 `car_has_payouts`.

- No bank, account, routing, Zelle, or guest details. The API rejects a note with an `@`, or a
  run of 6 or more digits (with optional spaces or dashes), so account and phone numbers cannot
  be typed in.
- `period_month` cannot be later than the current Eastern month.
- Admin: `GET/POST /api/portal/admin/cars/:id/payouts`, `DELETE /api/portal/admin/cars/:id/payouts/:payoutId`.
  POST and DELETE go through the same session CSRF token and same-origin check as every other
  admin write. A payout id under the wrong car id is 404. There is no edit; delete and re-record.
- Owner: `GET /api/portal/cars/:id/payouts`, read-only, `owner_id`-scoped (404 for a car the
  owner does not own). Non-GET is 404.

### 4.1 A re-import that changes a month already paid out

Trip rows are upserted on `(platform, external_trip_id)`, so a later import can change a paid
month's income. Payout rows are never touched by an import, and nothing recomputes or rewrites
them. The statement is recomputed from current data every time, so the difference flows through
the running balance:

- **Income goes down** (refund, adjustment): `paid(m)` is now more than `closing(m)`. The
  statement shows the overpaid amount, `payout_due(m)` is 0, and the negative `left(m)` carries
  into the next month as a shortfall, so it is recovered from later rental income. Nothing is
  clawed back by editing the payout.
- **Income goes up**: the extra shows as payout due on the original month, on top of what was
  already paid.

## 5. Monthly statement

API: `GET /api/portal/admin/cars/:id/statement?month=YYYY-MM` (admin) and
`GET /api/portal/cars/:id/statement?month=YYYY-MM` (owner, `owner_id`-scoped). The response has
the car (year, make, model, plate), the month's statement, the full month-by-month history, the
total owed, and the fee tiers.

Statement lines, in order: shortfall carried in; trips starting this month (platform, dates,
status, days, counted income, fee rate, fee; no guest names); rental income; each expense and the
expense total; Panamerica management fee (last expense line); closing balance; payouts recorded
(each one); payout due, or shortfall carried to next month.

UI:
- Admin car page (`/admin/cars/<plate>/`) and owner view (`/owner/`): the existing net report
  totals stay (relabeled "Net before fee"), followed by the monthly statement, a running-balance
  table for the last 12 months, and, for admin, the payout list and "Record payout" form.
- Printable page: `/admin/statement/?car=<id>&month=YYYY-MM` and
  `/owner/statement/?car=<id>&month=YYYY-MM`. Paper styling; print CSS hides the site header,
  footer, and buttons, so the browser's Print / Save as PDF gives a clean one-page statement.
  Both pages are `noindex` and sit under the existing `/admin/*` and `/owner/*` header rules.

## 6. Tests

`tests/portal/statement.test.ts`: trip length; 6/7/21/22-day boundaries; half-up rounding per
trip; non-income trips earn no fee; cancellation-fee income; onboarding (October expense, no
trips, covered by November and December income, payout only once positive); multi-month
shortfall including a month with no income (fee 0); no pooling across cars; overpay carries
forward; open month; payout validation; the API end to end on a memory D1 with all migrations
(Wheelbase-style tax pass-through as fee base, empty month before first activity, no guest data
in the payload); owner isolation (statement and payouts 404 for another owner's car, admin routes
403 for owners, payout under the wrong car 404, car delete blocked by payouts); a re-import after
a payout in both directions with the payout row unchanged; and CSRF (wrong or missing token, and a
cross-origin request, are 403; the right token on the same origin is 201/200).

## 7. Open questions for Chris

1. Fee base: counted income (platform payout after tax, after the platform's own fees), as built.
   Should it instead be the guest-facing trip price (Turo trip price, Wheelbase Subtotal)?
2. Trip length: calendar days from start to end date, as built. Turo's export also has a "Trip
   days" column; should Turo trips use that instead?
3. A trip that only has a negative or zero counted amount (for example a refund-only adjustment)
   earns no fee and does not refund an earlier fee. Is that right?
4. Payouts for the current, still-open month are allowed (for mid-month payouts). Should they
   wait until the month closes?
