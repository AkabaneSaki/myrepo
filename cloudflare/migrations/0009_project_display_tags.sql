-- Add homepage display-tag selection. NULL means legacy/unconfigured and falls back to custom tags at read time.
ALTER TABLE projects ADD COLUMN display_tags TEXT;
