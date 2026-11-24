-- Team connector write log. One row per write made with the team service token.
-- agent_name is the calling agent's own label (X-Agent-Name). No guest data, no
-- token, no request headers are stored here. before_json / after_json are the
-- portal's own JSON for the row (car fields, expense or income amounts and dates).
-- Apply once with wrangler d1 execute --file before the deploy that reads it.

PRAGMA foreign_keys = ON;

CREATE TABLE team_write_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  agent_name TEXT NOT NULL CHECK (length(agent_name) BETWEEN 1 AND 80),
  action TEXT NOT NULL CHECK (
    action IN (
      'car.update',
      'expense.create',
      'expense.update',
      'expense.delete',
      'income.create',
      'income.update',
      'income.delete'
    )
  ),
  car_id INTEGER NOT NULL,
  entity_id INTEGER NOT NULL,
  before_json TEXT,
  after_json TEXT,
  FOREIGN KEY (car_id) REFERENCES cars (id) ON DELETE RESTRICT
);

CREATE INDEX idx_team_write_log_car ON team_write_log (car_id, id);
CREATE INDEX idx_team_write_log_entity ON team_write_log (action, entity_id);
