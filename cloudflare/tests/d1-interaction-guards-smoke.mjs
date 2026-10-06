import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

const [dbSource, socialSource, apiSource, migrationSource, schemaSource] = await Promise.all([
  read('src/utils/db.ts'),
  read('src/endpoints/projects/social.ts'),
  read('src/pages/home/api.ts'),
  read('migrations/0029_d1_interaction_guards.sql'),
  read('schema.sql'),
]);

assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS project_like_daily_usage/);
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS download_daily_usage/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS project_like_daily_usage/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS download_daily_usage/);
assert.match(dbSource, /const MAX_DAILY_COUNTED_DOWNLOADS = 15_000/);
assert.match(socialSource, /LIKE_DAILY_LIMIT/);
assert.match(apiSource, /const pendingLikeProjectIds = new Set\(\)/);
assert.match(apiSource, /pendingLikeProjectIds\.has\(projectId\)/);
assert.match(apiSource, /pendingLikeProjectIds\.delete\(projectId\)/);

const likeSqlMatch = dbSource.match(
  /`(INSERT INTO project_like_daily_usage[\s\S]*?RETURNING toggle_count)`/,
);
assert.ok(likeSqlMatch, 'like daily guard SQL must remain directly testable');

const downloadSqlMatch = dbSource.match(
  /`(INSERT INTO download_daily_usage[\s\S]*?RETURNING counted_downloads)`/,
);
assert.ok(downloadSqlMatch, 'download daily guard SQL must remain directly testable');

const ratingSqlMatch = socialSource.match(
  /`(INSERT INTO project_ratings[\s\S]*?project_ratings\.comment_text IS NOT excluded\.comment_text\))`/,
);
assert.ok(ratingSqlMatch, 'rating no-op guard SQL must remain directly testable');

const db = new DatabaseSync(':memory:');
db.exec(migrationSource);

const likeStmt = db.prepare(likeSqlMatch[1]);
for (let count = 1; count <= 100; count += 1) {
  const row = likeStmt.get('user-1');
  assert.equal(Number(row?.toggle_count), count, `like toggle ${count} should be accepted`);
}
assert.equal(likeStmt.get('user-1'), undefined, '101st like toggle must be rejected without another write');

db.prepare("UPDATE project_like_daily_usage SET day_key = date('now', '-1 day'), toggle_count = 100 WHERE user_id = ?")
  .run('user-1');
assert.equal(Number(likeStmt.get('user-1')?.toggle_count), 1, 'like allowance must reset on the next UTC day');

const downloadStmt = db.prepare(downloadSqlMatch[1]);
db.prepare("INSERT INTO download_daily_usage (counter_id, day_key, counted_downloads) VALUES (1, date('now'), 14999)")
  .run();
assert.equal(Number(downloadStmt.get(15_000)?.counted_downloads), 15_000, '15000th download should still be counted');
assert.equal(downloadStmt.get(15_000), undefined, 'downloads after the daily counter cap must not write');

db.prepare("UPDATE download_daily_usage SET day_key = date('now', '-1 day'), counted_downloads = 15000 WHERE counter_id = 1")
  .run();
assert.equal(Number(downloadStmt.get(15_000)?.counted_downloads), 1, 'download counter must reset on the next UTC day');

db.exec(`
  CREATE TABLE project_ratings (
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rating INTEGER NOT NULL,
    comment_text TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id)
  );
`);
const ratingStmt = db.prepare(ratingSqlMatch[1]);
assert.equal(Number(ratingStmt.run('project-1', 'user-1', 5, null, 0, 0).changes), 1);
assert.equal(Number(ratingStmt.run('project-1', 'user-1', 5, null, 0, 0).changes), 0, 'identical rating save must be a no-op');
assert.equal(Number(ratingStmt.run('project-1', 'user-1', 4, null, 0, 0).changes), 1, 'changed rating must write');
assert.equal(Number(ratingStmt.run('project-1', 'user-1', 4, 'hello', 1, 1).changes), 1, 'changed comment must write');
assert.equal(Number(ratingStmt.run('project-1', 'user-1', 4, 'hello', 1, 1).changes), 0, 'identical rating/comment save must be a no-op');

db.close();

console.log('D1 interaction guards smoke: ok');
