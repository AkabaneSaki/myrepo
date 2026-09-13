import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import process from 'node:process';
import { projectDb } from '../src/utils/db.ts';
import { getProjectRankingBucket } from '../src/utils/project-ranking-snapshots.ts';

const PAGE_SIZE = 13;
const LOCAL_PROJECT_COUNT = 120;
const SINGLE_QUERY_STEP_BUDGET = 50_000;
const REQUEST_STEP_BUDGET = 100_000;
const SCALE_MULTIPLIER = 3;
const SCALE_SLACK = 5_000;

class RecordingD1 {
  constructor(db) {
    this.db = db;
    this.calls = [];
  }

  prepare(sql) {
    const owner = this;
    const sqlText = String(sql);

    const makeBound = values => ({
      __sql: sqlText,
      __values: values,
      async all() {
        owner.calls.push({ operation: 'all', sql: sqlText, values });
        return { results: owner.db.prepare(sqlText).all(...values), success: true, meta: {} };
      },
      async first() {
        owner.calls.push({ operation: 'first', sql: sqlText, values });
        return owner.db.prepare(sqlText).get(...values) ?? null;
      },
      async run() {
        owner.calls.push({ operation: 'run', sql: sqlText, values });
        const result = owner.db.prepare(sqlText).run(...values);
        return { success: true, meta: { changes: Number(result.changes ?? 0) } };
      },
    });

    const unbound = makeBound([]);
    return {
      ...unbound,
      bind(...values) {
        return makeBound(values);
      },
    };
  }

  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) {
        if (!statement || typeof statement.__sql !== 'string') {
          throw new Error('Unsupported D1 batch statement in cost-test adapter');
        }
        this.calls.push({ operation: 'run', sql: statement.__sql, values: statement.__values || [] });
        const result = this.db.prepare(statement.__sql).run(...(statement.__values || []));
        results.push({ success: true, meta: { changes: Number(result.changes ?? 0) } });
      }
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function projectId(index) {
  return `p${String(index).padStart(6, '0')}`;
}

async function createScenarioHarness({ withSnapshot = true, profile = 'default' } = {}) {
  const db = new DatabaseSync(':memory:');
  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  db.exec(schema);

  db.prepare(
    `INSERT INTO users (id, username, global_name, avatar, discriminator, guilds)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('author', 'author', 'Author', '', '0', '[]');
  db.prepare(
    `INSERT INTO users (id, username, global_name, avatar, discriminator, guilds)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('viewer', 'viewer', 'Viewer', '', '0', '[]');

  const insertProject = db.prepare(
    `INSERT INTO projects (
      id, name, description, author_id, author_name, status, project_type,
      visibility, is_published, latest_approved_at, downloads_count, likes_count
    ) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, 1, ?, ?, ?)`,
  );

  const ids = [];
  const types = ['角色', '扩展', '系统核心', '事件'];
  for (let index = 1; index <= LOCAL_PROJECT_COUNT; index += 1) {
    const id = projectId(index);
    ids.push(id);
    let projectType = types[(index - 1) % types.length];
    let visibility = 1;
    if (profile === 'rareType') projectType = index <= 2 ? '事件' : '角色';
    if (profile === 'noMatch') projectType = '角色';
    if (profile === 'manyHidden') visibility = index % 10 === 0 ? 1 : 0;
    insertProject.run(
      id,
      `Project ${index}`,
      index % 7 === 0 ? 'battle project' : 'project',
      'author',
      'Author',
      projectType,
      visibility,
      new Date(Date.UTC(2026, 8, 1, 0, index % 60)).toISOString(),
      index * 10,
      index % 17,
    );
  }

  for (const id of ids.slice(0, PAGE_SIZE)) {
    db.prepare('INSERT INTO project_likes (project_id, user_id) VALUES (?, ?)').run(id, 'viewer');
  }

  if (withSnapshot) {
    const bucket = getProjectRankingBucket();
    const payload = JSON.stringify(ids);
    db.prepare(
      'INSERT INTO project_rank_snapshots (kind, bucket, project_ids) VALUES (?, ?, ?)',
    ).run('discover', bucket, payload);
    db.prepare(
      'INSERT INTO project_rank_snapshots (kind, bucket, project_ids) VALUES (?, ?, ?)',
    ).run('rating', bucket, payload);
  }

  const adapter = new RecordingD1(db);
  const context = {
    req: { url: 'https://workshop-test.invalid/' },
    env: { DB: adapter },
  };
  return { db, adapter, context };
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function parseJsonArray(value) {
  if (typeof value !== 'string' || !value.trim().startsWith('[')) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasLargeJsonArrayParameter(call) {
  return call.values.some(value => {
    const parsed = parseJsonArray(value);
    return parsed && parsed.length > PAGE_SIZE + 1;
  });
}

function detectStaticViolations(scenario) {
  const violations = [];
  const hotRanking = scenario.name.startsWith('discover.') || scenario.name.startsWith('rating.');

  if (scenario.calls.length > 8) {
    violations.push(`${scenario.name}: list request executed ${scenario.calls.length} SQL statements (budget: 8)`);
  }

  for (const call of scenario.calls) {
    const sql = normalizeSql(call.sql);
    const upper = sql.toUpperCase();

    if (
      hotRanking &&
      /\bJSON_EACH\s*\(/i.test(sql) &&
      /\bPROJECTS\b/i.test(sql) &&
      hasLargeJsonArrayParameter(call)
    ) {
      violations.push(`${scenario.name}: a large ranking JSON array is expanded with json_each() in a project list request`);
    }

    if (
      hotRanking &&
      /SELECT\s+ID,\s*LIKES_COUNT,\s*DOWNLOADS_COUNT,\s*LATEST_APPROVED_AT\s+FROM\s+PROJECTS/i.test(sql) &&
      !/\bLIMIT\b/i.test(sql)
    ) {
      violations.push(`${scenario.name}: a user list request triggers an unbounded full ranking candidate read`);
    }

    if (
      hotRanking &&
      upper.includes(' LIKE ?') &&
      call.values.some(value => typeof value === 'string' && value.startsWith('%') && value.endsWith('%'))
    ) {
      violations.push(`${scenario.name}: wildcard substring search is mixed into the ranking hot path`);
    }
  }

  return violations;
}

function assertRuleSelfTests() {
  const largeIds = JSON.stringify(Array.from({ length: PAGE_SIZE + 8 }, (_, index) => `p${index + 1}`));
  const badShapes = [
    `WITH ranked AS (SELECT CAST(key AS INTEGER) AS rank_index, value AS project_id FROM json_each(?))
     SELECT p.* FROM ranked r JOIN projects p ON p.id = r.project_id ORDER BY r.rank_index LIMIT ? OFFSET ?`,
    `SELECT p.* FROM projects p JOIN json_each(?) r ON p.id = r.value ORDER BY CAST(r.key AS INTEGER) LIMIT ? OFFSET ?`,
    `SELECT p.* FROM projects p WHERE p.id IN (SELECT value FROM json_each(?)) LIMIT ? OFFSET ?`,
  ];
  for (const sql of badShapes) {
    const bad = {
      name: 'discover.self-test-bad',
      calls: [{ operation: 'all', sql, values: [largeIds, 13, 0] }],
    };
    assert.ok(detectStaticViolations(bad).length > 0, 'cost guard must reject large ranking json_each query shapes');
  }

  const fixedPageJson = {
    name: 'discover.self-test-fixed-page-json',
    calls: [{
      operation: 'all',
      sql: `SELECT p.* FROM projects p JOIN json_each(?) ids ON p.id = ids.value`,
      values: [JSON.stringify(Array.from({ length: PAGE_SIZE }, (_, index) => `p${index + 1}`))],
    }],
  };
  assert.deepEqual(detectStaticViolations(fixedPageJson), [], 'fixed page-size json_each must not be globally banned');

  const good = {
    name: 'discover.self-test-good',
    calls: [{
      operation: 'all',
      sql: `SELECT p.* FROM daily_project_rankings r JOIN projects p ON p.id = r.project_id
            WHERE r.ranking_day = ? AND r.discovery_rank BETWEEN ? AND ? ORDER BY r.discovery_rank`,
      values: ['2026-09-14', 1, 13],
    }],
  };
  assert.deepEqual(detectStaticViolations(good), [], 'bounded indexed-rank query shape should pass static rules');
}

const scenarioDefinitions = [
  { name: 'discover.page1', options: { page: 0, pageSize: PAGE_SIZE, sort: 'discover' } },
  { name: 'discover.deep', options: { page: 50, pageSize: PAGE_SIZE, sort: 'discover' } },
  { name: 'discover.typeRare', profile: 'rareType', options: { page: 0, pageSize: PAGE_SIZE, sort: 'discover', projectType: '事件' } },
  { name: 'discover.noMatch', profile: 'noMatch', options: { page: 0, pageSize: PAGE_SIZE, sort: 'discover', projectType: '事件' } },
  { name: 'discover.manyHidden', profile: 'manyHidden', options: { page: 0, pageSize: PAGE_SIZE, sort: 'discover' } },
  { name: 'discover.search', options: { page: 0, pageSize: PAGE_SIZE, sort: 'discover', search: 'project' } },
  { name: 'discover.userLikes', options: { page: 0, pageSize: PAGE_SIZE, sort: 'discover', currentUser: { userId: 'viewer' } } },
  { name: 'rating.page1', options: { page: 0, pageSize: PAGE_SIZE, sort: 'rating' } },
  { name: 'rating.deep', options: { page: 50, pageSize: PAGE_SIZE, sort: 'rating' } },
  { name: 'rating.typeRare', profile: 'rareType', options: { page: 0, pageSize: PAGE_SIZE, sort: 'rating', projectType: '事件' } },
  { name: 'published.page1', options: { page: 0, pageSize: PAGE_SIZE, sort: 'published' } },
  { name: 'published.deep', options: { page: 50, pageSize: PAGE_SIZE, sort: 'published' } },
  { name: 'published.typeRare', profile: 'rareType', options: { page: 0, pageSize: PAGE_SIZE, sort: 'published', projectType: '事件' } },
  { name: 'published.noMatch', profile: 'noMatch', options: { page: 0, pageSize: PAGE_SIZE, sort: 'published', projectType: '事件' } },
  { name: 'discover.cacheMiss', withSnapshot: false, options: { page: 0, pageSize: PAGE_SIZE, sort: 'discover' } },
];

assertRuleSelfTests();

const scenarios = [];
for (const definition of scenarioDefinitions) {
  const { db, adapter, context } = await createScenarioHarness({
    withSnapshot: definition.withSnapshot !== false,
    profile: definition.profile || 'default',
  });
  try {
    const result = await projectDb.list(context, definition.options);
    assert.ok(Array.isArray(result.projects), `${definition.name}: projectDb.list must return projects`);
    scenarios.push({
      name: definition.name,
      profile: definition.profile || 'default',
      withSnapshot: definition.withSnapshot !== false,
      calls: adapter.calls.map(call => ({ ...call, sql: normalizeSql(call.sql) })),
    });
  } finally {
    db.close();
  }
}

const staticViolations = scenarios.flatMap(detectStaticViolations);

function runPythonScaleCheck(manifest) {
  const candidates = process.platform === 'win32'
    ? [
        { command: 'python', args: [] },
        { command: 'py', args: ['-3'] },
      ]
    : [
        { command: 'python3', args: [] },
        { command: 'python', args: [] },
      ];

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.args, '--version'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) continue;
    const result = spawnSync(
      candidate.command,
      [...candidate.args, fileURLToPath(new URL('./d1-query-cost-runner.py', import.meta.url))],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        input: JSON.stringify(manifest).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`),
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    if (result.error) throw result.error;
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result.status ?? 1;
  }
  throw new Error('Python 3 is required for check:d1-cost but was not found');
}

const manifest = {
  version: 1,
  budgets: {
    singleQuerySteps: SINGLE_QUERY_STEP_BUDGET,
    requestSteps: REQUEST_STEP_BUDGET,
    scaleMultiplier: SCALE_MULTIPLIER,
    scaleSlack: SCALE_SLACK,
  },
  sizes: [100, 1_000, 10_000],
  scenarios,
};

const pythonStatus = runPythonScaleCheck(manifest);

if (staticViolations.length > 0) {
  console.error('\nD1 cost static gate: FAIL');
  for (const violation of staticViolations) console.error(`- ${violation}`);
}

if (pythonStatus !== 0 || staticViolations.length > 0) {
  console.error('\ncheck:d1-cost: FAIL');
  process.exit(1);
}

console.log('\ncheck:d1-cost: PASS');
