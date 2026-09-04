-- Backfill the canonical publish timestamp for existing published projects.
-- New approvals already write latest_approved_at directly.

UPDATE projects
SET latest_approved_at = COALESCE(reviewed_at, created_at)
WHERE status = 'approved'
  AND is_published = 1
  AND latest_approved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_public_latest_approved
    ON projects(status, is_published, visibility, latest_approved_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_projects_author_status_reviewed
    ON projects(author_id, status, reviewed_at DESC);
