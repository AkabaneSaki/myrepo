import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8793;
const DATABASE = 'creative_workshop';
const SNAPSHOT_DATE = '2026-09-15';
const SNAPSHOT_FILE = 'creative_workshop.sql';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const EXPLORER_API = `${ORIGIN}/cdn-cgi/local/explorer/api`;
const DEFAULT_BUDGET = Object.freeze({ maxQueries: 1, maxRowsRead: 600, maxRowsWritten: 0 });
const RANKING_REBUILD_BUDGET = Object.freeze({ maxQueries: 20, maxRowsWritten: 25_000 });
const RANKING_FAST_PATH_BUDGET = Object.freeze({ maxQueries: 1, maxRowsRead: 5, maxRowsWritten: 0 });
const REPAIR_RESOLVE_BUDGET = Object.freeze({ maxQueries: 3, maxRowsRead: 250, maxRowsWritten: 3 });
const CATASTROPHIC_ROWS_READ = 100_000;
const wranglerBin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

const scenarios = [
  { name: '首页 · 发现推荐', params: { page: 0, pageSize: 30, sort: 'discover' }, budget: { maxQueries: 3, maxRowsRead: 200 }, requireDailyRanking: true },
  { name: '分类 · 角色发现', params: { page: 0, pageSize: 12, sort: 'discover', projectType: '角色' }, budget: { maxQueries: 3, maxRowsRead: 200 }, requireDailyRanking: true },
  { name: '深分页 · 发现第 11 页', params: { page: 10, pageSize: 12, sort: 'discover' }, budget: { maxQueries: 3, maxRowsRead: 200 }, requireDailyRanking: true },
  { name: '首页 · 最新发布', params: { page: 0, pageSize: 20, sort: 'published' }, budget: { maxRowsRead: 80 } },
  { name: '首页 · 最近更新', params: { page: 0, pageSize: 20, sort: 'updated' }, budget: { maxRowsRead: 80 } },
  { name: '首页 · 玩家好评', params: { page: 0, pageSize: 12, sort: 'rating' }, budget: { maxQueries: 3, maxRowsRead: 200 }, requireDailyRanking: true },
  { name: '分类 · 角色玩家好评', params: { page: 0, pageSize: 12, sort: 'rating', projectType: '角色' }, budget: { maxQueries: 3, maxRowsRead: 200 }, requireDailyRanking: true },
  { name: '首页 · 下载最多', params: { page: 0, pageSize: 20, sort: 'downloads' }, budget: { maxRowsRead: 80 } },
  { name: '筛选 · 角色', params: { page: 0, pageSize: 20, sort: 'published', projectType: '角色' }, budget: { maxRowsRead: 80 } },
  { name: '标签搜索', params: { page: 0, pageSize: 20, sort: 'published', tag: '角色' }, budget: { maxRowsRead: 120 } },
  { name: '全文搜索', params: { page: 0, pageSize: 20, sort: 'published', search: '系统' }, budget: { maxRowsRead: 400 } },
  { name: '深分页 · 最新第 11 页', params: { page: 10, pageSize: 20, sort: 'published' }, budget: { maxRowsRead: 600 } },
];

function findSnapshot() {
  if (process.env.WORKSHOP_D1_SNAPSHOT_SQL) {
    const explicit = path.resolve(process.env.WORKSHOP_D1_SNAPSHOT_SQL);
    if (!existsSync(explicit)) throw new Error(`WORKSHOP_D1_SNAPSHOT_SQL does not exist: ${explicit}`);
    return explicit;
  }

  let current = path.resolve(process.cwd());
  while (true) {
    const candidate = path.join(current, 'workshop-backups', SNAPSHOT_DATE, SNAPSHOT_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Cannot find workshop-backups/${SNAPSHOT_DATE}/${SNAPSHOT_FILE}. Set WORKSHOP_D1_SNAPSHOT_SQL to override.`);
}

const snapshotSql = findSnapshot();
const persistDir = process.env.WORKSHOP_D1_COST_PERSIST_TO
  ? path.resolve(process.env.WORKSHOP_D1_COST_PERSIST_TO)
  : path.join(path.dirname(snapshotSql), '.d1-cost-state');
const seededMarker = path.join(persistDir, '.seeded-from-production-snapshot.json');

let serverLog = '';
let server = null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function assertPortAvailable() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => {
      reject(new Error(`D1 cost gate port ${PORT} is already in use; refusing to measure a stale Worker. ${error.message}`));
    });
    probe.listen(PORT, '127.0.0.1', () => {
      probe.close(closeError => closeError ? reject(closeError) : resolve());
    });
  });
}

async function stopServerTree() {
  if (!server?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    await sleep(250);
    return;
  }
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => server.once('exit', resolve)),
      sleep(3000),
    ]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
}

function runWrangler(args, label, { inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    let output = '';
    const child = spawn(process.execPath, [wranglerBin, ...args], {
      cwd: process.cwd(),
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    if (!inherit) {
      for (const stream of [child.stdout, child.stderr]) {
        stream?.on('data', chunk => {
          output = (output + chunk.toString()).slice(-20_000);
        });
      }
    }
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve(output);
      else reject(new Error(`${label} failed with exit code ${code}${output ? `\n${output}` : ''}`));
    });
  });
}

async function ensureSnapshotState() {
  mkdirSync(persistDir, { recursive: true });
  if (!existsSync(seededMarker)) {
    console.log(`Preparing shared D1 cost snapshot from ${snapshotSql}`);
    await runWrangler([
      'd1', 'execute', DATABASE, '--local', '--config', 'wrangler.jsonc',
      '--persist-to', persistDir, '--file', snapshotSql,
    ], 'D1 snapshot seed');
    writeFileSync(seededMarker, JSON.stringify({ snapshot: snapshotSql, seededAt: new Date().toISOString() }, null, 2));
  }

  await runWrangler([
    'd1', 'migrations', 'apply', DATABASE, '--local', '--config', 'wrangler.jsonc', '--persist-to', persistDir,
  ], 'D1 local migrations');
}

async function readEligibleProjectCount() {
  const output = await runWrangler([
    'd1', 'execute', DATABASE, '--local', '--config', 'wrangler.jsonc',
    '--persist-to', persistDir,
    '--command', "SELECT COUNT(*) AS project_count FROM projects WHERE status = 'approved' AND is_published = 1 AND visibility = 1",
    '--json',
  ], 'D1 eligible project count');
  const parsed = JSON.parse(output);
  const count = Number(parsed?.[0]?.results?.[0]?.project_count);
  if (!Number.isInteger(count) || count < 0) throw new Error(`Invalid eligible project count: ${output.slice(0, 500)}`);
  return count;
}

function startServer() {
  const args = [
    'dev', '--local', '--config', 'wrangler.jsonc',
    '--persist-to', persistDir,
    '--ip', '127.0.0.1', '--port', String(PORT),
    '--var', 'JWT_SECRET:cw-d1-cost-gate',
  ];
  server = spawn(process.execPath, [wranglerBin, ...args], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream?.on('data', chunk => {
      serverLog = (serverLog + chunk.toString()).slice(-20_000);
    });
  }
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`wrangler dev exited early (${server.exitCode})\n${serverLog}`);
    }
    try {
      const response = await fetch(EXPLORER_API);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for local Wrangler server.\n${serverLog}`);
}

async function explorerPost(apiPath, body) {
  const response = await fetch(`${EXPLORER_API}${apiPath}`, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${apiPath} returned HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function clearObservability() {
  await explorerPost('/local/observability/clear');
}

function rowsToObjects(result) {
  return (result?.rows ?? []).map(row => Object.fromEntries((result.columns ?? []).map((column, index) => [column, row[index]])));
}

async function observabilityQuery(sql, params = []) {
  const response = await explorerPost('/local/observability/query', { sql, params });
  if (!response.success) throw new Error(`Observability query failed: ${JSON.stringify(response.errors ?? [])}`);
  return rowsToObjects(response.result);
}

async function readD1Cost() {
  const [totals = {}] = await observabilityQuery(`
    SELECT
      COUNT(*) AS queries,
      COALESCE(SUM(CAST(json_extract(json(attributes), '$."cloudflare.d1.response.rows_read"') AS INTEGER)), 0) AS rows_read,
      COALESCE(SUM(CAST(json_extract(json(attributes), '$."cloudflare.d1.response.rows_written"') AS INTEGER)), 0) AS rows_written,
      COALESCE(SUM(duration_ms), 0) AS d1_span_ms
    FROM spans
    WHERE kind = 'd1'
  `);
  const details = await observabilityQuery(`
    SELECT
      name,
      duration_ms,
      json_extract(json(attributes), '$."cloudflare.d1.response.rows_read"') AS rows_read,
      json_extract(json(attributes), '$."cloudflare.d1.response.rows_written"') AS rows_written,
      json_extract(json(attributes), '$."db.query.text"') AS sql
    FROM spans
    WHERE kind = 'd1'
    ORDER BY start_ms ASC
  `);
  return {
    queries: Number(totals.queries ?? 0),
    rowsRead: Number(totals.rows_read ?? 0),
    rowsWritten: Number(totals.rows_written ?? 0),
    d1SpanMs: Number(totals.d1_span_ms ?? 0),
    details,
  };
}

function formatSql(sql) {
  return String(sql ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

async function resetRepairResolveDailyUsage() {
  await runWrangler([
    'd1', 'execute', DATABASE, '--local', '--config', 'wrangler.jsonc',
    '--persist-to', persistDir, '--command', 'DELETE FROM repair_resolve_daily_usage',
  ], 'D1 repair resolve usage reset');
}

async function runRepairResolveScenario() {
  await resetRepairResolveDailyUsage();
  await clearObservability();

  const candidates = Array.from({ length: 50 }, (_, index) => {
    const suffix = String(index + 1).padStart(12, '0');
    return {
      candidateId: 'unknown-dlc-' + (index + 1),
      projectId: 'ffffffff-ffff-4fff-8fff-' + suffix,
      name: 'D1-cost-unknown-dlc-' + (index + 1),
    };
  });

  const response = await fetch(new URL('/api/projects/repair-resolve', ORIGIN), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '198.51.100.77',
    },
    body: JSON.stringify({ candidates }),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`DLC Repair · 50 unknown batch: HTTP ${response.status}: ${responseText.slice(0, 500)}`);

  let responseJson = {};
  try {
    responseJson = JSON.parse(responseText);
  } catch {
    throw new Error('DLC Repair · 50 unknown batch: response was not valid JSON');
  }
  if (!Array.isArray(responseJson.results) || responseJson.results.length !== 50) {
    throw new Error(`DLC Repair · 50 unknown batch: expected 50 results, got ${responseJson.results?.length ?? 'invalid'}`);
  }
  if (responseJson.results.some(result => result?.status !== 'none')) {
    throw new Error('DLC Repair · 50 unknown batch: fixture unexpectedly matched a project');
  }

  await sleep(50);
  const cost = await readD1Cost();
  const reasons = [];
  if (cost.queries > REPAIR_RESOLVE_BUDGET.maxQueries) reasons.push(`queries ${cost.queries} > ${REPAIR_RESOLVE_BUDGET.maxQueries}`);
  if (cost.rowsRead > REPAIR_RESOLVE_BUDGET.maxRowsRead) reasons.push(`rows_read ${cost.rowsRead} > ${REPAIR_RESOLVE_BUDGET.maxRowsRead}`);
  if (cost.rowsWritten > REPAIR_RESOLVE_BUDGET.maxRowsWritten) reasons.push(`rows_written ${cost.rowsWritten} > ${REPAIR_RESOLVE_BUDGET.maxRowsWritten}`);
  if (cost.rowsRead >= CATASTROPHIC_ROWS_READ) reasons.push(`CATASTROPHIC rows_read >= ${CATASTROPHIC_ROWS_READ}`);
  const sqlTexts = cost.details.map(query => String(query.sql || ''));
  if (sqlTexts.some(sql => /LIKE/i.test(sql))) reasons.push('automatic repair resolver used LIKE');
  if (sqlTexts.some(sql => /description|custom_tags|facets|author_name/i.test(sql) && /SELECT/i.test(sql))) {
    reasons.push('automatic repair resolver touched fuzzy-search fields');
  }
  return { cost, reasons };
}

async function runRepairResolveLockScenario() {
  const lockedIp = '198.51.100.88';
  const subjectKey = 'anon:d8eded12d7d8fcea1c2223058ec5777d';
  await runWrangler([
    'd1', 'execute', DATABASE, '--local', '--config', 'wrangler.jsonc',
    '--persist-to', persistDir,
    '--command',
    `INSERT OR REPLACE INTO repair_resolve_daily_usage (subject_key, day_key, resolve_count, updated_at)
     VALUES ('${subjectKey}', date('now'), 40, CURRENT_TIMESTAMP)`,
  ], 'D1 repair resolve lock seed');
  await clearObservability();

  const response = await fetch(new URL('/api/projects/repair-resolve', ORIGIN), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': lockedIp,
    },
    body: JSON.stringify({
      candidates: [{
        candidateId: 'locked-dlc',
        projectId: 'ffffffff-ffff-4fff-8fff-999999999999',
        name: 'D1-cost-locked-dlc',
      }],
    }),
  });
  const responseText = await response.text();
  let responseJson = {};
  try {
    responseJson = JSON.parse(responseText);
  } catch {
    throw new Error('DLC Repair · daily lock: response was not valid JSON');
  }

  const reasons = [];
  if (response.status !== 429) reasons.push(`HTTP ${response.status} != 429`);
  if (responseJson.code !== 'REPAIR_DAILY_LOCKED') reasons.push(`code ${responseJson.code || 'missing'} != REPAIR_DAILY_LOCKED`);
  if (responseJson.error !== '好啦別再点了喵！截图然后去DC找我吧喵！') reasons.push('lock message mismatch');
  const lockedUntil = Date.parse(String(responseJson.lockedUntil || ''));
  if (!Number.isFinite(lockedUntil) || lockedUntil <= Date.now()) reasons.push('lockedUntil is missing or not in the future');

  await sleep(50);
  const cost = await readD1Cost();
  const sqlTexts = cost.details.map(query => String(query.sql || ''));
  if (sqlTexts.some(sql => /FROM\s+projects/i.test(sql))) reasons.push('locked request still queried projects');
  if (cost.queries > 1) reasons.push(`queries ${cost.queries} > 1`);
  if (cost.rowsWritten > 0) reasons.push(`rows_written ${cost.rowsWritten} > 0 while locked`);
  return { cost, reasons };
}

async function resetCurrentRankingDay() {
  const rankingDay = new Date().toISOString().slice(0, 10);
  const sql = [
    `DELETE FROM discovery_feature_history WHERE ranking_day = '${rankingDay}'`,
    `DELETE FROM project_daily_rankings WHERE ranking_day = '${rankingDay}'`,
    `DELETE FROM project_ranking_builds WHERE ranking_day = '${rankingDay}'`,
  ].join('; ');
  await runWrangler([
    'd1', 'execute', DATABASE, '--local', '--config', 'wrangler.jsonc',
    '--persist-to', persistDir, '--command', sql,
  ], 'D1 daily ranking reset');
}

async function triggerConcurrentScheduledRanking(name, budget) {
  await clearObservability();
  const responses = await Promise.all([
    fetch(`${ORIGIN}/cdn-cgi/local/scheduled`),
    fetch(`${ORIGIN}/cdn-cgi/local/scheduled`),
  ]);
  for (const response of responses) {
    const responseText = await response.text();
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  }
  await sleep(100);

  const cost = await readD1Cost();
  if (cost.queries === 0) throw new Error(`${name}: no D1 spans captured; cost cannot be verified`);
  const reasons = [];
  if (cost.queries > budget.maxQueries) reasons.push(`queries ${cost.queries} > ${budget.maxQueries}`);
  if (cost.rowsRead > budget.maxRowsRead) reasons.push(`rows_read ${cost.rowsRead} > ${budget.maxRowsRead}`);
  if (cost.rowsWritten > budget.maxRowsWritten) reasons.push(`rows_written ${cost.rowsWritten} > ${budget.maxRowsWritten}`);
  if (cost.rowsRead >= CATASTROPHIC_ROWS_READ) reasons.push(`CATASTROPHIC rows_read >= ${CATASTROPHIC_ROWS_READ}`);
  return { cost, reasons };
}

async function triggerScheduledRanking(name, budget) {
  await clearObservability();
  const response = await fetch(`${ORIGIN}/cdn-cgi/local/scheduled`);
  const responseText = await response.text();
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  await sleep(75);

  const cost = await readD1Cost();
  if (cost.queries === 0) throw new Error(`${name}: no D1 spans captured; cost cannot be verified`);

  const reasons = [];
  if (cost.queries > budget.maxQueries) reasons.push(`queries ${cost.queries} > ${budget.maxQueries}`);
  if (cost.rowsRead > budget.maxRowsRead) reasons.push(`rows_read ${cost.rowsRead} > ${budget.maxRowsRead}`);
  if (cost.rowsWritten > budget.maxRowsWritten) reasons.push(`rows_written ${cost.rowsWritten} > ${budget.maxRowsWritten}`);
  if (cost.rowsRead >= CATASTROPHIC_ROWS_READ) reasons.push(`CATASTROPHIC rows_read >= ${CATASTROPHIC_ROWS_READ}`);
  return { cost, reasons };
}

function printCostResult(name, result) {
  const mark = result.reasons.length ? 'FAIL' : 'PASS';
  console.log(`[${mark}] ${name}: queries=${result.cost.queries}, rows_read=${result.cost.rowsRead}, rows_written=${result.cost.rowsWritten}, d1_span_ms=${result.cost.d1SpanMs}`);
  if (!result.reasons.length) return;

  failed = true;
  console.log(`  Reasons: ${result.reasons.join('; ')}`);
  for (const query of result.cost.details) {
    console.log(`  - rows_read=${query.rows_read ?? '?'} rows_written=${query.rows_written ?? '?'} ${formatSql(query.sql)}`);
  }
}

async function runScenario(scenario) {
  await clearObservability();
  const url = new URL('/api/projects', ORIGIN);
  for (const [key, value] of Object.entries(scenario.params)) url.searchParams.set(key, String(value));

  const response = await fetch(url);
  const responseText = await response.text();
  if (!response.ok) throw new Error(`${scenario.name}: HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  let responseJson = {};
  try {
    responseJson = JSON.parse(responseText);
  } catch {
    throw new Error(`${scenario.name}: response was not valid JSON`);
  }
  const projectIds = Array.isArray(responseJson.projects)
    ? responseJson.projects.map(project => String(project?.id || '')).filter(Boolean)
    : [];
  await sleep(50);

  const cost = await readD1Cost();
  if (cost.queries === 0) throw new Error(`${scenario.name}: no D1 spans captured; cost cannot be verified`);

  const budget = { ...DEFAULT_BUDGET, ...(scenario.budget ?? {}) };
  const reasons = [];
  if (cost.queries > budget.maxQueries) reasons.push(`queries ${cost.queries} > ${budget.maxQueries}`);
  if (cost.rowsRead > budget.maxRowsRead) reasons.push(`rows_read ${cost.rowsRead} > ${budget.maxRowsRead}`);
  if (cost.rowsWritten > budget.maxRowsWritten) reasons.push(`rows_written ${cost.rowsWritten} > ${budget.maxRowsWritten}`);
  if (cost.rowsRead >= CATASTROPHIC_ROWS_READ) reasons.push(`CATASTROPHIC rows_read >= ${CATASTROPHIC_ROWS_READ}`);
  if (scenario.requireDailyRanking) {
    const sqlTexts = cost.details.map(query => String(query.sql || ''));
    const rankingSql = sqlTexts.find(sql => sql.includes('FROM project_daily_rankings r')) || '';
    if (!rankingSql) reasons.push('ranking request did not read project_daily_rankings (fallback path detected)');
    if (rankingSql && !rankingSql.includes(' BETWEEN ? AND ?')) reasons.push('ranking request did not use bounded rank BETWEEN');
    if (sqlTexts.some(sql => sql.includes('project_rank_snapshots'))) reasons.push('retired JSON ranking snapshot appeared in browse hot path');
    if (rankingSql && /json_each\s*\(/i.test(rankingSql)) reasons.push('ranking browse expanded JSON');
    if (rankingSql && /OFFSET/i.test(rankingSql)) reasons.push('ranking browse used OFFSET');
  }

  return { cost, reasons, projectIds };
}

let failed = false;
try {
  await ensureSnapshotState();
  const eligibleProjectCount = await readEligibleProjectCount();
  const rankingRebuildBudget = {
    ...RANKING_REBUILD_BUDGET,
    maxRowsRead: 3 * eligibleProjectCount + 502,
  };
  await resetCurrentRankingDay();
  await assertPortAvailable();
  startServer();
  await waitForServer();
  console.log(`D1 cost gate: daily ranking + ${scenarios.length} local browse scenarios on production snapshot ${path.basename(path.dirname(snapshotSql))}`);
  console.log(`Default browse budget: <=${DEFAULT_BUDGET.maxQueries} queries, <=${DEFAULT_BUDGET.maxRowsRead} rows read, ${DEFAULT_BUDGET.maxRowsWritten} rows written`);
  console.log(`Daily rebuild budget: N=${eligibleProjectCount}, <=${rankingRebuildBudget.maxQueries} queries, <=3N+500=${rankingRebuildBudget.maxRowsRead} rows read, <=${rankingRebuildBudget.maxRowsWritten} rows written`);
  console.log(`Shared local state: ${persistDir}\n`);

  printCostResult('排行榜 · 并发双触发完整重建', await triggerConcurrentScheduledRanking('排行榜 · 并发双触发完整重建', rankingRebuildBudget));
  printCostResult('排行榜 · 同日重复触发', await triggerScheduledRanking('排行榜 · 同日重复触发', RANKING_FAST_PATH_BUDGET));

  const scenarioResults = new Map();
  for (const scenario of scenarios) {
    const result = await runScenario(scenario);
    scenarioResults.set(scenario.name, result);
    printCostResult(scenario.name, result);
  }

  printCostResult('DLC Repair · 50 unknown batch', await runRepairResolveScenario());
  printCostResult('DLC Repair · daily lock', await runRepairResolveLockScenario());

  const publishedIds = scenarioResults.get('首页 · 最新发布')?.projectIds || [];
  for (const rankedName of ['首页 · 发现推荐', '首页 · 玩家好评']) {
    const rankedIds = scenarioResults.get(rankedName)?.projectIds || [];
    if (rankedIds.length === 0) {
      failed = true;
      console.log(`[FAIL] ${rankedName}: ranking result is empty on the production snapshot fixture`);
      continue;
    }
    if (JSON.stringify(rankedIds) === JSON.stringify(publishedIds)) {
      failed = true;
      console.log(`[FAIL] ${rankedName}: ranking order collapsed to 最新发布`);
    }
  }

  if (failed) {
    console.error('\nD1 COST GATE FAILED');
    process.exitCode = 1;
  } else {
    console.log('\nD1 COST GATE PASSED');
  }
} finally {
  await stopServerTree();
}
