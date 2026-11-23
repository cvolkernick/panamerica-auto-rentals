-- Trip income, CSV import previews, and admin-entered car expenses.
-- Amounts are integer cents. Do not copy these rows into car_ledger.
-- Apply later with wrangler d1 execute. Do not apply this from a deploy step.
-- Do not run this against production as part of the implementation PR.
--
-- tax_cents, pending_payout_cents, and has_pending are the Wheelbase
-- pass-through tax and unsettled deposits (spec sections 14-15). Turo
-- leaves tax null. import_review_items keeps non-PII rows that could not
-- be mapped (unknown transaction types, booking ids that do not join).
-- Guest names are not stored.

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
  tax_cents INTEGER,
  pending_payout_cents INTEGER,
  has_pending INTEGER NOT NULL DEFAULT 0 CHECK (has_pending IN (0, 1)),
  counts_as_income INTEGER NOT NULL DEFAULT 0 CHECK (counts_as_income IN (0, 1)),
  match_status TEXT NOT NULL CHECK (
    match_status IN ('matched', 'unmatched', 'ambiguous', 'invalid')
  ),
  car_id INTEGER,
  error TEXT,
  FOREIGN KEY (import_id) REFERENCES trip_imports (id) ON DELETE CASCADE,
  FOREIGN KEY (car_id) REFERENCES cars (id) ON DELETE SET NULL
);

CREATE INDEX idx_trip_import_rows_import ON trip_import_rows (import_id, match_status);

CREATE TABLE import_review_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL,
  row_number INTEGER,
  kind TEXT NOT NULL CHECK (
    kind IN ('unknown_type', 'unmatched_booking', 'unparsed')
  ),
  external_trip_id TEXT,
  type_raw TEXT,
  detail TEXT NOT NULL,
  FOREIGN KEY (import_id) REFERENCES trip_imports (id) ON DELETE CASCADE
);

CREATE INDEX idx_import_review_items_import ON import_review_items (import_id);

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
  tax_cents INTEGER,
  pending_payout_cents INTEGER,
  has_pending INTEGER NOT NULL DEFAULT 0 CHECK (has_pending IN (0, 1)),
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
