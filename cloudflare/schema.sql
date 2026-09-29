-- 创意工坊数据库 Schema
-- 用于新建环境（例如 creative_workshop_staging）的完整基线结构。
-- 已存在的 production 数据库不要重新执行本文件来代替 migration。

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    global_name TEXT,
    avatar TEXT,
    discriminator TEXT,
    guilds TEXT,
    is_admin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    precautions TEXT,
    discord_thread_url TEXT,
    version TEXT DEFAULT '1.0.0',
    version_label TEXT,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_avatar TEXT,
    status TEXT DEFAULT 'pending',
    download_url TEXT,
    file_size INTEGER,
    downloads_count INTEGER DEFAULT 0,
    likes_count INTEGER NOT NULL DEFAULT 0,
    has_ejs INTEGER NOT NULL DEFAULT 0,
    has_character_artwork INTEGER NOT NULL DEFAULT 0,
    project_type TEXT NOT NULL DEFAULT '系统核心',
    extension_type TEXT,
    facets TEXT NOT NULL DEFAULT '{}',
    custom_tags TEXT NOT NULL DEFAULT '[]',
    display_tags TEXT,
    tags TEXT DEFAULT '[]',
    cover_image TEXT,
    cover_position_x REAL NOT NULL DEFAULT 50,
    cover_position_y REAL NOT NULL DEFAULT 50,
    cover_zoom REAL NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    reviewer_id TEXT,
    reject_reason TEXT,
    root_project_id TEXT,
    published_project_id TEXT,
    draft_project_id TEXT,
    review_target TEXT DEFAULT 'project',
    draft_revision INTEGER NOT NULL DEFAULT 1,
    visibility INTEGER DEFAULT 1,
    is_published INTEGER DEFAULT 0,
    latest_approved_at TEXT,
    character_reference_id TEXT,
    built_for_reference_version_id TEXT,
    tested_through_reference_version_id TEXT,
    compatibility_status TEXT,
    compatibility_known_incompatible INTEGER NOT NULL DEFAULT 0,
    compatibility_note TEXT,
    compatibility_grace_until TEXT,
    compatibility_updated_at TEXT,
    conflicts_with_original INTEGER NOT NULL DEFAULT 0,
    original_conflict_reference_item_ids TEXT NOT NULL DEFAULT '[]',
    worldbook_ejs_length_estimates TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_author ON projects(author_id);
CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_public_created
    ON projects(status, is_published, visibility, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_projects_public_downloads
    ON projects(status, is_published, visibility, downloads_count DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_public_likes
    ON projects(status, is_published, visibility, likes_count DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_public_latest_approved
    ON projects(status, is_published, visibility, latest_approved_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_projects_public_type_published
    ON projects(status, is_published, visibility, project_type, latest_approved_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_projects_public_type_created
    ON projects(status, is_published, visibility, project_type, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_projects_public_id
    ON projects(id)
    WHERE status = 'approved' AND is_published = 1 AND visibility = 1;
CREATE INDEX IF NOT EXISTS idx_projects_public_type_id
    ON projects(project_type, id)
    WHERE status = 'approved' AND is_published = 1 AND visibility = 1;
CREATE INDEX IF NOT EXISTS idx_projects_public_normalized_name
    ON projects(lower(trim(name)))
    WHERE status = 'approved' AND is_published = 1 AND visibility = 1;
CREATE INDEX IF NOT EXISTS idx_projects_author_status_reviewed
    ON projects(author_id, status, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_character_reference
    ON projects(character_reference_id);
CREATE INDEX IF NOT EXISTS idx_projects_built_for_reference_version
    ON projects(built_for_reference_version_id);
CREATE INDEX IF NOT EXISTS idx_projects_tested_through_reference_version
    ON projects(tested_through_reference_version_id);
CREATE INDEX IF NOT EXISTS idx_users_guilds ON users(guilds);

CREATE TABLE IF NOT EXISTS public_project_counts (
    scope TEXT PRIMARY KEY,
    project_count INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO public_project_counts (scope, project_count, revision) VALUES ('*', 0, 1);

CREATE TRIGGER IF NOT EXISTS public_project_count_insert AFTER INSERT ON projects
WHEN NEW.status = 'approved' AND NEW.is_published = 1 AND NEW.visibility = 1
BEGIN
    UPDATE public_project_counts
    SET project_count = project_count + 1, revision = revision + 1
    WHERE scope = '*';
    INSERT INTO public_project_counts (scope, project_count)
    VALUES (NEW.project_type, 1)
    ON CONFLICT(scope) DO UPDATE SET project_count = project_count + 1;
END;

CREATE TRIGGER IF NOT EXISTS public_project_count_delete AFTER DELETE ON projects
WHEN OLD.status = 'approved' AND OLD.is_published = 1 AND OLD.visibility = 1
BEGIN
    UPDATE public_project_counts
    SET project_count = project_count - 1, revision = revision + 1
    WHERE scope = '*';
    UPDATE public_project_counts SET project_count = project_count - 1
    WHERE scope = OLD.project_type;
END;

CREATE TRIGGER IF NOT EXISTS public_project_count_leave AFTER UPDATE OF status, is_published, visibility, project_type ON projects
WHEN OLD.status = 'approved' AND OLD.is_published = 1 AND OLD.visibility = 1
  AND (NOT (COALESCE(NEW.status, '') = 'approved' AND COALESCE(NEW.is_published, 0) = 1 AND COALESCE(NEW.visibility, 0) = 1)
       OR OLD.project_type IS NOT NEW.project_type)
BEGIN
    UPDATE public_project_counts
    SET project_count = project_count - CASE
          WHEN NEW.status = 'approved' AND NEW.is_published = 1 AND NEW.visibility = 1 THEN 0 ELSE 1 END,
        revision = revision + 1
    WHERE scope = '*';
    UPDATE public_project_counts SET project_count = project_count - 1
    WHERE scope = OLD.project_type;
END;

CREATE TRIGGER IF NOT EXISTS public_project_count_enter AFTER UPDATE OF status, is_published, visibility, project_type ON projects
WHEN NEW.status = 'approved' AND NEW.is_published = 1 AND NEW.visibility = 1
  AND (NOT (COALESCE(OLD.status, '') = 'approved' AND COALESCE(OLD.is_published, 0) = 1 AND COALESCE(OLD.visibility, 0) = 1)
       OR OLD.project_type IS NOT NEW.project_type)
BEGIN
    UPDATE public_project_counts
    SET project_count = project_count + CASE
          WHEN OLD.status = 'approved' AND OLD.is_published = 1 AND OLD.visibility = 1 THEN 0 ELSE 1 END,
        revision = revision + 1
    WHERE scope = '*';
    INSERT INTO public_project_counts (scope, project_count)
    VALUES (NEW.project_type, 1)
    ON CONFLICT(scope) DO UPDATE SET project_count = project_count + 1;
END;

CREATE TRIGGER IF NOT EXISTS public_project_content_update AFTER UPDATE OF updated_at ON projects
WHEN (OLD.status = 'approved' AND OLD.is_published = 1 AND OLD.visibility = 1)
  OR (NEW.status = 'approved' AND NEW.is_published = 1 AND NEW.visibility = 1)
BEGIN
    UPDATE public_project_counts SET revision = revision + 1 WHERE scope = '*';
END;

CREATE TABLE IF NOT EXISTS devteam_curators (
    user_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    reaction_presets TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS devteam_recommendations (
    curator_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    comment_text TEXT NOT NULL,
    reaction_label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (curator_id, project_id),
    FOREIGN KEY (curator_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_devteam_recommendations_project
    ON devteam_recommendations(project_id);
CREATE INDEX IF NOT EXISTS idx_devteam_recommendations_updated
    ON devteam_recommendations(updated_at DESC);

CREATE TABLE IF NOT EXISTS character_references (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_character_references_name
    ON character_references(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS character_reference_versions (
    id TEXT PRIMARY KEY,
    character_reference_id TEXT NOT NULL,
    version_label TEXT NOT NULL,
    version_ordinal INTEGER NOT NULL,
    grace_until TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (character_reference_id) REFERENCES character_references(id) ON DELETE CASCADE,
    UNIQUE (character_reference_id, version_label),
    UNIQUE (character_reference_id, version_ordinal)
);

CREATE INDEX IF NOT EXISTS idx_character_reference_versions_latest
    ON character_reference_versions(character_reference_id, version_ordinal DESC);

CREATE TABLE IF NOT EXISTS character_reference_items (
    id TEXT PRIMARY KEY,
    reference_version_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('worldbook', 'regex')),
    source_key TEXT,
    display_name TEXT NOT NULL,
    exact_hash TEXT NOT NULL,
    normalized_content_hash TEXT NOT NULL,
    name_hash TEXT NOT NULL,
    keys_hash TEXT,
    structure_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reference_version_id) REFERENCES character_reference_versions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_character_reference_items_version_kind
    ON character_reference_items(reference_version_id, kind);
CREATE INDEX IF NOT EXISTS idx_character_reference_items_exact
    ON character_reference_items(kind, exact_hash);
CREATE INDEX IF NOT EXISTS idx_character_reference_items_content
    ON character_reference_items(kind, normalized_content_hash);
CREATE INDEX IF NOT EXISTS idx_character_reference_items_name
    ON character_reference_items(kind, name_hash);
CREATE INDEX IF NOT EXISTS idx_character_reference_items_structure
    ON character_reference_items(kind, structure_hash);

CREATE TABLE IF NOT EXISTS project_metadata_audit_logs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    before_value TEXT,
    after_value TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_metadata_audit_project_created
    ON project_metadata_audit_logs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_rank_snapshots (
    kind TEXT NOT NULL CHECK (kind IN ('discover', 'rating')),
    bucket INTEGER NOT NULL,
    project_ids TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (kind, bucket)
);

CREATE TABLE IF NOT EXISTS project_ranking_days (
    ranking_day TEXT PRIMARY KEY,
    generated_at TEXT NOT NULL,
    project_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_daily_rankings (
    ranking_day TEXT NOT NULL,
    project_id TEXT NOT NULL,
    project_type TEXT NOT NULL,
    discover_rank INTEGER NOT NULL,
    discover_type_rank INTEGER NOT NULL,
    rating_rank INTEGER,
    rating_type_rank INTEGER,
    PRIMARY KEY (ranking_day, project_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_daily_rankings_discover
    ON project_daily_rankings(ranking_day, discover_rank);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_daily_rankings_discover_type
    ON project_daily_rankings(ranking_day, project_type, discover_type_rank);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_daily_rankings_rating
    ON project_daily_rankings(ranking_day, rating_rank)
    WHERE rating_rank IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_daily_rankings_rating_type
    ON project_daily_rankings(ranking_day, project_type, rating_type_rank)
    WHERE rating_type_rank IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_ranking_builds (
    ranking_day TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('building', 'complete')),
    project_count INTEGER NOT NULL DEFAULT 0,
    type_counts TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL,
    completed_at TEXT,
    build_token TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_ranking_builds_complete_day
    ON project_ranking_builds(status, ranking_day DESC);

CREATE TABLE IF NOT EXISTS discovery_feature_history (
    ranking_day TEXT NOT NULL,
    project_id TEXT NOT NULL,
    featured_rank INTEGER NOT NULL,
    PRIMARY KEY (ranking_day, project_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_discovery_feature_history_day_rank
    ON discovery_feature_history(ranking_day, featured_rank);
CREATE INDEX IF NOT EXISTS idx_discovery_feature_history_project_day
    ON discovery_feature_history(project_id, ranking_day DESC);

CREATE TABLE IF NOT EXISTS daily_random_draw_state (
    user_id TEXT PRIMARY KEY,
    draw_day TEXT NOT NULL,
    daily_count INTEGER NOT NULL DEFAULT 0 CHECK (daily_count BETWEEN 0 AND 10),
    recent_project_ids TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_likes (
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

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

CREATE TABLE IF NOT EXISTS project_ratings (
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment_text TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_subscribes (
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_likes_project_id ON project_likes(project_id);
CREATE INDEX IF NOT EXISTS idx_project_likes_user_id ON project_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_project_ratings_project_id ON project_ratings(project_id);
CREATE INDEX IF NOT EXISTS idx_project_ratings_user_id ON project_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_project_subscribes_project_id ON project_subscribes(project_id);
CREATE INDEX IF NOT EXISTS idx_project_subscribes_user_id ON project_subscribes(user_id);
CREATE INDEX IF NOT EXISTS idx_project_likes_user_project ON project_likes(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_project_subscribes_user_project ON project_subscribes(user_id, project_id);

CREATE TABLE IF NOT EXISTS repair_resolve_daily_usage (
    subject_key TEXT NOT NULL,
    day_key TEXT NOT NULL,
    resolve_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (subject_key, day_key)
);

CREATE INDEX IF NOT EXISTS idx_repair_resolve_daily_usage_day
    ON repair_resolve_daily_usage(day_key);

CREATE TRIGGER IF NOT EXISTS trg_project_likes_after_insert
AFTER INSERT ON project_likes
BEGIN
    UPDATE projects
    SET likes_count = COALESCE(likes_count, 0) + 1
    WHERE id = NEW.project_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_project_likes_after_delete
AFTER DELETE ON project_likes
BEGIN
    UPDATE projects
    SET likes_count = MAX(COALESCE(likes_count, 0) - 1, 0)
    WHERE id = OLD.project_id;
END;

CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT
);

CREATE TABLE IF NOT EXISTS admin_action_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    detail TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS super_admins (
    user_id TEXT PRIMARY KEY,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    note TEXT
);

-- 旧版保留表。当前管理员权限实际使用 users.is_admin / super_admins。
CREATE TABLE IF NOT EXISTS admins (
    user_id TEXT PRIMARY KEY,
    role TEXT DEFAULT 'moderator',
    added_at TEXT DEFAULT CURRENT_TIMESTAMP,
    added_by TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Keep searchable project text and exact tag values in indexed tables.
CREATE VIRTUAL TABLE project_search USING fts5(
    name, description, project_type, extension_type, custom_tags, facets,
    tags, author_name, global_name, tokenize = 'trigram'
);

CREATE TABLE project_search_tags (
    project_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (project_id, tag),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_project_search_tags_tag_project ON project_search_tags(tag, project_id);

INSERT INTO project_search (
    rowid, name, description, project_type, extension_type, custom_tags,
    facets, tags, author_name, global_name
)
SELECT p.rowid, p.name, p.description, p.project_type, p.extension_type,
       p.custom_tags, p.facets, p.tags, p.author_name, u.global_name
FROM projects p LEFT JOIN users u ON u.id = p.author_id;

INSERT INTO project_search_tags (project_id, tag)
SELECT project_id, value FROM (
    SELECT p.id AS project_id, tree.value AS value
      FROM projects p, json_tree(CASE WHEN json_valid(p.facets) THEN p.facets ELSE '{}' END) tree
      WHERE tree.type = 'text'
    UNION
    SELECT p.id, item.value
      FROM projects p, json_each(CASE WHEN json_valid(p.custom_tags) THEN p.custom_tags ELSE '[]' END) item
      WHERE item.type = 'text'
    UNION
    SELECT p.id, item.value
      FROM projects p, json_each(CASE WHEN json_valid(p.tags) THEN p.tags ELSE '[]' END) item
      WHERE item.type = 'text'
    UNION
    SELECT id, extension_type FROM projects WHERE extension_type IS NOT NULL
) WHERE value <> '';

-- Trigrams cannot find one- or two-character searches. Space each character
-- into a token so FTS phrase matching still narrows short Chinese searches.
CREATE VIEW project_search_short_source AS
SELECT p.rowid AS project_rowid,
       (WITH RECURSIVE chars(text, n) AS (
           SELECT COALESCE(p.name, '') || char(31) || COALESCE(p.description, '') || char(31)
               || COALESCE(p.project_type, '') || char(31) || COALESCE(p.extension_type, '') || char(31)
               || COALESCE(p.custom_tags, '') || char(31) || COALESCE(p.facets, '') || char(31)
               || COALESCE(p.tags, '') || char(31) || COALESCE(p.author_name, '') || char(31)
               || COALESCE(u.global_name, ''), 1
           UNION ALL
           SELECT text, n + 1 FROM chars WHERE n < length(text)
       ) SELECT group_concat(substr(text, n, 1), ' ') FROM chars) AS spaced_text
FROM projects p LEFT JOIN users u ON u.id = p.author_id;

CREATE VIRTUAL TABLE project_search_short USING fts5(spaced_text);
INSERT INTO project_search_short (rowid, spaced_text)
SELECT project_rowid, spaced_text FROM project_search_short_source;

CREATE TRIGGER project_search_insert AFTER INSERT ON projects BEGIN
    INSERT INTO project_search (
        rowid, name, description, project_type, extension_type, custom_tags,
        facets, tags, author_name, global_name
    ) VALUES (
        NEW.rowid, NEW.name, NEW.description, NEW.project_type, NEW.extension_type,
        NEW.custom_tags, NEW.facets, NEW.tags, NEW.author_name,
        (SELECT global_name FROM users WHERE id = NEW.author_id)
    );
    INSERT INTO project_search_tags (project_id, tag)
    SELECT NEW.id, value FROM (
        SELECT value FROM json_tree(CASE WHEN json_valid(NEW.facets) THEN NEW.facets ELSE '{}' END) WHERE type = 'text'
        UNION
        SELECT value FROM json_each(CASE WHEN json_valid(NEW.custom_tags) THEN NEW.custom_tags ELSE '[]' END) WHERE type = 'text'
        UNION
        SELECT value FROM json_each(CASE WHEN json_valid(NEW.tags) THEN NEW.tags ELSE '[]' END) WHERE type = 'text'
        UNION
        SELECT NEW.extension_type WHERE NEW.extension_type IS NOT NULL
    ) WHERE value <> '';
    INSERT INTO project_search_short (rowid, spaced_text)
    SELECT project_rowid, spaced_text FROM project_search_short_source WHERE project_rowid = NEW.rowid;
END;

CREATE TRIGGER project_search_update AFTER UPDATE OF
    name, description, project_type, extension_type, custom_tags, facets,
    tags, author_name, author_id ON projects BEGIN
    DELETE FROM project_search WHERE rowid = OLD.rowid;
    INSERT INTO project_search (
        rowid, name, description, project_type, extension_type, custom_tags,
        facets, tags, author_name, global_name
    ) VALUES (
        NEW.rowid, NEW.name, NEW.description, NEW.project_type, NEW.extension_type,
        NEW.custom_tags, NEW.facets, NEW.tags, NEW.author_name,
        (SELECT global_name FROM users WHERE id = NEW.author_id)
    );
    DELETE FROM project_search_tags WHERE project_id = OLD.id;
    INSERT INTO project_search_tags (project_id, tag)
    SELECT NEW.id, value FROM (
        SELECT value FROM json_tree(CASE WHEN json_valid(NEW.facets) THEN NEW.facets ELSE '{}' END) WHERE type = 'text'
        UNION
        SELECT value FROM json_each(CASE WHEN json_valid(NEW.custom_tags) THEN NEW.custom_tags ELSE '[]' END) WHERE type = 'text'
        UNION
        SELECT value FROM json_each(CASE WHEN json_valid(NEW.tags) THEN NEW.tags ELSE '[]' END) WHERE type = 'text'
        UNION
        SELECT NEW.extension_type WHERE NEW.extension_type IS NOT NULL
    ) WHERE value <> '';
    DELETE FROM project_search_short WHERE rowid = OLD.rowid;
    INSERT INTO project_search_short (rowid, spaced_text)
    SELECT project_rowid, spaced_text FROM project_search_short_source WHERE project_rowid = NEW.rowid;
END;

CREATE TRIGGER project_search_delete AFTER DELETE ON projects BEGIN
    DELETE FROM project_search WHERE rowid = OLD.rowid;
    DELETE FROM project_search_tags WHERE project_id = OLD.id;
    DELETE FROM project_search_short WHERE rowid = OLD.rowid;
END;

CREATE TRIGGER project_search_author_update AFTER UPDATE OF global_name ON users
WHEN OLD.global_name IS NOT NEW.global_name BEGIN
    UPDATE project_search SET global_name = NEW.global_name
    WHERE rowid IN (SELECT rowid FROM projects WHERE author_id = NEW.id);
    DELETE FROM project_search_short
    WHERE rowid IN (SELECT rowid FROM projects WHERE author_id = NEW.id);
    INSERT INTO project_search_short (rowid, spaced_text)
    SELECT project_rowid, spaced_text FROM project_search_short_source
    WHERE project_rowid IN (SELECT rowid FROM projects WHERE author_id = NEW.id);
END;
