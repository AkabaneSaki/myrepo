import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const migration = await readFile(new URL('../migrations/0035_project_daily_interactions.sql', import.meta.url), 'utf8');
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE projects (id TEXT PRIMARY KEY, downloads_count INTEGER DEFAULT 0, likes_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE project_likes (project_id TEXT NOT NULL, user_id TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id), FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
`);
const originalTriggers = schema.match(/CREATE TRIGGER IF NOT EXISTS trg_project_likes_after_insert[\s\S]*?END;[\s\S]*?CREATE TRIGGER IF NOT EXISTS trg_project_likes_after_delete[\s\S]*?END;/);
assert.ok(originalTriggers, 'existing likes counter triggers must be present');
db.exec(originalTriggers[0]);
db.exec(migration);
db.exec(migration); // safe migration replay

db.prepare('INSERT INTO projects (id) VALUES (?)').run('project-a');
db.prepare('INSERT INTO projects (id) VALUES (?)').run('project-b');
const stats = () => db.prepare('SELECT project_id, downloads_count, likes_added, likes_removed, likes_added - likes_removed AS likes_delta FROM project_daily_interactions ORDER BY project_id').all();

assert.deepEqual(stats(), [], 'a new migration must not invent historical activity');
const changedRows = () => Number(db.prepare('SELECT total_changes() AS n').get().n);
const beforeDownload = changedRows();
db.exec("UPDATE projects SET downloads_count = 1 WHERE id = 'project-a'");
assert.equal(changedRows() - beforeDownload, 2, 'one download costs one project write and one daily rollup write');
db.exec("UPDATE projects SET downloads_count = 2 WHERE id = 'project-a'");
db.exec("UPDATE projects SET downloads_count = 20 WHERE id = 'project-b'");
assert.deepEqual(stats().map(x => [x.project_id, x.downloads_count]), [['project-a', 2]],
  'only exactly one counted download increment is recorded, not admin/backfill counter jumps');

const beforeLike = changedRows();
db.exec("INSERT OR IGNORE INTO project_likes (project_id, user_id) VALUES ('project-a', 'user-1')");
assert.equal(changedRows() - beforeLike, 3, 'a new like costs one like row, cumulative counter, and daily rollup');
const beforeDuplicate = changedRows();
db.exec("INSERT OR IGNORE INTO project_likes (project_id, user_id) VALUES ('project-a', 'user-1')");
assert.equal(changedRows() - beforeDuplicate, 0, 'duplicate like incurs zero row writes');
assert.equal(db.prepare("SELECT likes_count FROM projects WHERE id = 'project-a'").get().likes_count, 1);
db.exec("INSERT OR IGNORE INTO project_likes (project_id, user_id) VALUES ('project-a', 'user-2')");
const beforeUnlike = changedRows();
db.exec("DELETE FROM project_likes WHERE project_id='project-a' AND user_id='user-1'");
assert.equal(changedRows() - beforeUnlike, 3, 'unlike removes one like, decrements cumulative count, and records daily removal');
const beforeMissingUnlike = changedRows();
db.exec("DELETE FROM project_likes WHERE project_id='project-a' AND user_id='user-1'");
assert.equal(changedRows() - beforeMissingUnlike, 0, 'repeat unlike incurs zero row writes');
let row = stats()[0];
assert.deepEqual([row.downloads_count, row.likes_added, row.likes_removed, row.likes_delta], [2, 2, 1, 1]);
assert.equal(db.prepare("SELECT likes_count FROM projects WHERE id = 'project-a'").get().likes_count, 1);

db.exec("DELETE FROM project_likes WHERE project_id='project-a' AND user_id='user-2'");
row = stats()[0];
assert.equal(row.likes_delta, 0, 'removing all likes must zero out the period net');
assert.equal(db.prepare("SELECT likes_count FROM projects WHERE id = 'project-a'").get().likes_count, 0);
db.exec("UPDATE projects SET downloads_count = downloads_count WHERE id = 'project-a'");
assert.equal(stats()[0].downloads_count, 2, 'unrelated project updates must not count a download');

db.exec("DELETE FROM projects WHERE id='project-a'");
assert.deepEqual(stats(), [], 'deleting a project must cascade its aggregated activity');
assert.match(schema, /CREATE TABLE IF NOT EXISTS project_daily_interactions/);
assert.match(schema, /CREATE TRIGGER IF NOT EXISTS trg_project_daily_download_increment/);
assert.match(schema, /CREATE TRIGGER IF NOT EXISTS trg_project_daily_like_added/);
assert.match(schema, /CREATE TRIGGER IF NOT EXISTS trg_project_daily_like_removed/);
db.close();
console.log('per-project daily interactions: counters, dedup, cancel, migration replay, no fake history, cascade OK');
