-- Full 7/30-day public charts start only after complete new tracking windows.
-- Earlier historical likes are not a fully reliable net-activity record.
CREATE TABLE IF NOT EXISTS project_period_tracking_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at TEXT NOT NULL
);
INSERT OR IGNORE INTO project_period_tracking_meta (id, started_at)
VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
