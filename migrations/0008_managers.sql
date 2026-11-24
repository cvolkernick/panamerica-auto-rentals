-- Manager role, phase 1: managers, each with one share of the company fee, and
-- per-car manager assignments with history. Amounts stay integer cents elsewhere;
-- share_bps is basis points (1250 = 12.5%) of the management fee on each trip.
-- No guest data, no bank details, no manager payouts or reimbursements here (later phases).
--
-- Assignment dates: start_date is inclusive, end_date is exclusive (the day the next
-- manager takes over, or the day the car was unassigned). A trip belongs to the manager
-- whose assignment covers the trip's start_date, the same attribution rule statements use.
-- At most one open assignment (end_date IS NULL) per car.
--
-- Numbered 0008 so it sorts after PR #29's 0007_team_write_log.sql. It does not depend on it.
-- Apply later with wrangler d1 execute. Do not apply this from a deploy step.
-- Do not run this against production as part of the implementation PR.

PRAGMA foreign_keys = ON;

CREATE TABLE managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(name) BETWEEN 1 AND 80),
  share_bps INTEGER NOT NULL CHECK (share_bps BETWEEN 0 AND 10000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by INTEGER NOT NULL,
  FOREIGN KEY (created_by) REFERENCES owners (id) ON DELETE RESTRICT
);

CREATE TABLE car_manager_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL,
  manager_id INTEGER NOT NULL,
  start_date TEXT NOT NULL CHECK (
    start_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
  ),
  end_date TEXT CHECK (
    end_date IS NULL OR (
      end_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' AND end_date > start_date
    )
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by INTEGER NOT NULL,
  FOREIGN KEY (car_id) REFERENCES cars (id) ON DELETE RESTRICT,
  FOREIGN KEY (manager_id) REFERENCES managers (id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES owners (id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_car_manager_open ON car_manager_assignments (car_id) WHERE end_date IS NULL;
CREATE INDEX idx_car_manager_car_start ON car_manager_assignments (car_id, start_date);
CREATE INDEX idx_car_manager_manager ON car_manager_assignments (manager_id, start_date);
