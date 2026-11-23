-- Owner payouts recorded by Panamerica admin, one row per payment, per car.
-- Amounts are integer cents. period_month is the America/New_York statement month
-- (YYYY-MM) the payment settles; paid_date is the day the money was sent.
-- No bank, account, routing, Zelle, or guest details live here, ever.
-- A recorded payout is never rewritten by a trip re-import. If a later import
-- changes a paid month, the difference flows through the running balance
-- (see docs/portal-statement-spec.md).
-- Apply later with wrangler d1 execute. Do not apply this from a deploy step.
-- Do not run this against production as part of the implementation PR.

PRAGMA foreign_keys = ON;

CREATE TABLE payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL,
  period_month TEXT NOT NULL CHECK (
    period_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'
  ),
  paid_date TEXT NOT NULL CHECK (
    paid_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
  ),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  note TEXT CHECK (note IS NULL OR length(note) <= 80),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by INTEGER NOT NULL,
  FOREIGN KEY (car_id) REFERENCES cars (id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES owners (id) ON DELETE RESTRICT
);

CREATE INDEX idx_payouts_car_month ON payouts (car_id, period_month);
