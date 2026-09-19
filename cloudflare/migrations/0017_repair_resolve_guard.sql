-- Bound DLC Repair identity lookups to indexed exact matches and track a small
-- per-actor daily request budget. One batch resolve may contain up to 50 DLCs.

CREATE INDEX IF NOT EXISTS idx_projects_public_id
    ON projects(id)
    WHERE status = 'approved' AND is_published = 1 AND visibility = 1;

CREATE INDEX IF NOT EXISTS idx_projects_public_normalized_name
    ON projects(lower(trim(name)))
    WHERE status = 'approved' AND is_published = 1 AND visibility = 1;

CREATE TABLE IF NOT EXISTS repair_resolve_daily_usage (
    subject_key TEXT NOT NULL,
    day_key TEXT NOT NULL,
    resolve_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (subject_key, day_key)
);

CREATE INDEX IF NOT EXISTS idx_repair_resolve_daily_usage_day
    ON repair_resolve_daily_usage(day_key);
