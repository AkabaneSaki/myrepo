import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import process from 'node:process';
import { projectDb } from '../src/utils/db.ts';
import { generateProjectRankingDay } from '../src/utils/project-daily-rankings.ts';
import { getProjectRankingDay } from '../src/utils/project-ranking-snapshots.ts';

const PAGE_SIZE = 13;
const LOCAL_PROJECT_COUNT = 120;
const SINGLE_QUERY_STEP_BUDGET = 50_000;
const REQUEST_STEP_BUDGET = 100_000;
const GENERATION_QUERY_STEP_BUDGET = 1_000_000;
const GENERATION_REQUEST_STEP_BUDGET = 1_500_000;
const GENERATION_WRITE_BUDGET = 25_000;
const SCALE_MULTIPLIER = 3;
const SCALE_SLACK = 5_000;
const GENERATION_SCALE_MULTIPLIER = 12;
const RANKING_DAY = getProjectRankingDay();
const EXPIRED_RANKING_DAY = getProjectRankingDay(Date.parse(`${RANKING_DAY}T00:00:00.000Z`) - 8 * 86_400_000);

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

function seedDailyRankingBoard(db, projects, rankingDay = RANKING_DAY) {
  const ranked = projects.filter(project => project.visibility === 1);
  const discoverTypeCounter = new Map();
  const ratingTypeCounter = new Map();
  let ratingRank = 0;
  const rows = [];

  for (let index = 0; index < ranked.length; index += 1) {
    const project = ranked[index];
    const discoverTypeRank = (discoverTypeCounter.get(project.projectType) || 0) + 1;
    discoverTypeCounter.set(project.projectType, discoverTypeRank);

    let projectRatingRank = null;
    let ratingTypeRank = null;
    if (project.downloadsCount >= 100) {
      ratingRank += 1;
      projectRatingRank = ratingRank;
      ratingTypeRank = (ratingTypeCounter.get(project.projectType) || 0) + 1;
      ratingTypeCounter.set(project.projectType, ratingTypeRank);
    }

    rows.push([
      rankingDay,
      project.id,
      project.projectType,
      index + 1,
      discoverTypeRank,
      projectRatingRank,
      ratingTypeRank,
    ]);
  }

  db.prepare(
    'INSERT INTO project_ranking_days (ranking_day, generated_at, project_count) VALUES (?, ?, ?)',
  ).run(rankingDay, `${rankingDay}T00:00:00.000Z`, rows.length);
  const insertRank = db.prepare(
    `INSERT INTO project_daily_rankings (
       ranking_day, project_id, project_type, discover_rank, discover_type_rank, rating_rank, rating_type_rank
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) insertRank.run(...row);
}

async function createScenarioHarness({
  withRankingDay = true,
  withExpiredRankingDay = false,
  hideAfterRanking = false,
  profile = 'default',
} = {}) {
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
  const projects = [];
  const types = ['角色', '扩展', '系统核心', '事件'];
  for (let index = 1; index <= LOCAL_PROJECT_COUNT; index += 1) {
    const id = projectId(index);
    ids.push(id);
    let projectType = types[(index - 1) % types.length];
    let visibility = 1;
    if (profile === 'rareType') projectType = index <= 2 ? '事件' : '角色';
    if (profile === 'noMatch') projectType = '角色';
    if (profile === 'manyHidden') visibility = index % 10 === 0 ? 1 : 0;
    const downloadsCount = index * 10;
    projects.push({ id, projectType, visibility, downloadsCount });
    insertProject.run(
      id,
      `Project ${index}`,
      index % 7 === 0 ? 'battle project' : 'project',
      'author',
      'Author',
      projectType,
      visibility,
      new Date(Date.UTC(2026, 8, 1, 0, index % 60)).toISOString(),
      downloadsCount,
      index % 17,
    );
  }

  for (const id of ids.slice(0, PAGE_SIZE)) {
    db.prepare('INSERT INTO project_likes (project_id, user_id) VALUES (?, ?)').run(id, 'viewer');
  }

  if (withRankingDay) seedDailyRankingBoard(db, projects);
  if (withExpiredRankingDay) seedDailyRankingBoard(db, projects, EXPIRED_RANKING_DAY);
  if (hideAfterRanking) {
    db.prepare('UPDATE projects SET visibility = 0 WHERE id IN (?, ?)')
      .run(projectId(2), projectId(3));
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
  const hotRanking = scenario.costClass === 'hot-ranking';

  if (scenario.costClass !== 'generation' && scenario.calls.length > 8) {
    violations.push(`${scenario.name}: list request executed ${scenario.calls.length} SQL statements (budget: 8)`);
  }

  let touchesDailyRanking = false;
  for (const call of scenario.calls) {
    const sql = normalizeSql(call.sql);
    const upper = sql.toUpperCase();
    if (/\bPROJECT_DAILY_RANKINGS\b/i.test(sql)) touchesDailyRanking = true;

    if (
      hotRanking &&
      /\bJSON_EACH\s*\(/i.test(sql) &&
      /\bPROJECTS\b/i.test(sql) &&
      hasLargeJsonArrayParameter(call)
    ) {
      violations.push(`${scenario.name}: a large ranking JSON array is expanded with json_each() in a project list request`);
    }

    if (hotRanking && /\bOFFSET\b/i.test(sql)) {
      violations.push(`${scenario.name}: ranking hot path uses OFFSET instead of a bounded rank range`);
    }

    if (
      scenario.costClass === 'fallback' &&
      (/INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+PROJECT_DAILY_RANKINGS/i.test(sql) ||
        (/SELECT\s+ID,\s*PROJECT_TYPE,\s*LIKES_COUNT,\s*DOWNLOADS_COUNT,\s*LATEST_APPROVED_AT\s+FROM\s+PROJECTS/i.test(sql) && !/\bLIMIT\b/i.test(sql)))
    ) {
      violations.push(`${scenario.name}: browse fallback attempted to generate a ranking board`);
    }

    if (
      hotRanking &&
      /SELECT\s+ID,\s*(?:PROJECT_TYPE,\s*)?LIKES_COUNT,\s*DOWNLOADS_COUNT,\s*LATEST_APPROVED_AT\s+FROM\s+PROJECTS/i.test(sql) &&
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

  if (hotRanking && !touchesDailyRanking) {
    violations.push(`${scenario.name}: ranking request did not use project_daily_rankings`);
  }
  if (scenario.costClass === 'search' && touchesDailyRanking) {
    violations.push(`${scenario.name}: search/tag request must bypass project_daily_rankings`);
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
      costClass: 'hot-ranking',
      calls: [{ operation: 'all', sql, values: [largeIds, 13, 0] }],
    };
    assert.ok(detectStaticViolations(bad).length > 0, 'cost guard must reject large ranking json_each query shapes');
  }

  const fixedPageJson = {
    name: 'discover.self-test-fixed-page-json',
    costClass: 'hot-ranking',
    calls: [{
      operation: 'all',
      sql: `SELECT p.* FROM project_daily_rankings r JOIN projects p ON p.id = r.project_id
            WHERE r.ranking_day = ? AND r.discover_rank BETWEEN ? AND ? ORDER BY r.discover_rank`,
      values: ['2026-09-14', 1, 13],
    }],
  };
  assert.deepEqual(detectStaticViolations(fixedPageJson), [], 'bounded indexed-rank query shape should pass static rules');
}

const scenarioDefinitions = [
  { name: 'discover.page1', costClass: 'hot-ranking', options: { page: 0, pageSize: PAGE_SIZE, sort: 'discover' } },
  { name: 'discover.deep', costClass: 'hot-ranking', options: { page: 50, pageSize: PAGE_SIZE, sort: 'discover' } },
  { name: 'discover.typeRare', costClass: 'hot-ranking', profile: 'rareType', options: { page: 0, pageSize: PAGE_SIZE, sort: 'discover', projectType: '事件' } },
  { name: 'discover.noMatch', costClass: 'hot-ranking', profile: 'noMatch', options: { page: 0, pageSize: PAGE_SIZE, sort: 'discover', projectType: '事件' } },
  { name: 'discover.manyHidden', costClass: 'hot-ranking', profile: 'manyHidden', options: { page: 0, pageSize: PAGE_SIZE, sort: 'discover' } },
  { name: 'discover.liveHidden', costClass: 'hot-ranking', hideAfterRanking: true, expectHasMore: true, expectProjectCount: 12, options: { page: 0, pageSize: PAGE_SIZE, sort: 'discover' } },
  { name: 'search.page1', costClass: 'search', options: { page: 0, pageSize: PAGE_SIZE, sort: 'discover', search: 'project' } },
  { name: 'discover.userLikes', costClass: 'hot-ranking', options: { page: 0, pageSize: PAGE_SIZE, sort: 'discover', currentUser: { userId: 'viewer' } } },
  { name: 'rating.page1', costClass: 'hot-ranking', options: { page: 0, pageSize: PAGE_SIZE, sort: 'rating' } },
  { name: 'rating.deep', costClass: 'hot-ranking', options: { page: 50, pageSize: PAGE_SIZE, sort: 'rating' } },
  { name: 'rating.typeRare', costClass: 'hot-ranking', profile: 'rareType', options: { page: 0, pageSize: PAGE_SIZE, sort: 'rating', projectType: '事件' } },
  { name: 'published.page1', costClass: 'ordinary', options: { page: 0, pageSize: PAGE_SIZE, sort: 'published' } },
  { name: 'published.deep', costClass: 'ordinary', options: { page: 50, pageSize: PAGE_SIZE, sort: 'published' } },
  { name: 'published.typeRare', costClass: 'ordinary', profile: 'rareType', options: { page: 0, pageSize: PAGE_SIZE, sort: 'published', projectType: '事件' } },
  { name: 'published.noMatch', costClass: 'ordinary', profile: 'noMatch', options: { page: 0, pageSize: PAGE_SIZE, sort: 'published', projectType: '事件' } },
  { name: 'discover.noBoardFallback', costClass: 'fallback', withRankingDay: false, options: { page: 0, pageSize: PAGE_SIZE, sort: 'discover' } },
  { name: 'discover.dailyGeneration', costClass: 'generation', action: 'generate', withRankingDay: false, withExpiredRankingDay: true },
];

assertRuleSelfTests();

const scenarios = [];
for (const definition of scenarioDefinitions) {
  const { db, adapter, context } = await createScenarioHarness({
    withRankingDay: definition.withRankingDay !== false,
    withExpiredRankingDay: definition.withExpiredRankingDay === true,
    hideAfterRanking: definition.hideAfterRanking === true,
    profile: definition.profile || 'default',
  });
  try {
    if (definition.action === 'generate') {
      await generateProjectRankingDay(context);
    } else {
      const result = await projectDb.list(context, definition.options);
      assert.ok(Array.isArray(result.projects), `${definition.name}: projectDb.list must return projects`);
      if (definition.expectHasMore !== undefined) {
        assert.equal(result.hasMore, definition.expectHasMore, `${definition.name}: unexpected hasMore`);
      }
      if (definition.expectProjectCount !== undefined) {
        assert.equal(result.projects.length, definition.expectProjectCount, `${definition.name}: unexpected page size`);
      }
    }
    scenarios.push({
      name: definition.name,
      costClass: definition.costClass,
      profile: definition.profile || 'default',
      withRankingDay: definition.withRankingDay !== false,
      rankingDay: RANKING_DAY,
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
  version: 2,
  budgets: {
    singleQuerySteps: SINGLE_QUERY_STEP_BUDGET,
    requestSteps: REQUEST_STEP_BUDGET,
    generationQuerySteps: GENERATION_QUERY_STEP_BUDGET,
    generationRequestSteps: GENERATION_REQUEST_STEP_BUDGET,
    generationWriteRows: GENERATION_WRITE_BUDGET,
    scaleMultiplier: SCALE_MULTIPLIER,
    scaleSlack: SCALE_SLACK,
    generationScaleMultiplier: GENERATION_SCALE_MULTIPLIER,
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
