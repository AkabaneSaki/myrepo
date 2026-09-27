CREATE TABLE IF NOT EXISTS daily_random_draw_state (
    user_id TEXT PRIMARY KEY,
    draw_day TEXT NOT NULL,
    daily_count INTEGER NOT NULL DEFAULT 0 CHECK (daily_count BETWEEN 0 AND 10),
    recent_project_ids TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
