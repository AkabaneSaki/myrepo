import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  getProjectRankingBucket,
  getProjectRankingDay,
  getProjectRankingRetentionCutoffBucket,
  getProjectRankingRetentionCutoffDay,
  getProjectRankingSnapshotIds,
  invalidateCurrentDiscoveryRankingSnapshot,
  parseProjectRankingSnapshot,
  pruneOldProjectRankingDays,
} from '../src/utils/project-ranking-snapshots.ts';

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    project_type TEXT NOT NULL
  );
`);

const snapshotMigration = await readFile(new URL('../migrations/0010_project_rank_snapshots.sql', import.meta.url), 'utf8');
const dailyMigration = await readFile(new URL('../migrations/0011_project_daily_rankings.sql', import.meta.url), 'utf8');
db.exec(snapshotMigration);
db.exec(dailyMigration);

const snapshotColumns = db.prepare("PRAGMA table_info('project_rank_snapshots')").all();
for (const name of ['kind', 'bucket', 'project_ids', 'generated_at']) {
  assert.equal(snapshotColumns.some(column => column.name === name), true, `missing ranking snapshot column ${name}`);
}

const rankingColumns = db.prepare("PRAGMA table_info('project_daily_rankings')").all();
for (const name of [
  'ranking_day',
  'project_id',
  'project_type',
  'discover_rank',
  'discover_type_rank',
  'rating_rank',
  'rating_type_rank',
]) {
  assert.equal(rankingColumns.some(column => column.name === name), true, `missing daily ranking column ${name}`);
}

const rankingIndexes = new Set(
  db.prepare("PRAGMA index_list('project_daily_rankings')").all().map(row => row.name),
);
for (const name of [
  'idx_project_daily_rankings_discover',
  'idx_project_daily_rankings_discover_type',
  'idx_project_daily_rankings_rating',
  'idx_project_daily_rankings_rating_type',
]) {
  assert.equal(rankingIndexes.has(name), true, `missing daily ranking index ${name}`);
}

assert.equal(getProjectRankingDay(Date.parse('2026-09-14T23:59:59Z')), '2026-09-14');
assert.equal(getProjectRankingRetentionCutoffDay('2026-09-14'), '2026-09-07');
const rankingBucket = getProjectRankingBucket(Date.parse('2026-09-14T12:34:56Z'));
assert.equal(getProjectRankingBucket(Date.parse('2026-09-14T12:59:59Z')), rankingBucket);
assert.equal(getProjectRankingBucket(Date.parse('2026-09-14T13:00:00Z')), rankingBucket + 1);
assert.equal(getProjectRankingRetentionCutoffBucket(rankingBucket), rankingBucket - 7 * 24);

const snapshotPayload = JSON.stringify({
  version: 2,
  all: ['p2', 'p3', 'p1'],
  byType: { 角色: ['p3', 'p1'], 扩展: ['p2'] },
  featured: ['p2', 'p3'],
});
assert.deepEqual(parseProjectRankingSnapshot(snapshotPayload), {
  version: 2,
  all: ['p2', 'p3', 'p1'],
  byType: { 角色: ['p3', 'p1'], 扩展: ['p2'] },
  featured: ['p2', 'p3'],
});
assert.equal(parseProjectRankingSnapshot(JSON.stringify(['p2', 'p3']))?.version, 1);
assert.deepEqual(parseProjectRankingSnapshot(JSON.stringify(['p2', 'p3']))?.all, ['p2', 'p3']);
assert.equal(parseProjectRankingSnapshot('{broken'), null);

const snapshotContext = {
  env: {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return { project_ids: snapshotPayload };
              },
            };
          },
        };
      },
    },
  },
};
assert.deepEqual(await getProjectRankingSnapshotIds(snapshotContext, 'discover', undefined, Date.parse('2026-09-14T12:34:56Z')), ['p2', 'p3', 'p1']);
assert.deepEqual(await getProjectRankingSnapshotIds(snapshotContext, 'discover', '角色', Date.parse('2026-09-14T12:34:56Z')), ['p3', 'p1']);
assert.equal(await getProjectRankingSnapshotIds(snapshotContext, 'discover', '事件', Date.parse('2026-09-14T12:34:56Z')), null);

const insertProject = db.prepare('INSERT INTO projects (id, project_type) VALUES (?, ?)');
insertProject.run('p1', '角色');
insertProject.run('p2', '扩展');
insertProject.run('p3', '角色');
insertProject.run('p4', '角色');

db.prepare('INSERT INTO project_ranking_days (ranking_day, generated_at, project_count) VALUES (?, ?, ?)')
  .run('2026-09-14', '2026-09-14T00:00:00.000Z', 4);
const insertRank = db.prepare(`
  INSERT INTO project_daily_rankings (
    ranking_day, project_id, project_type,
    discover_rank, discover_type_rank, rating_rank, rating_type_rank
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);
insertRank.run('2026-09-14', 'p2', '扩展', 1, 1, 2, 1);
insertRank.run('2026-09-14', 'p3', '角色', 2, 1, 1, 1);
insertRank.run('2026-09-14', 'p1', '角色', 3, 2, 3, 2);
insertRank.run('2026-09-14', 'p4', '角色', 4, 3, null, null);

const globalPage = db.prepare(`
  SELECT project_id
  FROM project_daily_rankings
  WHERE ranking_day = ? AND discover_rank BETWEEN ? AND ?
  ORDER BY discover_rank ASC
`).all('2026-09-14', 1, 3);
assert.deepEqual(globalPage.map(row => row.project_id), ['p2', 'p3', 'p1']);

const typePage = db.prepare(`
  SELECT project_id
  FROM project_daily_rankings
  WHERE ranking_day = ? AND project_type = ? AND discover_type_rank BETWEEN ? AND ?
  ORDER BY discover_type_rank ASC
`).all('2026-09-14', '角色', 1, 2);
assert.deepEqual(typePage.map(row => row.project_id), ['p3', 'p1']);

const ratingPage = db.prepare(`
  SELECT project_id
  FROM project_daily_rankings
  WHERE ranking_day = ? AND rating_rank BETWEEN ? AND ?
  ORDER BY rating_rank ASC
`).all('2026-09-14', 1, 4);
assert.deepEqual(ratingPage.map(row => row.project_id), ['p3', 'p2', 'p1']);

{
  const calls = [];
  const fakeContext = {
    env: {
      DB: {
        prepare(sql) {
          return {
            bind(...values) {
              return { __sql: sql, __values: values };
            },
          };
        },
        async batch(statements) {
          calls.push(...statements);
          return statements.map(() => ({}));
        },
      },
    },
  };

  await invalidateCurrentDiscoveryRankingSnapshot(fakeContext, Date.parse('2026-09-14T12:00:00Z'));
  assert.equal(calls.length, 0, 'published daily board must not be invalidated during the day');

  await pruneOldProjectRankingDays(fakeContext, '2026-09-14');
  assert.equal(calls.length, 2);
  assert.match(calls[0].__sql, /DELETE FROM project_daily_rankings/);
  assert.deepEqual(calls[0].__values, ['2026-09-07']);
  assert.match(calls[1].__sql, /DELETE FROM project_ranking_days/);
  assert.deepEqual(calls[1].__values, ['2026-09-07']);
}

db.close();
console.log('project ranking snapshot smoke: ok');
