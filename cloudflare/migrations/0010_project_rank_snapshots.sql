CREATE TABLE IF NOT EXISTS project_rank_snapshots (
    kind TEXT NOT NULL CHECK (kind IN ('discover', 'rating')),
    bucket INTEGER NOT NULL,
    project_ids TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (kind, bucket)
);

