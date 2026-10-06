-- Keep every structured field searchable, including tags beyond 1000 characters.
-- Descriptions remain excluded; existing triggers read this view on each update.
DROP VIEW project_search_short_source;
CREATE VIEW project_search_short_source AS
SELECT p.rowid AS project_rowid,
       (WITH RECURSIVE chars(text, n) AS (
           SELECT COALESCE(p.name, '') || char(31)
               || COALESCE(p.project_type, '') || char(31)
               || COALESCE(p.extension_type, '') || char(31)
               || COALESCE(p.author_name, '') || char(31)
               || COALESCE(u.global_name, '') || char(31)
               || COALESCE((SELECT group_concat(tag, char(31))
                              FROM project_search_tags t
                              WHERE t.project_id = p.id), ''), 1
           UNION ALL
           SELECT text, n + 1 FROM chars WHERE n < length(text)
       ) SELECT group_concat(substr(text, n, 1), ' ') FROM chars) AS spaced_text
FROM projects p LEFT JOIN users u ON u.id = p.author_id;

DELETE FROM project_search_short;
INSERT INTO project_search_short (rowid, spaced_text)
SELECT project_rowid, spaced_text FROM project_search_short_source;
