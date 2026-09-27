CREATE TABLE public_project_counts (
    scope TEXT PRIMARY KEY,
    project_count INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0
);

INSERT INTO public_project_counts (scope, project_count, revision)
SELECT '*', COUNT(*), 1
FROM projects
WHERE status = 'approved' AND is_published = 1 AND visibility = 1;

INSERT INTO public_project_counts (scope, project_count)
SELECT project_type, COUNT(*)
FROM projects
WHERE status = 'approved' AND is_published = 1 AND visibility = 1
GROUP BY project_type;

CREATE TRIGGER public_project_count_insert AFTER INSERT ON projects
WHEN NEW.status = 'approved' AND NEW.is_published = 1 AND NEW.visibility = 1
BEGIN
    UPDATE public_project_counts
    SET project_count = project_count + 1, revision = revision + 1
    WHERE scope = '*';
    INSERT INTO public_project_counts (scope, project_count)
    VALUES (NEW.project_type, 1)
    ON CONFLICT(scope) DO UPDATE SET project_count = project_count + 1;
END;

CREATE TRIGGER public_project_count_delete AFTER DELETE ON projects
WHEN OLD.status = 'approved' AND OLD.is_published = 1 AND OLD.visibility = 1
BEGIN
    UPDATE public_project_counts
    SET project_count = project_count - 1, revision = revision + 1
    WHERE scope = '*';
    UPDATE public_project_counts SET project_count = project_count - 1
    WHERE scope = OLD.project_type;
END;

CREATE TRIGGER public_project_count_leave AFTER UPDATE OF status, is_published, visibility, project_type ON projects
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

CREATE TRIGGER public_project_count_enter AFTER UPDATE OF status, is_published, visibility, project_type ON projects
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

CREATE TRIGGER public_project_content_update AFTER UPDATE OF updated_at ON projects
WHEN (OLD.status = 'approved' AND OLD.is_published = 1 AND OLD.visibility = 1)
  OR (NEW.status = 'approved' AND NEW.is_published = 1 AND NEW.visibility = 1)
BEGIN
    UPDATE public_project_counts SET revision = revision + 1 WHERE scope = '*';
END;
