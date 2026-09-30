-- Persist creator-selected original worldbook entry names on the project itself.
-- Runtime install/update paths must not dereference the full immutable baseline from D1.

ALTER TABLE projects
ADD COLUMN original_conflict_entry_names TEXT NOT NULL DEFAULT '[]';

-- Backfill only when every previously selected reference item can still be
-- resolved to a worldbook entry. Incomplete legacy rows remain [] and fail
-- closed to manual handling instead of silently disabling a partial set.
UPDATE projects
SET original_conflict_entry_names = (
    SELECT json_group_array(i.display_name)
    FROM json_each(projects.original_conflict_reference_item_ids) selected
    JOIN character_reference_items i ON i.id = selected.value
    WHERE i.kind = 'worldbook'
)
WHERE conflicts_with_original = 1
  AND json_valid(original_conflict_reference_item_ids)
  AND json_array_length(original_conflict_reference_item_ids) > 0
  AND (
      SELECT COUNT(*)
      FROM json_each(projects.original_conflict_reference_item_ids) selected
      JOIN character_reference_items i ON i.id = selected.value
      WHERE i.kind = 'worldbook'
  ) = json_array_length(original_conflict_reference_item_ids);
