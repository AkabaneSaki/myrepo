CREATE INDEX IF NOT EXISTS idx_projects_public_type_id
    ON projects(project_type, id)
    WHERE status = 'approved' AND is_published = 1 AND visibility = 1;
