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
    FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_author ON projects(author_id);
CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_public_created
    ON projects(status, is_published, visibility, created_at DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_public_updated
    ON projects(status, is_published, visibility, updated_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_public_downloads
    ON projects(status, is_published, visibility, downloads_count DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_public_likes
    ON projects(status, is_published, visibility, likes_count DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_public_latest_approved
    ON projects(status, is_published, visibility, latest_approved_at DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_public_type_published
    ON projects(status, is_published, visibility, project_type, latest_approved_at DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_public_id
    ON projects(id)
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

CREATE TABLE IF NOT EXISTS project_likes (
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
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
