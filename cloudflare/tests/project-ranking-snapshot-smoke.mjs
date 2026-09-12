import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  getProjectRankingBucket,
  getProjectRankingRetentionCutoffBucket,
  invalidateCurrentDiscoveryRankingSnapshot,
  pruneOldProjectRankingSnapshots,
} from '../src/utils/project-ranking-snapshots.ts';

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    project_type TEXT NOT NULL,
    status TEXT NOT NULL,
    is_published INTEGER NOT NULL,
    visibility INTEGER NOT NULL
  );
`);

const migration = await readFile(new URL('../migrations/0010_project_rank_snapshots.sql', import.meta.url), 'utf8');
db.exec(migration);

const snapshotColumns = db.prepare("PRAGMA table_info('project_rank_snapshots')").all();
for (const name of ['kind', 'bucket', 'project_ids', 'generated_at']) {
  assert.equal(snapshotColumns.some(column => column.name === name), true, `missing snapshot column ${name}`);
}

const insertProject = db.prepare(
  'INSERT INTO projects (id, project_type, status, is_published, visibility) VALUES (?, ?, ?, 1, 1)',
);
insertProject.run('p1', '角色', 'approved');
insertProject.run('p2', '扩展', 'approved');
insertProject.run('p3', '角色', 'approved');

const orderedIds = JSON.stringify(['p2', 'p3', 'p1']);
db.prepare('INSERT INTO project_rank_snapshots (kind, bucket, project_ids) VALUES (?, ?, ?)')
  .run('discover', 123, orderedIds);

db.prepare('INSERT OR IGNORE INTO project_rank_snapshots (kind, bucket, project_ids) VALUES (?, ?, ?)')
  .run('discover', 123, JSON.stringify(['p1']));
assert.equal(
  db.prepare("SELECT project_ids FROM project_rank_snapshots WHERE kind = 'discover' AND bucket = 123").get().project_ids,
  orderedIds,
  'first snapshot writer must win the bucket race',
);

const filtered = db.prepare(`
  WITH ranked AS (
    SELECT CAST(key AS INTEGER) AS rank_index, value AS project_id
    FROM json_each(?)
  )
  SELECT p.id
  FROM ranked r
  JOIN projects p ON p.id = r.project_id
  WHERE p.status = 'approved' AND p.is_published = 1 AND p.visibility = 1 AND p.project_type = ?
  ORDER BY r.rank_index ASC
`).all(orderedIds, '角色');

assert.deepEqual(filtered.map(row => row.id), ['p3', 'p1'], 'filters must preserve snapshot ranking order');

{
  const calls = [];
  const fakeContext = {
    env: {
      DB: {
        prepare(sql) {
          return {
            bind(...values) {
              return {
                async run() {
                  calls.push({ sql, values });
                  return {};
                },
              };
            },
          };
        },
      },
    },
  };
  const nowMs = Date.parse('2026-09-13T00:00:00Z');
  const bucket = getProjectRankingBucket(nowMs);
  await invalidateCurrentDiscoveryRankingSnapshot(fakeContext, nowMs);
  await pruneOldProjectRankingSnapshots(fakeContext, bucket);

  assert.match(calls[0].sql, /DELETE FROM project_rank_snapshots/);
  assert.match(calls[0].sql, /kind = 'discover'/);
  assert.deepEqual(calls[0].values, [bucket]);
  assert.match(calls[1].sql, /DELETE FROM project_rank_snapshots/);
  assert.match(calls[1].sql, /bucket < \?/);
  assert.deepEqual(calls[1].values, [getProjectRankingRetentionCutoffBucket(bucket)]);
}

console.log('project ranking snapshot smoke: ok');
