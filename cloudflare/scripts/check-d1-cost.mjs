import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8793;
const DATABASE = 'creative_workshop';
const SNAPSHOT_DATE = '2026-09-06';
const SNAPSHOT_FILE = 'creative_workshop.sql';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const EXPLORER_API = `${ORIGIN}/cdn-cgi/local/explorer/api`;
const DEFAULT_BUDGET = Object.freeze({ maxQueries: 10, maxRowsRead: 10_000, maxRowsWritten: 0 });
const CATASTROPHIC_ROWS_READ = 100_000;
const wranglerBin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

const scenarios = [
  { name: '首页 · 最新发布', params: { page: 0, pageSize: 20, sort: 'published' } },
  { name: '首页 · 最近更新', params: { page: 0, pageSize: 20, sort: 'updated' } },
  { name: '首页 · 玩家好评', params: { page: 0, pageSize: 20, sort: 'likes' } },
  { name: '首页 · 下载最多', params: { page: 0, pageSize: 20, sort: 'downloads' } },
  { name: '筛选 · 角色', params: { page: 0, pageSize: 20, sort: 'published', projectType: '角色' } },
  { name: '标签搜索', params: { page: 0, pageSize: 20, sort: 'published', tag: '角色' } },
  { name: '全文搜索', params: { page: 0, pageSize: 20, sort: 'published', search: '系统' } },
  { name: '深分页 · 第 11 页', params: { page: 10, pageSize: 20, sort: 'published' } },
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

async function runScenario(scenario) {
  await clearObservability();
  const url = new URL('/api/projects', ORIGIN);
  for (const [key, value] of Object.entries(scenario.params)) url.searchParams.set(key, String(value));

  const response = await fetch(url);
  const responseText = await response.text();
  if (!response.ok) throw new Error(`${scenario.name}: HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  await sleep(50);

  const cost = await readD1Cost();
  if (cost.queries === 0) throw new Error(`${scenario.name}: no D1 spans captured; cost cannot be verified`);

  const budget = { ...DEFAULT_BUDGET, ...(scenario.budget ?? {}) };
  const reasons = [];
  if (cost.queries > budget.maxQueries) reasons.push(`queries ${cost.queries} > ${budget.maxQueries}`);
  if (cost.rowsRead > budget.maxRowsRead) reasons.push(`rows_read ${cost.rowsRead} > ${budget.maxRowsRead}`);
  if (cost.rowsWritten > budget.maxRowsWritten) reasons.push(`rows_written ${cost.rowsWritten} > ${budget.maxRowsWritten}`);
  if (cost.rowsRead >= CATASTROPHIC_ROWS_READ) reasons.push(`CATASTROPHIC rows_read >= ${CATASTROPHIC_ROWS_READ}`);

  return { cost, reasons };
}

let failed = false;
try {
  await ensureSnapshotState();
  startServer();
  await waitForServer();
  console.log(`D1 cost gate: ${scenarios.length} local scenarios on production snapshot ${SNAPSHOT_DATE}`);
  console.log(`Default budget: <=${DEFAULT_BUDGET.maxQueries} queries, <=${DEFAULT_BUDGET.maxRowsRead} rows read, ${DEFAULT_BUDGET.maxRowsWritten} rows written`);
  console.log(`Shared local state: ${persistDir}\n`);

  for (const scenario of scenarios) {
    const result = await runScenario(scenario);
    const mark = result.reasons.length ? 'FAIL' : 'PASS';
    console.log(`[${mark}] ${scenario.name}: queries=${result.cost.queries}, rows_read=${result.cost.rowsRead}, rows_written=${result.cost.rowsWritten}, d1_span_ms=${result.cost.d1SpanMs}`);
    if (result.reasons.length) {
      failed = true;
      console.log(`  Reasons: ${result.reasons.join('; ')}`);
      for (const query of result.cost.details) {
        console.log(`  - rows_read=${query.rows_read ?? '?'} rows_written=${query.rows_written ?? '?'} ${formatSql(query.sql)}`);
      }
    }
  }

  if (failed) {
    console.error('\nD1 COST GATE FAILED');
    process.exitCode = 1;
  } else {
    console.log('\nD1 COST GATE PASSED');
  }
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => server.once('exit', resolve)),
      sleep(3000),
    ]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
}
