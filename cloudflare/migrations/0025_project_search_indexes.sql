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
