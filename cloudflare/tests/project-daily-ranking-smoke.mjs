import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const dailyMigration = await readFile(new URL('../migrations/0011_project_daily_rankings.sql', import.meta.url), 'utf8');
const publishMigration = await readFile(new URL('../migrations/0013_daily_ranking_publish.sql', import.meta.url), 'utf8');

const querySpecs = [
  {
    name: 'discover/all',
    index: 'idx_project_daily_rankings_discover',
    sql: `SELECT p.id, u.global_name
          FROM project_daily_rankings r
          JOIN projects p ON p.id = r.project_id
          LEFT JOIN users u ON p.author_id = u.id
          WHERE r.ranking_day = ?
            AND r.discover_rank BETWEEN ? AND ?
            AND p.status = 'approved' AND p.is_published = 1 AND p.visibility = 1
          ORDER BY r.discover_rank ASC`,
    args: n => ['2026-09-15', 1, Math.min(12, n)],
  },
  {
    name: 'discover/deep-page',
    index: 'idx_project_daily_rankings_discover',
    sql: `SELECT p.id
          FROM project_daily_rankings r
          JOIN projects p ON p.id = r.project_id
          WHERE r.ranking_day = ?
            AND r.discover_rank BETWEEN ? AND ?
            AND p.status = 'approved' AND p.is_published = 1 AND p.visibility = 1
          ORDER BY r.discover_rank ASC`,
    args: n => ['2026-09-15', Math.max(1, n - 11), n],
  },
  {
    name: 'discover/type',
    index: 'idx_project_daily_rankings_discover_type',
    sql: `SELECT p.id
          FROM project_daily_rankings r
          JOIN projects p ON p.id = r.project_id
          WHERE r.ranking_day = ? AND r.project_type = ?
            AND r.discover_type_rank BETWEEN ? AND ?
            AND p.status = 'approved' AND p.is_published = 1 AND p.visibility = 1
          ORDER BY r.discover_type_rank ASC`,
    args: n => ['2026-09-15', '角色', 1, Math.min(12, Math.ceil(n / 2))],
  },
  {
    name: 'rating/all',
    index: 'idx_project_daily_rankings_rating',
    sql: `SELECT p.id
          FROM project_daily_rankings r
          JOIN projects p ON p.id = r.project_id
          WHERE r.ranking_day = ?
            AND r.rating_rank BETWEEN ? AND ?
            AND p.status = 'approved' AND p.is_published = 1 AND p.visibility = 1
          ORDER BY r.rating_rank ASC`,
    args: n => ['2026-09-15', 1, Math.min(12, n)],
  },
  {
    name: 'rating/type',
    index: 'idx_project_daily_rankings_rating_type',
    sql: `SELECT p.id
          FROM project_daily_rankings r
          JOIN projects p ON p.id = r.project_id
          WHERE r.ranking_day = ? AND r.project_type = ?
            AND r.rating_type_rank BETWEEN ? AND ?
            AND p.status = 'approved' AND p.is_published = 1 AND p.visibility = 1
          ORDER BY r.rating_type_rank ASC`,
    args: n => ['2026-09-15', '角色', 1, Math.min(12, Math.ceil(n / 2))],
  },
];

function buildSyntheticDb(count) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL,
      project_type TEXT NOT NULL,
      status TEXT NOT NULL,
      is_published INTEGER NOT NULL,
      visibility INTEGER NOT NULL
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      global_name TEXT
    );
  `);
  db.exec(dailyMigration);
  db.exec(publishMigration);

  const insertProject = db.prepare(
    `INSERT INTO projects (id, author_id, project_type, status, is_published, visibility)
     VALUES (?, ?, ?, 'approved', 1, 1)`,
  );
  const insertRanking = db.prepare(
    `INSERT INTO project_daily_rankings (
       ranking_day, project_id, project_type,
       discover_rank, discover_type_rank, rating_rank, rating_type_rank
     ) VALUES ('2026-09-15', ?, ?, ?, ?, ?, ?)`,
  );
  const typeRanks = new Map();
  db.exec('BEGIN');
  for (let index = 1; index <= count; index += 1) {
    const id = `p${String(index).padStart(5, '0')}`;
    const projectType = index % 2 ? '角色' : '扩展';
    const typeRank = (typeRanks.get(projectType) || 0) + 1;
    typeRanks.set(projectType, typeRank);
    insertProject.run(id, `author-${index % 250}`, projectType);
    insertRanking.run(id, projectType, index, typeRank, index, typeRank);
  }
  db.exec('COMMIT');

  db.prepare(
    `INSERT INTO project_ranking_builds (
       ranking_day, status, project_count, type_counts, started_at, completed_at, build_token
     ) VALUES (?, 'complete', ?, ?, ?, ?, ?)`,
  ).run(
    '2026-09-15',
    count,
    JSON.stringify(Object.fromEntries(typeRanks)),
    '2026-09-15T00:00:00.000Z',
    '2026-09-15T00:00:01.000Z',
    'synthetic-complete',
  );
  return db;
}

for (const count of [100, 1000, 10_000]) {
  const db = buildSyntheticDb(count);
  for (const spec of querySpecs) {
    assert.ok(!/\bOFFSET\b/i.test(spec.sql), `${spec.name}: ranking hot path must not use OFFSET`);
    assert.ok(!/json_each\s*\(/i.test(spec.sql), `${spec.name}: ranking hot path must not expand JSON`);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${spec.sql}`).all(...spec.args(count));
    const detail = plan.map(row => String(row.detail || '')).join(' | ');
    assert.match(detail, new RegExp(`SEARCH r USING INDEX ${spec.index}`), `${count} ${spec.name}: ${detail}`);
    assert.doesNotMatch(detail, /SCAN r(?:\s|$)/, `${count} ${spec.name}: ranking table scan detected: ${detail}`);
    assert.doesNotMatch(detail, /USE TEMP B-TREE FOR ORDER BY/, `${count} ${spec.name}: temp sort detected: ${detail}`);
  }

  if (count === 100) {
    // A project hidden after the immutable daily board was built leaves a rank hole.
    // Page 1 may contain 11 cards, but page 2 stays independently addressable and
    // board metadata still reports 100, so hasMore must not depend on returned rows.
    db.prepare(`UPDATE projects SET visibility = 0 WHERE id = 'p00005'`).run();
    const pageSql = querySpecs[0].sql;
    const page1 = db.prepare(pageSql).all('2026-09-15', 1, 12);
    const page2 = db.prepare(pageSql).all('2026-09-15', 13, 24);
    assert.equal(page1.length, 11);
    assert.equal(page2.length, 12);
    assert.equal(new Set([...page1, ...page2].map(row => row.id)).size, 23, 'rank holes must not create cross-page duplicates');
    const meta = db.prepare(
      `SELECT project_count FROM project_ranking_builds
       WHERE ranking_day = '2026-09-15' AND status = 'complete'`,
    ).get();
    assert.equal(meta.project_count, 100);
  }
  db.close();
}

{
  const db = buildSyntheticDb(100);
  db.prepare(
    `INSERT INTO project_ranking_builds (
       ranking_day, status, project_count, type_counts, started_at, completed_at, build_token
     ) VALUES ('2026-09-16', 'building', 0, '{}', '2026-09-16T00:00:00.000Z', NULL, 'incomplete')`,
  ).run();
  const ready = db.prepare(
    `SELECT ranking_day FROM project_ranking_builds
     WHERE status = 'complete' AND ranking_day >= '2026-09-15' AND ranking_day <= '2026-09-16'
     ORDER BY ranking_day DESC LIMIT 1`,
  ).get();
  assert.equal(ready.ranking_day, '2026-09-15', 'a building day must never replace the previous complete board');

  const expired = db.prepare(
    `SELECT ranking_day FROM project_ranking_builds
     WHERE status = 'complete' AND ranking_day >= '2026-09-16' AND ranking_day <= '2026-09-17'
     ORDER BY ranking_day DESC LIMIT 1`,
  ).get();
  assert.equal(expired, undefined, 'fallback must not serve a complete board older than yesterday');
  db.close();
}

console.log('project daily ranking smoke: ok (100 / 1k / 10k)');
