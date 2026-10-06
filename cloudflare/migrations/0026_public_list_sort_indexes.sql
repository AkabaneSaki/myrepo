DROP INDEX IF EXISTS idx_projects_public_created;
CREATE INDEX idx_projects_public_created
    ON projects(status, is_published, visibility, created_at DESC, id DESC);

DROP INDEX IF EXISTS idx_projects_public_latest_approved;
CREATE INDEX idx_projects_public_latest_approved
    ON projects(status, is_published, visibility, latest_approved_at DESC, id DESC);

DROP INDEX IF EXISTS idx_projects_public_type_published;
CREATE INDEX idx_projects_public_type_published
    ON projects(status, is_published, visibility, project_type, latest_approved_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_projects_public_type_created
    ON projects(status, is_published, visibility, project_type, created_at DESC, id DESC);

DROP INDEX IF EXISTS idx_projects_public_updated;
