CREATE TABLE IF NOT EXISTS project_ranking_days (
    ranking_day TEXT PRIMARY KEY,
    generated_at TEXT NOT NULL,
    project_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_daily_rankings (
    ranking_day TEXT NOT NULL,
    project_id TEXT NOT NULL,
    project_type TEXT NOT NULL,
    discover_rank INTEGER NOT NULL,
    discover_type_rank INTEGER NOT NULL,
    rating_rank INTEGER,
    rating_type_rank INTEGER,
    PRIMARY KEY (ranking_day, project_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_daily_rankings_discover
    ON project_daily_rankings(ranking_day, discover_rank);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_daily_rankings_discover_type
    ON project_daily_rankings(ranking_day, project_type, discover_type_rank);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_daily_rankings_rating
    ON project_daily_rankings(ranking_day, rating_rank)
    WHERE rating_rank IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_daily_rankings_rating_type
    ON project_daily_rankings(ranking_day, project_type, rating_type_rank)
    WHERE rating_type_rank IS NOT NULL;
