import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { buildPeriodBoards, isPeriodSortMode, readPeriodBoard } from '../src/utils/project-period-rankings.ts';

const now = Date.parse('2026-10-08T00:05:00.000Z');
const items = [
  { day_key: '2026-10-07', project_id: 'a', downloads_count: 2, likes_added: 3, likes_removed: 0 },
  { day_key: '2026-10-01', project_id: 'a', downloads_count: 1, likes_added: 1, likes_removed: 1 },
  { day_key: '2026-09-30', project_id: 'b', downloads_count: 10, likes_added: 5, likes_removed: 0 },
  { day_key: '2026-09-08', project_id: 'a', downloads_count: 4, likes_added: 3, likes_removed: 0 },
  { day_key: '2026-09-07', project_id: 'b', downloads_count: 100, likes_added: 100, likes_removed: 0 },
  { day_key: '2026-10-08', project_id: 'b', downloads_count: 100, likes_added: 100, likes_removed: 0 },
  { day_key: '2026-10-07', project_id: 'c', downloads_count: 1, likes_added: 0, likes_removed: 4 },
  { day_key: '2026-10-07', project_id: 'hidden', downloads_count: 900, likes_added: 900, likes_removed: 0 },
];
const projects = [
  { id: 'a', project_type: '角色' },
  { id: 'b', project_type: '扩展' },
  { id: 'c', project_type: '角色' },
];
const board = buildPeriodBoards(items, projects, now);
const projectScores = name => board[name].map(entry => [entry.id, entry.score]);
assert.deepEqual(projectScores('downloads7'), [['a', 3], ['c', 1]]);
assert.deepEqual(projectScores('downloads30'), [['b', 10], ['a', 7], ['c', 1]]);
assert.deepEqual(projectScores('likes7'), [['a', 3]]);
assert.deepEqual(projectScores('likes30'), [['a', 6], ['b', 5]]);
assert.equal(board.downloads30.find(x => x.id === 'a')?.type, '角色');
assert.equal(isPeriodSortMode('likes30'), true);
assert.equal(isPeriodSortMode('downloads'), false);
const snapshotContext = snapshot => ({ env: { DB: { prepare: () => ({ first: async () => snapshot }) } } });
assert.deepEqual(await readPeriodBoard(snapshotContext(null), 'downloads7'), [], 'first build may not exist yet');
assert.deepEqual(await readPeriodBoard(snapshotContext({ board_json: JSON.stringify(board) }), 'downloads7'), board.downloads7);
await assert.rejects(readPeriodBoard(snapshotContext({ board_json: '{' }), 'downloads7'), SyntaxError);
for (const invalid of [null, {}, { downloads7: [{ id: 'a', type: '角色', score: -1 }] }]) {
  await assert.rejects(readPeriodBoard(snapshotContext({ board_json: JSON.stringify(invalid) }), 'downloads7'), /Invalid period ranking snapshot/);
}

const migration = await readFile(new URL('../migrations/0036_project_period_rank_snapshots.sql', import.meta.url), 'utf8');
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
const dbSource = await readFile(new URL('../src/utils/db.ts', import.meta.url), 'utf8');
const cronSource = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
assert.match(schema, /CREATE TABLE IF NOT EXISTS project_period_rank_snapshots/);
assert.match(cronSource, /controller\.cron === '5 0 \* \* \*'/);
assert.match(dbSource, /if \(isPeriodSortMode\(sortMode\)\)/);
const db = new DatabaseSync(':memory:');
db.exec(migration);
db.exec(migration);
db.prepare('INSERT INTO project_period_rank_snapshots(period_end_day,board_json,built_at) VALUES (?,?,?)')
  .run('2026-10-07', JSON.stringify(board), '2026-10-08T00:05:00Z');
assert.equal(db.prepare('SELECT board_json FROM project_period_rank_snapshots ORDER BY period_end_day DESC LIMIT 1')
  .get().board_json !== null, true);
const plan = db.prepare('EXPLAIN QUERY PLAN SELECT board_json FROM project_period_rank_snapshots ORDER BY period_end_day DESC LIMIT 1').all();
assert.ok(plan.some(row => /INDEX|SCAN project_period_rank_snapshots/.test(row.detail)), 'snapshot reads only the bounded one-row table');
db.close();
console.log('period ranking: UTC windows, net likes, visibility, sorting, snapshot and cron OK');
