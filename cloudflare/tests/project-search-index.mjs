import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0025_project_search_indexes.sql', import.meta.url), 'utf8');
const convergenceMigration = readFileSync(new URL('../migrations/0033_structured_search_indexes.sql', import.meta.url), 'utf8');
const dbSource = readFileSync(new URL('../src/utils/db.ts', import.meta.url), 'utf8');

function insertProject(db, id, name, tags = [], facets = {}, description = '') {
  db.prepare(`INSERT INTO projects
    (id, name, description, author_id, author_name, status, is_published, visibility,
     project_type, facets, custom_tags, tags, latest_approved_at)
    VALUES (?, ?, ?, 'author', '作者', 'approved', 1, 1, '角色', ?, ?, '[]', ?)`)
    .run(
      id,
      name,
      description,
      JSON.stringify(facets),
      JSON.stringify(tags),
      `2026-09-01T00:00:${String(Number(id.slice(1)) % 60).padStart(2, '0')}Z`,
    );
}

function plan(db, sql, ...params) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map(row => row.detail).join('\n');
}

function searchObjectSchema(db) {
  const names = [
    'idx_project_search_tags_tag_project',
    'project_search',
    'project_search_author_update',
    'project_search_delete',
    'project_search_insert',
    'project_search_short',
    'project_search_short_source',
    'project_search_tags',
    'project_search_update',
  ];
  return db.prepare(
    `SELECT type, name, sql FROM sqlite_master
     WHERE name IN (${names.map(() => '?').join(', ')})
     ORDER BY type, name`,
  ).all(...names).map(row => ({
    ...row,
    sql: String(row.sql || '').replace(/\s+/g, ' ').trim(),
  }));
}

function createMigrationBase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, global_name TEXT);
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      author_id TEXT,
      author_name TEXT,
      project_type TEXT,
      extension_type TEXT,
      facets TEXT,
      custom_tags TEXT,
      tags TEXT
    );
  `);
  db.prepare(`INSERT INTO users VALUES ('author', '创作者')`).run();
  db.prepare(`INSERT INTO projects VALUES (
    'old', '旧项目', '秘密描述', 'author', '作者', '角色', NULL,
    '{"身份":["高阶法师"]}', '["魔法"]', '["角色"]'
  )`).run();
  return db;
}

const legacySearchMigration = `
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
INSERT INTO project_search (
  rowid, name, description, project_type, extension_type, custom_tags,
  facets, tags, author_name, global_name
)
SELECT p.rowid, p.name, p.description, p.project_type, p.extension_type,
       p.custom_tags, p.facets, p.tags, p.author_name, u.global_name
FROM projects p LEFT JOIN users u ON u.id = p.author_id;
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
`;

assert.match(dbSource, /project_search_short MATCH/, '1-2 character searches should keep indexed candidate filtering');
assert.doesNotMatch(dbSource, /p\.description LIKE/, 'creator descriptions must never participate in short search');
assert.match(dbSource, /project_search_tags short_tag/, 'short LIKE verification should use normalized tag values');

const db = new DatabaseSync(':memory:');
db.exec(schema);
db.prepare(`INSERT INTO users (id, username, global_name) VALUES ('author', 'author', '创作者')`).run();
insertProject(db, 'p1', '星河魔法学院', ['魔法'], { 身份: ['高阶法师'] }, '中文搜索示例');
insertProject(db, 'p2', '星河冒险学院', ['魔法师'], {}, '另一个作品');
insertProject(db, 'p3', '结构化压力项目', ['压力'], {}, '超长描述'.repeat(5_000));

const searchSql = `SELECT p.id FROM project_search
  CROSS JOIN projects p ON p.rowid = project_search.rowid WHERE project_search MATCH ?`;
const shortSql = `SELECT p.id FROM project_search_short
  CROSS JOIN projects p ON p.rowid = project_search_short.rowid WHERE project_search_short MATCH ?`;
const tagSql = `SELECT p.id FROM project_search_tags tag_candidate
  CROSS JOIN projects p ON p.id = tag_candidate.project_id WHERE tag_candidate.tag = ?`;

const mainColumns = db.prepare('PRAGMA table_info(project_search)').all().map(row => row.name);
assert.deepEqual(mainColumns, ['name', 'project_type', 'extension_type', 'tag_text', 'author_name', 'global_name']);
assert.deepEqual(db.prepare(searchSql).all('"魔法学院"').map(row => row.id), ['p1']);
assert.deepEqual(db.prepare(searchSql).all('"高阶法师"').map(row => row.id), ['p1'], 'normalized tag values should participate in main FTS');
assert.deepEqual(db.prepare(searchSql).all('"文搜索"'), [], 'creator descriptions must not participate in main FTS');
assert.deepEqual(db.prepare(searchSql).all('"超长描述"'), [], 'even very long descriptions must stay out of main FTS');
assert.ok(
  db.prepare(`SELECT length(spaced_text) AS n FROM project_search_short
              WHERE rowid = (SELECT rowid FROM projects WHERE id = 'p3')`).get().n < 500,
  'short FTS size must scale with structured metadata, not long descriptions',
);
assert.deepEqual(db.prepare(shortSql).all('"学 院"').map(row => row.id).sort(), ['p1', 'p2']);
assert.deepEqual(db.prepare(shortSql).all('"超 长"'), [], 'short FTS must not index description-only text');
assert.deepEqual(db.prepare(shortSql).all('"身 份"'), [], 'raw facet keys must not leak into short search');
assert.deepEqual(db.prepare(shortSql).all('"法 师"').map(row => row.id).sort(), ['p1', 'p2']);
assert.deepEqual(db.prepare(tagSql).all('魔法').map(row => row.id), ['p1']);
assert.deepEqual(db.prepare(tagSql).all('高阶法师').map(row => row.id), ['p1']);
assert.match(plan(db, searchSql, '"魔法学院"'), /VIRTUAL TABLE INDEX/);
assert.match(plan(db, shortSql, '"学 院"'), /VIRTUAL TABLE INDEX/);
assert.match(plan(db, tagSql, '魔法'), /idx_project_search_tags_tag_project/);

db.prepare(`UPDATE projects SET name = '月光学院', custom_tags = '["月光"]' WHERE id = 'p1'`).run();
assert.deepEqual(db.prepare(searchSql).all('"魔法学院"'), []);
assert.deepEqual(db.prepare(searchSql).all('"月光学院"').map(row => row.id), ['p1']);
assert.deepEqual(db.prepare(shortSql).all('"月 光"').map(row => row.id), ['p1']);
assert.deepEqual(db.prepare(tagSql).all('魔法'), []);
assert.deepEqual(db.prepare(tagSql).all('月光').map(row => row.id), ['p1']);

db.prepare(`UPDATE users SET global_name = '星河创作者' WHERE id = 'author'`).run();
assert.deepEqual(db.prepare(searchSql).all('"星河创作者"').map(row => row.id).sort(), ['p1', 'p2', 'p3']);
assert.deepEqual(db.prepare(shortSql).all('"创 作"').map(row => row.id).sort(), ['p1', 'p2', 'p3']);

db.prepare(`UPDATE projects SET description = '现在简介里出现超级秘密关键字' WHERE id = 'p2'`).run();
assert.deepEqual(db.prepare(searchSql).all('"超级秘密"'), [], 'description-only updates must never enter main FTS');
assert.deepEqual(db.prepare(shortSql).all('"秘 密"'), [], 'description-only updates must never enter short FTS');

db.prepare(`DELETE FROM projects WHERE id = 'p1'`).run();
assert.deepEqual(db.prepare(tagSql).all('月光'), []);
assert.deepEqual(db.prepare(shortSql).all('"月 光"'), []);

for (const size of [1_000, 10_000]) {
  const sample = new DatabaseSync(':memory:');
  sample.exec(schema);
  sample.prepare(`INSERT INTO users (id, username) VALUES ('author', 'author')`).run();
  sample.exec('BEGIN');
  for (let index = 0; index < size; index++) {
    insertProject(
      sample,
      `p${index}`,
      index % 100 === 0 ? `星河魔法学院 ${index}` : `普通项目 ${index}`,
      index % 100 === 0 ? ['魔法'] : ['日常'],
    );
  }
  sample.exec('COMMIT');
  assert.equal(sample.prepare(searchSql).all('"魔法学院"').length, size / 100);
  assert.equal(sample.prepare(shortSql).all('"魔 法"').length, size / 100);
  assert.equal(sample.prepare(tagSql).all('魔法').length, size / 100);
  assert.match(plan(sample, searchSql, '"魔法学院"'), /VIRTUAL TABLE INDEX/);
  assert.match(plan(sample, shortSql, '"魔 法"'), /VIRTUAL TABLE INDEX/);
  assert.match(plan(sample, tagSql, '魔法'), /idx_project_search_tags_tag_project/);
  sample.close();
}

// Production path: corrected 0025, then 0033.
const productionPath = createMigrationBase();
productionPath.exec(migration);
productionPath.exec(convergenceMigration);

// Staging path: legacy 0025 already applied, then 0033.
const stagingPath = createMigrationBase();
stagingPath.exec(legacySearchMigration);
stagingPath.exec(convergenceMigration);

assert.deepEqual(
  searchObjectSchema(productionPath),
  searchObjectSchema(stagingPath),
  'production and staging migration paths must converge to the same search schema',
);
assert.deepEqual(
  productionPath.prepare(searchSql).all('"旧项目"'),
  stagingPath.prepare(searchSql).all('"旧项目"'),
);
assert.deepEqual(productionPath.prepare(searchSql).all('"秘密描述"'), []);
assert.deepEqual(stagingPath.prepare(searchSql).all('"秘密描述"'), []);
assert.deepEqual(
  productionPath.prepare(shortSql).all('"旧 项"'),
  stagingPath.prepare(shortSql).all('"旧 项"'),
);
assert.deepEqual(productionPath.prepare(shortSql).all('"秘 密"'), []);
assert.deepEqual(stagingPath.prepare(shortSql).all('"秘 密"'), []);

productionPath.close();
stagingPath.close();
db.close();

console.log('project search index: ok');
