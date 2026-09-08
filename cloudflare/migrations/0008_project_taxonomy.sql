-- P2 #21: structured project taxonomy.
-- Keep legacy projects.tags as a compatibility mirror for older clients.

ALTER TABLE projects ADD COLUMN project_type TEXT NOT NULL DEFAULT '系统核心';
ALTER TABLE projects ADD COLUMN extension_type TEXT;
ALTER TABLE projects ADD COLUMN facets TEXT NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN custom_tags TEXT NOT NULL DEFAULT '[]';

-- Backfill the old single base tag into the new canonical project type.
-- Any strict legacy category beats 扩展 so malformed multi-base-tag rows fail closed.
UPDATE projects
SET project_type = CASE
    WHEN json_valid(tags) AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value IN ('系统', '系统核心')) THEN '系统核心'
    WHEN json_valid(tags) AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = '角色') THEN '角色'
    WHEN json_valid(tags) AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = '事件') THEN '事件'
    WHEN json_valid(tags) AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = '扩展') THEN '扩展'
    ELSE '系统核心'
END;

-- Existing creator tags remain creator tags. Do not guess official facets from
-- historical free-form tags; creators can classify them when editing later.
UPDATE projects
SET custom_tags = COALESCE(
    (
        SELECT json_group_array(value)
        FROM json_each(CASE WHEN json_valid(projects.tags) THEN projects.tags ELSE '[]' END)
        WHERE value NOT IN ('系统', '系统核心', '扩展', '角色', '事件')
    ),
    '[]'
);

CREATE INDEX IF NOT EXISTS idx_projects_public_type_published
    ON projects(status, is_published, visibility, project_type, latest_approved_at DESC, updated_at DESC);

