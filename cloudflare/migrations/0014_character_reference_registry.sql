-- Issue A: Workshop-owned character-card reference registry and compatibility metadata.
-- Reference versions/items are immutable historical facts. Projects store only lightweight
-- compatibility pointers/status so browse/install hot paths never need full snapshots.

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

ALTER TABLE projects ADD COLUMN character_reference_id TEXT;
ALTER TABLE projects ADD COLUMN built_for_reference_version_id TEXT;
ALTER TABLE projects ADD COLUMN tested_through_reference_version_id TEXT;
ALTER TABLE projects ADD COLUMN compatibility_status TEXT;
ALTER TABLE projects ADD COLUMN compatibility_known_incompatible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN compatibility_note TEXT;
ALTER TABLE projects ADD COLUMN compatibility_grace_until TEXT;
ALTER TABLE projects ADD COLUMN compatibility_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_character_reference
    ON projects(character_reference_id);
CREATE INDEX IF NOT EXISTS idx_projects_built_for_reference_version
    ON projects(built_for_reference_version_id);
CREATE INDEX IF NOT EXISTS idx_projects_tested_through_reference_version
    ON projects(tested_through_reference_version_id);

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
