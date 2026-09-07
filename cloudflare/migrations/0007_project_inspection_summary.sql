-- Persist cheap project-level inspection flags so the homepage does not need to read R2 content.
ALTER TABLE projects ADD COLUMN has_ejs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN has_character_artwork INTEGER NOT NULL DEFAULT 0;
