-- Store creator-declared original-card conflicts for each project.
-- The selected IDs point at immutable character_reference_items from the
-- project baseline version, so the client can later disable/restore the
-- matching original entries without relying on display names alone.

ALTER TABLE projects ADD COLUMN conflicts_with_original INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN original_conflict_reference_item_ids TEXT NOT NULL DEFAULT '[]';
