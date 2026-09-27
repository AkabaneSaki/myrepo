import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migration = readFileSync(new URL('../migrations/0027_public_project_counts.sql', import.meta.url), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, status TEXT, is_published INTEGER, visibility INTEGER, project_type TEXT NOT NULL, updated_at TEXT, likes_count INTEGER DEFAULT 0)');
db.exec("INSERT INTO projects VALUES ('old-public', 'approved', 1, 1, '角色', '1', 0), ('old-hidden', 'approved', 1, 0, '扩展', '1', 0), ('old-draft', 'pending', 0, 1, '事件', '1', 0)");
db.exec(migration);

function counts() {
  return Object.fromEntries(db.prepare('SELECT scope, project_count FROM public_project_counts').all()
    .map(row => [row.scope, row.project_count]));
}
function revision() {
  return db.prepare("SELECT revision FROM public_project_counts WHERE scope = '*'").get().revision;
}

assert.deepEqual(counts(), { '*': 1, 角色: 1 });
db.exec("UPDATE projects SET visibility = 1, updated_at = '2' WHERE id = 'old-hidden'");
assert.deepEqual(counts(), { '*': 2, 角色: 1, 扩展: 1 });
db.exec("UPDATE projects SET project_type = '事件', updated_at = '3' WHERE id = 'old-public'");
assert.deepEqual(counts(), { '*': 2, 角色: 0, 扩展: 1, 事件: 1 });
db.exec("UPDATE projects SET status = 'approved', is_published = 1 WHERE id = 'old-draft'");
assert.deepEqual(counts(), { '*': 3, 角色: 0, 扩展: 1, 事件: 2 });
db.exec("UPDATE projects SET visibility = 0 WHERE id = 'old-public'");
assert.deepEqual(counts(), { '*': 2, 角色: 0, 扩展: 1, 事件: 1 });
db.exec("DELETE FROM projects WHERE id = 'old-hidden'");
assert.deepEqual(counts(), { '*': 1, 角色: 0, 扩展: 0, 事件: 1 });
const beforeLikes = revision();
db.exec("UPDATE projects SET likes_count = 3 WHERE id = 'old-draft'");
assert.equal(revision(), beforeLikes);
db.exec("UPDATE projects SET updated_at = '4' WHERE id = 'old-draft'");
assert.equal(revision(), beforeLikes + 1);
db.exec("INSERT INTO projects VALUES ('null-status', NULL, 1, 1, '角色', '1', 0)");
db.exec("UPDATE projects SET status = 'approved' WHERE id = 'null-status'");
assert.equal(counts()['*'], 2);
db.exec("UPDATE projects SET status = NULL WHERE id = 'null-status'");
assert.equal(counts()['*'], 1);

const fresh = new DatabaseSync(':memory:');
fresh.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
fresh.exec("INSERT INTO users (id, username) VALUES ('author', 'author')");
fresh.exec("INSERT INTO projects (id, name, author_id, author_name, status, is_published, visibility, project_type) VALUES ('fresh', 'Fresh', 'author', 'author', 'approved', 1, 1, '角色')");
assert.equal(fresh.prepare("SELECT project_count FROM public_project_counts WHERE scope = '*'").get().project_count, 1);
console.log('public project counts: ok');
