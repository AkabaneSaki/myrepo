CREATE TABLE IF NOT EXISTS devteam_curators (
  user_id TEXT PRIMARY KEY,
  bio TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS devteam_recommendations (
  curator_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  comment_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (curator_id, project_id),
  FOREIGN KEY (curator_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_devteam_recommendations_project
  ON devteam_recommendations(project_id);

CREATE INDEX IF NOT EXISTS idx_devteam_recommendations_updated
  ON devteam_recommendations(updated_at DESC);
