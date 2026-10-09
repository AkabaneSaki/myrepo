-- Store only daily changes; a project is at most one row per day.
-- Older downloads were never timestamped and are intentionally not backfilled.
CREATE TABLE IF NOT EXISTS project_metric_daily (
  day_key TEXT NOT NULL,
  project_id TEXT NOT NULL,
  downloads INTEGER NOT NULL DEFAULT 0,
  likes_delta INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day_key, project_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Existing active likes have trustworthy timestamps, so preserve the available
-- 30-day like history. Old downloads have no per-day history to backfill.
INSERT INTO project_metric_daily (day_key, project_id, likes_delta)
SELECT substr(created_at, 1, 10), project_id, COUNT(*)
FROM project_likes
WHERE created_at IS NOT NULL
  AND substr(created_at, 1, 10) BETWEEN date('now', '-29 days') AND date('now')
GROUP BY substr(created_at, 1, 10), project_id;

CREATE TRIGGER IF NOT EXISTS trg_project_metric_daily_like_insert
AFTER INSERT ON project_likes
BEGIN
  INSERT INTO project_metric_daily (day_key, project_id, likes_delta)
  VALUES (date('now'), NEW.project_id, 1)
  ON CONFLICT(day_key, project_id) DO UPDATE SET likes_delta = likes_delta + 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_project_metric_daily_like_delete
AFTER DELETE ON project_likes
BEGIN
  INSERT INTO project_metric_daily (day_key, project_id, likes_delta)
  SELECT date('now'), OLD.project_id, -1
  WHERE EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
  ON CONFLICT(day_key, project_id) DO UPDATE SET likes_delta = likes_delta - 1;
END;

-- Four small serialized ranking lists updated by the scheduled Worker.
CREATE TABLE IF NOT EXISTS project_period_popularity (
  sort_mode TEXT PRIMARY KEY,
  project_ids TEXT NOT NULL,
  generated_at TEXT NOT NULL
);
