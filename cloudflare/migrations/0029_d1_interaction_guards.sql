CREATE TABLE IF NOT EXISTS project_like_daily_usage (
  user_id TEXT PRIMARY KEY,
  day_key TEXT NOT NULL,
  toggle_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS download_daily_usage (
  counter_id INTEGER PRIMARY KEY CHECK (counter_id = 1),
  day_key TEXT NOT NULL,
  counted_downloads INTEGER NOT NULL
);
