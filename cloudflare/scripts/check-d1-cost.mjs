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
const DEFAULT_BUDGET = Object.freeze({ maxQueries: 2, maxRowsRead: 600, maxRowsWritten: 0 });
const PUBLIC_COUNT_LOOKUP_MAX_ROWS = 8;
const DISCOVERY_ROTATION_BUDGET = Object.freeze({ maxQueries: 16, maxRowsWritten: 100 });
const DISCOVERY_FAST_PATH_BUDGET = Object.freeze({ maxQueries: 1, maxRowsRead: 5, maxRowsWritten: 0 });
const REPAIR_RESOLVE_BUDGET = Object.freeze({ maxQueries: 3, maxRowsRead: 250, maxRowsWritten: 3 });
const CATASTROPHIC_ROWS_READ = 100_000;
const wranglerBin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

const scenarios = [
  { name: '首页 · 随机发现', params: { page: 0, pageSize: 10, sort: 'discover' }, budget: { maxQueries: 3, maxRowsRead: 80 }, requireDiscoveryRotation: true },
  { name: '首页 · 最新发布', params: { page: 0, pageSize: 20, sort: 'published' }, budget: { maxRowsRead: 80 } },
  { name: '首页 · 最新发布 · 缓存命中', params: { page: 0, pageSize: 20, sort: 'published' }, budget: { maxQueries: 1, maxRowsRead: PUBLIC_COUNT_LOOKUP_MAX_ROWS }, expectCacheHit: true },
  { name: '首页 · 最近更新', params: { page: 0, pageSize: 20, sort: 'updated' }, budget: { maxRowsRead: 80 } },
  { name: '首页 · 下载最多', params: { page: 0, pageSize: 20, sort: 'downloads' }, budget: { maxRowsRead: 80 } },
  { name: '首页 · 点赞最多', params: { page: 0, pageSize: 20, sort: 'likes' }, budget: { maxRowsRead: 80 } },
  { name: '兼容 · 旧客户端玩家好评', params: { page: 0, pageSize: 12, sort: 'rating' }, budget: { maxRowsRead: 80 }, forbidDiscoveryBoard: true },
  { name: '筛选 · 角色', params: { page: 0, pageSize: 20, sort: 'published', projectType: '角色' }, budget: { maxRowsRead: 80 } },
  { name: '筛选 · 最低点赞', params: { page: 0, pageSize: 20, sort: 'published', minLikes: 5 }, budget: { maxRowsRead: 600 } },
  { name: '筛选 · 最低下载', params: { page: 0, pageSize: 20, sort: 'published', minDownloads: 10 }, budget: { maxRowsRead: 600 } },
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

function getDiscoveryRotationKey(nowMs = Date.now()) {
  const rotationMs = 6 * 60 * 60 * 1000;
  const utc8OffsetMs = 8 * 60 * 60 * 1000;
  const firstSlotOffsetMs = 4 * 60 * 60 * 1000;
  const utc8Ms = nowMs + utc8OffsetMs;
  const shifted = utc8Ms - firstSlotOffsetMs;
  const slotLocalMs = Math.floor(shifted / rotationMs) * rotationMs + firstSlotOffsetMs;
  return new Date(slotLocalMs).toISOString().slice(0, 13);
}

async function resetDiscoveryFixtureState() {
  const sql = [
    'DELETE FROM discovery_feature_history',
    'DELETE FROM project_daily_rankings',
    'DELETE FROM project_ranking_builds',
    "UPDATE public_project_counts SET revision = revision + 1 WHERE scope = '*'",
  ].join('; ');
  await runWrangler([
    'd1', 'execute', DATABASE, '--local', '--config', 'wrangler.jsonc',
    '--persist-to', persistDir, '--command', sql,
  ], 'D1 discovery fixture reset');
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
  const sqlTexts = cost.details.map(query => String(query.sql || ''));
  const publicCountQueries = cost.details.filter(query => /\bFROM\s+public_project_counts\b/i.test(String(query.sql || '')));
  if (publicCountQueries.length !== 1) {
    reasons.push(`public_project_counts lookups ${publicCountQueries.length} != 1`);
  } else if (Number(publicCountQueries[0].rows_read || 0) > PUBLIC_COUNT_LOOKUP_MAX_ROWS) {
    reasons.push(`public_project_counts rows_read ${publicCountQueries[0].rows_read} > ${PUBLIC_COUNT_LOOKUP_MAX_ROWS}`);
  }
  if (scenario.expectCacheHit) {
    const nonCountQueries = cost.details.filter(query => !/\bFROM\s+public_project_counts\b/i.test(String(query.sql || '')));
    if (nonCountQueries.length > 0) reasons.push('cache hit still queried project list data');
  }
  if (scenario.forbidDiscoveryBoard && sqlTexts.some(sql => sql.includes('project_daily_rankings'))) {
    reasons.push('legacy rating request unexpectedly used the discovery board');
  }
  if (scenario.requireDiscoveryRotation) {
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
  const discoveryRotationBudget = {
    ...DISCOVERY_ROTATION_BUDGET,
    maxRowsRead: eligibleProjectCount + 150,
  };
  await resetDiscoveryFixtureState();
  await assertPortAvailable();
  startServer();
  await waitForServer();
  const rotationKey = getDiscoveryRotationKey();
  console.log(`D1 cost gate: 6-hour random discovery + ${scenarios.length} local browse scenarios on production snapshot ${path.basename(path.dirname(snapshotSql))}`);
  console.log(`Default browse budget: <=${DEFAULT_BUDGET.maxQueries} queries, <=${DEFAULT_BUDGET.maxRowsRead} rows read, ${DEFAULT_BUDGET.maxRowsWritten} rows written`);
  console.log(`Discovery rotation budget: N=${eligibleProjectCount}, <=${discoveryRotationBudget.maxQueries} queries, <=N+150=${discoveryRotationBudget.maxRowsRead} rows read, <=${discoveryRotationBudget.maxRowsWritten} rows written`);
  console.log(`Rotation key: ${rotationKey} (UTC+8 slots 04:00 / 10:00 / 16:00 / 22:00)`);
  console.log(`Shared local state: ${persistDir} (ranking tables reset before measurement)
`);

  printCostResult('随机发现 · 并发双触发', await triggerConcurrentScheduledRanking('随机发现 · 并发双触发', discoveryRotationBudget));
  printCostResult('随机发现 · 同轮重复触发', await triggerScheduledRanking('随机发现 · 同轮重复触发', DISCOVERY_FAST_PATH_BUDGET));

  const scenarioResults = new Map();
  for (const scenario of scenarios) {
    const result = await runScenario(scenario);
    scenarioResults.set(scenario.name, result);
    printCostResult(scenario.name, result);
  }

  printCostResult('DLC Repair · 50 unknown batch', await runRepairResolveScenario());
  printCostResult('DLC Repair · daily lock', await runRepairResolveLockScenario());

  const publishedIds = scenarioResults.get('首页 · 最新发布')?.projectIds || [];
  const randomIds = scenarioResults.get('首页 · 随机发现')?.projectIds || [];
  if (randomIds.length !== 10) {
    failed = true;
    console.log(`[FAIL] 首页 · 随机发现: expected 10 projects, got ${randomIds.length}`);
  }
  if (randomIds.length > 0 && JSON.stringify(randomIds) === JSON.stringify(publishedIds.slice(0, randomIds.length))) {
    failed = true;
    console.log('[FAIL] 首页 · 随机发现: random picks collapsed to 最新发布');
  }

  await stopServerTree();
  await resetDiscoveryFixtureState();
  await assertPortAvailable();
  startServer();
  await waitForServer();
  const bootstrapResult = await runScenario({
    name: '随机发现 · 空板请求自举',
    params: { page: 0, pageSize: 10, sort: 'discover' },
    budget: { maxQueries: 20, maxRowsRead: eligibleProjectCount + 220, maxRowsWritten: 100 },
    requireDiscoveryRotation: true,
  });
  printCostResult('随机发现 · 空板请求自举', bootstrapResult);
  if (bootstrapResult.projectIds.length !== 10) {
    failed = true;
    console.log(`[FAIL] 随机发现 · 空板请求自举: expected 10 projects, got ${bootstrapResult.projectIds.length}`);
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
