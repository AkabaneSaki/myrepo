CREATE TABLE IF NOT EXISTS project_ranking_builds (
    ranking_day TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('building', 'complete')),
    project_count INTEGER NOT NULL DEFAULT 0,
    type_counts TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL,
    completed_at TEXT,
    build_token TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_ranking_builds_complete_day
    ON project_ranking_builds(status, ranking_day DESC);

CREATE TABLE IF NOT EXISTS discovery_feature_history (
    ranking_day TEXT NOT NULL,
    project_id TEXT NOT NULL,
    featured_rank INTEGER NOT NULL,
    PRIMARY KEY (ranking_day, project_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_discovery_feature_history_day_rank
    ON discovery_feature_history(ranking_day, featured_rank);

CREATE INDEX IF NOT EXISTS idx_discovery_feature_history_project_day
    ON discovery_feature_history(project_id, ranking_day DESC);
