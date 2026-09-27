import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0025_project_search_indexes.sql', import.meta.url), 'utf8');

function insertProject(db, id, name, tags = [], facets = {}, description = '') {
  db.prepare(`INSERT INTO projects
    (id, name, description, author_id, author_name, status, is_published, visibility,
     project_type, facets, custom_tags, tags, latest_approved_at)
    VALUES (?, ?, ?, 'author', '作者', 'approved', 1, 1, '角色', ?, ?, '[]', ?)`)
    .run(id, name, description, JSON.stringify(facets), JSON.stringify(tags), `2026-09-01T00:00:${String(Number(id.slice(1)) % 60).padStart(2, '0')}Z`);
}

function plan(db, sql, ...params) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map(row => row.detail).join('\n');
}

const db = new DatabaseSync(':memory:');
db.exec(schema);
db.prepare(`INSERT INTO users (id, username, global_name) VALUES ('author', 'author', '创作者')`).run();
insertProject(db, 'p1', '星河魔法学院', ['魔法'], { 身份: ['法师'] }, '中文搜索示例');
insertProject(db, 'p2', '星河冒险学院', ['魔法师'], {}, '另一个作品');

const searchSql = `SELECT p.id FROM project_search
  CROSS JOIN projects p ON p.rowid = project_search.rowid WHERE project_search MATCH ?`;
const shortSql = `SELECT p.id FROM project_search_short
  CROSS JOIN projects p ON p.rowid = project_search_short.rowid WHERE project_search_short MATCH ?`;
const tagSql = `SELECT p.id FROM project_search_tags tag_candidate
  CROSS JOIN projects p ON p.id = tag_candidate.project_id WHERE tag_candidate.tag = ?`;
assert.deepEqual(db.prepare(searchSql).all('"魔法学院"').map(row => row.id), ['p1']);
assert.deepEqual(db.prepare(searchSql).all('"文搜索"').map(row => row.id), ['p1']);
assert.deepEqual(db.prepare(shortSql).all('"学 院"').map(row => row.id).sort(), ['p1', 'p2']);
assert.deepEqual(db.prepare(tagSql).all('魔法').map(row => row.id), ['p1']);
assert.deepEqual(db.prepare(tagSql).all('法师').map(row => row.id), ['p1']);
assert.deepEqual(db.prepare(tagSql).all('魔法师').map(row => row.id), ['p2']);
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
assert.deepEqual(db.prepare(searchSql).all('"星河创作者"').map(row => row.id).sort(), ['p1', 'p2']);
assert.deepEqual(db.prepare(shortSql).all('"创 作"').map(row => row.id).sort(), ['p1', 'p2']);
db.prepare(`DELETE FROM projects WHERE id = 'p1'`).run();
assert.deepEqual(db.prepare(tagSql).all('月光'), []);
assert.deepEqual(db.prepare(shortSql).all('"月 光"'), []);

for (const size of [1_000, 10_000]) {
  const sample = new DatabaseSync(':memory:');
  sample.exec(schema);
  sample.prepare(`INSERT INTO users (id, username) VALUES ('author', 'author')`).run();
  sample.exec('BEGIN');
  for (let index = 0; index < size; index++) {
    insertProject(sample, `p${index}`, index % 100 === 0 ? `星河魔法学院 ${index}` : `普通项目 ${index}`,
      index % 100 === 0 ? ['魔法'] : ['日常']);
  }
  sample.exec('COMMIT');
  assert.equal(sample.prepare(searchSql).all('"魔法学院"').length, size / 100);
  assert.equal(sample.prepare(shortSql).all('"魔 法"').length, size / 100);
  assert.equal(sample.prepare(tagSql).all('魔法').length, size / 100);
  assert.match(plan(sample, searchSql, '"魔法学院"'), /VIRTUAL TABLE INDEX/);
  assert.match(plan(sample, shortSql, '"魔 法"'), /VIRTUAL TABLE INDEX/);
  assert.match(plan(sample, tagSql, '魔法'), /idx_project_search_tags_tag_project/);
  const searchListSql = `${searchSql} AND p.status = 'approved' AND p.is_published = 1
    AND p.visibility = 1 ORDER BY p.latest_approved_at DESC, p.updated_at DESC LIMIT 21`;
  assert.match(plan(sample, searchListSql, '"魔法学院"'), /VIRTUAL TABLE INDEX/);
  assert.doesNotMatch(plan(sample, searchListSql, '"魔法学院"'), /SCAN p\b/);
  const shortListSql = `${shortSql} AND p.status = 'approved' AND p.is_published = 1
    AND p.visibility = 1 ORDER BY p.latest_approved_at DESC, p.updated_at DESC LIMIT 21`;
  assert.match(plan(sample, shortListSql, '"魔 法"'), /VIRTUAL TABLE INDEX/);
  assert.doesNotMatch(plan(sample, shortListSql, '"魔 法"'), /SCAN p\b/);
  assert.match(plan(sample, `SELECT id FROM projects p WHERE status = 'approved' AND is_published = 1
    AND visibility = 1 ORDER BY latest_approved_at DESC, updated_at DESC LIMIT 20`),
    /idx_projects_public_latest_approved/);
  sample.close();
}

const old = new DatabaseSync(':memory:');
old.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, global_name TEXT);
  CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, description TEXT, author_id TEXT,
    author_name TEXT, project_type TEXT, extension_type TEXT, facets TEXT, custom_tags TEXT, tags TEXT);`);
old.prepare(`INSERT INTO users VALUES ('author', '创作者')`).run();
old.prepare(`INSERT INTO projects VALUES ('old', '旧项目', '', 'author', '作者', '角色', NULL,
  '{"身份":["法师"]}', '["魔法"]', '["角色"]')`).run();
old.exec(migration);
assert.deepEqual(old.prepare(searchSql).all('"旧项目"').map(row => row.id), ['old']);
assert.deepEqual(old.prepare(tagSql).all('法师').map(row => row.id), ['old']);
assert.deepEqual(old.prepare(tagSql).all('魔法').map(row => row.id), ['old']);
old.close();
db.close();
console.log('project search index: ok');
