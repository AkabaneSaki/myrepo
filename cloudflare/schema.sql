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
    version TEXT DEFAULT '1.0.0',
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_avatar TEXT,
    status TEXT DEFAULT 'pending',
    download_url TEXT,
    file_size INTEGER,
    downloads_count INTEGER DEFAULT 0,
    likes_count INTEGER NOT NULL DEFAULT 0,
    tags TEXT DEFAULT '[]',
    cover_image TEXT,
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
CREATE INDEX IF NOT EXISTS idx_projects_author_status_reviewed
    ON projects(author_id, status, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_guilds ON users(guilds);

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
