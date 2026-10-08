-- Per-project daily activity, starting when this migration is applied.
-- Do not fabricate history from cumulative counters.
CREATE TABLE IF NOT EXISTS project_daily_interactions (
  day_key TEXT NOT NULL,
  project_id TEXT NOT NULL,
  downloads_count INTEGER NOT NULL DEFAULT 0 CHECK (downloads_count >= 0),
  likes_added INTEGER NOT NULL DEFAULT 0 CHECK (likes_added >= 0),
  likes_removed INTEGER NOT NULL DEFAULT 0 CHECK (likes_removed >= 0),
  PRIMARY KEY (day_key, project_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Count only actual +1 download counter increments. This is part of the same
-- SQLite statement as the cumulative counter, so the two cannot diverge.
CREATE TRIGGER IF NOT EXISTS trg_project_daily_download_increment
AFTER UPDATE OF downloads_count ON projects
WHEN NEW.downloads_count = COALESCE(OLD.downloads_count, 0) + 1
BEGIN
  INSERT INTO project_daily_interactions (day_key, project_id, downloads_count)
  VALUES (date('now'), NEW.id, 1)
  ON CONFLICT(day_key, project_id) DO UPDATE
  SET downloads_count = downloads_count + 1;
END;

-- The project_likes primary key deduplicates user likes. AFTER triggers only
-- observe actual inserts/deletes; INSERT OR IGNORE does not inflate the tally.
CREATE TRIGGER IF NOT EXISTS trg_project_daily_like_added
AFTER INSERT ON project_likes
BEGIN
  INSERT INTO project_daily_interactions (day_key, project_id, likes_added)
  VALUES (date('now'), NEW.project_id, 1)
  ON CONFLICT(day_key, project_id) DO UPDATE
  SET likes_added = likes_added + 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_project_daily_like_removed
AFTER DELETE ON project_likes
BEGIN
  INSERT INTO project_daily_interactions (day_key, project_id, likes_removed)
  VALUES (date('now'), OLD.project_id, 1)
  ON CONFLICT(day_key, project_id) DO UPDATE
  SET likes_removed = likes_removed + 1;
END;
