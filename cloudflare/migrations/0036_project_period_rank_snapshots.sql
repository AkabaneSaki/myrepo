-- A single precomputed bounded leaderboard payload per complete UTC day.
-- Browsing reads this snapshot; it never groups the raw daily activity table.
CREATE TABLE IF NOT EXISTS project_period_rank_snapshots (
  period_end_day TEXT PRIMARY KEY,
  board_json TEXT NOT NULL,
  built_at TEXT NOT NULL
);
