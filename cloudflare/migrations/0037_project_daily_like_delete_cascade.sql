-- A cascading project deletion must not recreate activity for its missing parent.
DROP TRIGGER IF EXISTS trg_project_daily_like_removed;
CREATE TRIGGER trg_project_daily_like_removed
AFTER DELETE ON project_likes
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN
  INSERT INTO project_daily_interactions (day_key, project_id, likes_removed)
  VALUES (date('now'), OLD.project_id, 1)
  ON CONFLICT(day_key, project_id) DO UPDATE
  SET likes_removed = likes_removed + 1;
END;
