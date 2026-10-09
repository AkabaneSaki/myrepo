import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { transform } from 'esbuild';

const tsSource = await readFile(new URL('../src/utils/project-period-popularity.ts', import.meta.url), 'utf8');
const transformed = await transform(tsSource, { loader: 'ts', format: 'esm' });
const mod = await import('data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64'));
const migration = await readFile(new URL('../migrations/0035_project_period_popularity.sql', import.meta.url), 'utf8');
const trackingMigration = await readFile(new URL('../migrations/0036_project_period_tracking_meta.sql', import.meta.url), 'utf8');
const DAY_MS = 86_400_000;
const startedAt = '2026-10-09T12:30:00Z';
assert.deepEqual(mod.getPeriodPopularityReadiness(null), { days7: false, days30: false });
assert.deepEqual(mod.getPeriodPopularityReadiness(startedAt, Date.parse(startedAt) + 7 * DAY_MS - 1), { days7: false, days30: false });
assert.deepEqual(mod.getPeriodPopularityReadiness(startedAt, Date.parse(startedAt) + 7 * DAY_MS), { days7: true, days30: false });
assert.deepEqual(mod.getPeriodPopularityReadiness(startedAt, Date.parse(startedAt) + 30 * DAY_MS - 1), { days7: true, days30: false });
assert.deepEqual(mod.getPeriodPopularityReadiness(startedAt, Date.parse(startedAt) + 30 * DAY_MS), { days7: true, days30: true });
assert.deepEqual(mod.getPeriodPopularityReadiness('not-a-time', Date.parse(startedAt) + 30 * DAY_MS), { days7: false, days30: false });
const db = new DatabaseSync(':memory:');
db.exec("PRAGMA foreign_keys=ON; CREATE TABLE projects(id TEXT PRIMARY KEY, status TEXT, is_published INTEGER, visibility INTEGER); CREATE TABLE project_likes(project_id TEXT, user_id TEXT, created_at TEXT, PRIMARY KEY(project_id, user_id), FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);");
db.exec(migration);
db.exec(trackingMigration);
const trackedTime = db.prepare('SELECT started_at FROM project_period_tracking_meta WHERE id = 1').get().started_at;
assert.equal(typeof trackedTime, 'string');
assert.deepEqual(mod.getPeriodPopularityReadiness(trackedTime, Date.parse(trackedTime) + 30 * DAY_MS), { days7: true, days30: true });
db.exec(trackingMigration);
assert.equal(db.prepare('SELECT started_at FROM project_period_tracking_meta WHERE id = 1').get().started_at, trackedTime);
const counts = db.prepare('SELECT (SELECT started_at FROM project_period_tracking_meta WHERE id = 1) AS period_started_at').get();
assert.equal(counts.period_started_at, trackedTime);
const project = db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)');
for (const id of ['a','b','c','d','e']) project.run(id, 'approved', 1, 1);
// Duplicate insert and repeated delete must not inflate the daily like delta.
db.prepare("INSERT INTO project_likes (project_id,user_id,created_at) VALUES ('e','u','2026-10-09 08:00:00')").run();
db.prepare("INSERT OR IGNORE INTO project_likes (project_id,user_id,created_at) VALUES ('e','u','2026-10-09 08:00:00')").run();
assert.equal(db.prepare("SELECT likes_delta FROM project_metric_daily WHERE project_id='e'").get().likes_delta, 1);
db.prepare("DELETE FROM project_likes WHERE project_id='e' AND user_id='u'").run();
db.prepare("DELETE FROM project_likes WHERE project_id='e' AND user_id='u'").run();
assert.equal(db.prepare("SELECT likes_delta FROM project_metric_daily WHERE project_id='e'").get().likes_delta, 0);
db.prepare("INSERT INTO project_likes (project_id,user_id,created_at) VALUES ('e','u','2026-10-09 08:00:00')").run();
db.prepare("DELETE FROM projects WHERE id='e'").run();
assert.equal(db.prepare("SELECT COUNT(*) n FROM project_metric_daily WHERE project_id='e'").get().n, 0);
const now = Date.parse('2026-10-09T12:00:00Z');
const day = n => new Date(now - 86400000*n).toISOString().slice(0,10);
const insert = db.prepare('INSERT INTO project_metric_daily VALUES (?, ?, ?, ?)');
insert.run(day(0),'a',3,3);
insert.run(day(7),'a',20,1);
insert.run(day(1),'b',5,5);
insert.run(day(29),'c',9,9);
insert.run(day(30),'d',100,100);
insert.run(day(0),'d',0,-3);
const mockDb = {
  prepare(sql) {
    return { bind(...args) { return {
      all() { return Promise.resolve({results: db.prepare(sql).all(...args)}); },
      first() { return Promise.resolve(db.prepare(sql).get(...args)); },
      run() { return db.prepare(sql).run(...args); }
    }; } };
  },
  async batch(statements) {
    db.exec('BEGIN');
    try { for (const stmt of statements) stmt.run(); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
};
const env = {DB: mockDb};
await mod.generatePeriodPopularitySnapshots({env},now);
assert.deepEqual(await mod.getPeriodPopularityIds({env},'downloads_7d'),['b','a']);
assert.deepEqual(await mod.getPeriodPopularityIds({env},'likes_7d'),['b','a']);
assert.deepEqual(await mod.getPeriodPopularityIds({env},'downloads_30d'),['a','c','b']);
assert.deepEqual(await mod.getPeriodPopularityIds({env},'likes_30d'),['c','b','a']);
const pageQuery = db.prepare("SELECT p.id FROM project_period_popularity period_snapshot " +
  "CROSS JOIN json_each(period_snapshot.project_ids) period_rank CROSS JOIN projects p " +
  "WHERE period_snapshot.sort_mode = ? AND p.id = period_rank.value " +
  "AND p.status = 'approved' AND p.is_published = 1 AND p.visibility = 1 " +
  "ORDER BY CAST(period_rank.key AS INTEGER) ASC LIMIT ? OFFSET ?");
assert.deepEqual(pageQuery.all('downloads_30d', 2, 1).map(row => row.id), ['c', 'b']);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_metric_daily WHERE day_key < ?').get(day(29)).n,0);
assert.match(tsSource,/FROM project_metric_daily m JOIN projects p/);
const dbSource = await readFile(new URL('../src/utils/db.ts', import.meta.url), 'utf8');
assert.match(dbSource,/if \(isPeriodPopularitySort\(sortMode\)\)/);
assert.match(dbSource,/CROSS JOIN json_each\(period_snapshot\.project_ids\) period_rank/);
assert.match(dbSource,/INSERT INTO project_metric_daily \(day_key, project_id, downloads\)/);
assert.match(migration,/CREATE TRIGGER IF NOT EXISTS trg_project_metric_daily_like_insert/);
assert.match(migration,/CREATE TRIGGER IF NOT EXISTS trg_project_metric_daily_like_delete/);
db.close();
console.log('7/30-day popularity ranking and migration smoke: ok');
