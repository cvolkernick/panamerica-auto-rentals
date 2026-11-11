-- Per-car money ledger. Amounts are always positive cents.
-- trip_income is money in. Every other type is a deduction or a payout.
-- Apply later with wrangler d1 execute. Do not apply this from a deploy step.

PRAGMA foreign_keys = ON;

CREATE TABLE car_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL,
  entry_date TEXT NOT NULL CHECK (
    entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
  ),
  type TEXT NOT NULL CHECK (
    type IN (
      'trip_income',
      'commission',
      'maintenance',
      'cleaning',
      'tolls',
      'insurance',
      'payout',
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

CREATE INDEX idx_car_ledger_car_date ON car_ledger (car_id, entry_date);
