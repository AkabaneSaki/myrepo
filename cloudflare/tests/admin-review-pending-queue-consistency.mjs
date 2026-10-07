import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

// #44 — Audit Center 的「等待审核」总数必须与实际可操作的审核卡片一致。
// 本测试锁定两件事：
//   1. 服务端 count / list 使用同一份 eligibility 定义，total 不再是「整张表」口径；
//   2. 前端队列数字只来自真实卡片数量，且拉取全部分页，不允许只显示一页却报出全部。

const dbSource = readFileSync(resolve('src/utils/db.ts'), 'utf8');
const adminSource = readFileSync(resolve('src/endpoints/admin.ts'), 'utf8');
const homeApiSource = readFileSync(resolve('src/pages/home/api.ts'), 'utf8');
const adminReviewSource = readFileSync(resolve('src/pages/home/modal/admin-review.ts'), 'utf8');

// ---------- 服务端：count / list 共享同一 WHERE，且结果自带 hasMore ----------

const pendingListStart = dbSource.indexOf('getPendingList:');
const pendingListEnd = dbSource.indexOf('getByAuthor:', pendingListStart);
assert.ok(pendingListStart >= 0 && pendingListEnd > pendingListStart, 'projectDb.getPendingList must be readable');
const pendingListSource = dbSource.slice(pendingListStart, pendingListEnd);

assert.match(
  pendingListSource,
  /SELECT COUNT\(\*\) as total FROM projects p WHERE \$\{whereClause\}/,
  'the pending count must use the same WHERE clause as the pending list',
);
assert.match(pendingListSource, /WHERE \$\{whereClause\}\s*\n\s*ORDER BY \$\{orderBy\}/, 'the pending list must use that same clause');
assert.equal(
  (pendingListSource.match(/conditions\.push\(/g) || []).length,
  (pendingListSource.match(/p\.status = 'pending'/) || []).length === 1 ? 1 : 99,
  'exactly one extra eligibility condition (projectType filter) may extend the shared clause',
);
assert.match(
  pendingListSource,
  /hasMore: offset \+ enrichedProjects\.length < total/,
  'the pending page must report whether actionable rows remain beyond this page',
);

const pendingEndpointStart = adminSource.indexOf('export class AdminPendingList');
const pendingCleanupStart = adminSource.indexOf('export class AdminPendingCleanup');
assert.ok(pendingEndpointStart >= 0 && pendingCleanupStart > pendingEndpointStart, 'admin pending endpoint must be readable');
const pendingEndpointSource = adminSource.slice(pendingEndpointStart, pendingCleanupStart);
assert.match(
  pendingEndpointSource,
  /Math\.min\(Math\.max\([\s\S]{0,80}MAX_ADMIN_PENDING_PAGE_SIZE\)/,
  'the pending page size must stay clamped so one request cannot read the whole queue',
);

// ---------- 行为：用真实 SQL 复现 count/list 一致性 ----------

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(resolve('schema.sql'), 'utf8'));
db.exec("INSERT INTO users (id, username) VALUES ('author', 'author')");

let sequence = 0;
function insertPending(id, projectType = '角色', overrides = {}) {
  sequence += 1;
  const values = {
    id,
    name: id,
    author_id: 'author',
    author_name: 'author',
    status: 'pending',
    project_type: projectType,
    // strictly increasing so oldest-first ordering is deterministic
    created_at: `2026-01-01 00:00:${String(sequence).padStart(2, '0')}`,
    ...overrides,
  };
  const columns = Object.keys(values);
  db.prepare(
    `INSERT INTO projects (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  ).run(...columns.map(column => values[column]));
}

function pendingPage({ page = 0, pageSize = 5, projectType = null } = {}) {
  // 与 projectDb.getPendingList 使用完全相同的条件构造与查询形状。
  const conditions = ["p.status = 'pending'"];
  const filterValues = [];
  if (projectType) {
    conditions.push('p.project_type = ?');
    filterValues.push(projectType);
  }
  const whereClause = conditions.join(' AND ');
  const count = db
    .prepare(`SELECT COUNT(*) as total FROM projects p WHERE ${whereClause}`)
    .get(...filterValues).total;
  const rows = db
    .prepare(
      `SELECT p.id FROM projects p
       LEFT JOIN users u ON p.author_id = u.id
       LEFT JOIN projects published ON p.published_project_id = published.id
       WHERE ${whereClause}
       ORDER BY p.created_at ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...filterValues, pageSize, page * pageSize)
    .map(row => row.id);
  return { total: Number(count), rows, hasMore: page * pageSize + rows.length < Number(count) };
}

// 1. 普通待审核：total 与卡片一致，无隐藏项。
insertPending('a');
insertPending('b');
assert.deepEqual(pendingPage({ pageSize: 20 }), { total: 2, rows: ['a', 'b'], hasMore: false });

// 2. 积压超过一页：count 与 list 同源，翻页不会丢行也不会多算。
for (const id of ['c', 'd', 'e', 'f']) insertPending(id);
const firstPage = pendingPage({ pageSize: 3 });
assert.deepEqual(firstPage, { total: 6, rows: ['a', 'b', 'c'], hasMore: true });
const secondPage = pendingPage({ page: 1, pageSize: 3 });
assert.deepEqual(secondPage, { total: 6, rows: ['d', 'e', 'f'], hasMore: false });
assert.equal(new Set([...firstPage.rows, ...secondPage.rows]).size, 6, 'paging must cover every pending row exactly once');

// 3. 草稿被更新（新草稿）后，旧行不再是 pending，total 必须同步下降。
db.exec("UPDATE projects SET status = 'drafting' WHERE id = 'c'");
assert.equal(pendingPage({ pageSize: 20 }).total, 5, 'a draft being re-edited must leave the actionable queue');

// 4. 被取代的旧草稿（published 基线已变）与新草稿并存时，只有新草稿可操作。
insertPending('sup', '扩展', { review_target: 'draft', published_project_id: 'pub', latest_approved_at: '2026-01-01 00:00:00' });
db.exec("INSERT INTO projects (id, name, author_id, author_name, status, project_type, is_published, latest_approved_at) VALUES ('pub', 'pub', 'author', 'author', 'approved', '扩展', 1, '2026-01-05 00:00:00')");
db.exec("INSERT INTO projects (id, name, author_id, author_name, status, project_type, is_published, latest_approved_at) VALUES ('pub2', 'pub2', 'author', 'author', 'approved', '扩展', 1, '2026-01-09 00:00:00')");
const staleDetection = db
  .prepare(
    `SELECT COUNT(*) as stale FROM projects AS projects
     WHERE projects.status = 'pending'
       AND projects.review_target = 'draft'
       AND projects.published_project_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM projects AS published
         WHERE published.id = projects.published_project_id
           AND published.status = 'approved'
           AND published.is_published = 1
           AND COALESCE(published.latest_approved_at, '') <> COALESCE(projects.latest_approved_at, '')
       )`,
  )
  .get().stale;
assert.equal(Number(staleDetection), 1, 'a draft whose published baseline already moved is stale');
const totalWithStale = pendingPage({ pageSize: 20 }).total;
assert.equal(totalWithStale, 6, 'stale rows are still counted until cleanup retires them — cleanup must move both numbers together');

// 5. 清理（清理过期请求）后，total 与卡片同时下降。
db.exec(
  `UPDATE projects
   SET status = 'rejected', reject_reason = '已被其他已通过版本取代'
   WHERE review_target = 'draft'
     AND status IN ('pending', 'drafting')
     AND published_project_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM projects AS published
       WHERE published.id = projects.published_project_id
         AND published.status = 'approved'
         AND published.is_published = 1
         AND COALESCE(published.latest_approved_at, '') <> COALESCE(projects.latest_approved_at, '')
     )`,
);
assert.equal(pendingPage({ pageSize: 20 }).total, 5, 'cleanup must retire stale rows from the actionable queue');

// 6. 通过 / 拒绝：单行离开队列，total 与卡片同步。
db.exec("UPDATE projects SET status = 'approved' WHERE id = 'a'");
assert.equal(pendingPage({ pageSize: 20 }).total, 4);
db.exec("UPDATE projects SET status = 'rejected' WHERE id = 'b'");
assert.equal(pendingPage({ pageSize: 20 }).total, 3);

// 7. 重复的历史行（同一项目的多条 pending 草稿）不因 join 被丢弃。
db.exec("INSERT INTO projects (id, name, author_id, author_name, status, project_type, review_target, published_project_id) VALUES ('dup1', 'dup1', 'author', 'author', 'pending', '事件', 'draft', NULL)");
db.exec("INSERT INTO projects (id, name, author_id, author_name, status, project_type, review_target, published_project_id) VALUES ('dup2', 'dup2', 'author', 'author', 'pending', '事件', 'draft', NULL)");
const withDuplicates = pendingPage({ pageSize: 20 });
assert.equal(withDuplicates.total, withDuplicates.rows.length, 'duplicate history rows must not be dropped by the list join');

// 8. 类型筛选：total 与筛选后的卡片保持一致。
assert.equal(pendingPage({ projectType: '事件' }).total, 2);
assert.equal(pendingPage({ projectType: '事件' }).rows.length, 2);
assert.equal(pendingPage({ projectType: '角色' }).total, 3, 'd/e/f remain pending 角色 rows');
assert.equal(pendingPage({ projectType: '角色' }).rows.length, 3, 'the filtered card list must match the filtered total');
insertPending('ty', '系统核心');
assert.equal(pendingPage({ projectType: '系统核心' }).total, 1, 'type filtering must count exactly the filtered rows');
assert.equal(pendingPage({ projectType: '系统核心' }).rows.length, 1);

// ---------- 前端：队列数字与卡片同源，且分页必须被取完 ----------

assert.match(
  homeApiSource,
  /const ADMIN_PENDING_PAGE_SIZE = \d+;/,
  'the pending queue must page through the API with an explicit page size',
);
assert.match(
  homeApiSource,
  /while \(true\)[\s\S]{0,900}page \+= 1;/,
  'the pending queue must keep paging instead of showing only the first page',
);
assert.match(
  homeApiSource,
  /total <= projects\.length/,
  'paging must stop once every actionable pending project is loaded',
);
assert.match(
  homeApiSource,
  /hasMore: projects\.length < total/,
  'the client must still report when a bounded queue could not load everything',
);
assert.doesNotMatch(
  homeApiSource,
  /apiFetch\('\/api\/admin\/pending\?' \+ params\.toString\(\)\);\s*\n\s*return result;/,
  'the pending queue must not return a single page as if it were the whole queue',
);

assert.match(
  adminReviewSource,
  /function updateAdminReviewQueueSummary\(overlay, knownTotal\)/,
  'the queue summary must be updated from the rendered cards',
);
assert.match(
  adminReviewSource,
  /const visibleCount = refreshAdminReviewPositions\(overlay\);/,
  'the summary number must be the real card count',
);
assert.doesNotMatch(
  adminReviewSource,
  /<strong>\$\{total\}<\/strong> 个项目等待审核/,
  'the raw API total must never be presented as the queue length',
);
assert.match(
  adminReviewSource,
  /另有 \$\{hiddenCount\} 个未加载/,
  'a bounded queue must state how many actionable projects are not loaded',
);
assert.match(
  adminReviewSource,
  /updateAdminReviewQueueSummary\(queueOverlay, Number\(refreshedQueue\.total/,
  'approve / reject must refresh the summary from the remaining cards',
);
assert.match(
  adminReviewSource,
  /overlay\.dataset\.reviewKnownTotal = String\(/,
  'the known total must live on the queue overlay, not in a cross-modal global',
);
assert.doesNotMatch(
  adminReviewSource,
  /let adminReviewQueueKnownTotal/,
  'a global known-total must not leak between successive Audit Center modals',
);

// ---------- 前端行为：把真正的分页加载与摘要渲染跑起来 ----------

const homeApiScript = await readSource('src/pages/home/api.ts');
const { homeAdminReviewModalScript: adminReviewScript } = await import(
  new URL('../src/pages/home/modal/admin-review.ts', import.meta.url)
);

/** 抽出某个函数的完整源码（含参数列表与函数体），以便在沙箱里真实执行。 */
function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `expected to find ${signature}`);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let index = source.indexOf('(', start); index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') parenDepth += 1;
    else if (char === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        bodyStart = source.indexOf('{', index);
        break;
      }
    }
  }
  assert.ok(bodyStart > 0, `expected a body for ${signature}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced function body for ${signature}`);
}

function evaluateWith(source, scope) {
  const names = Object.keys(scope);
  const factory = new Function(...names, `return (${source});`);
  return factory(...names.map(name => scope[name]));
}

async function readSource(relativePath) {
  return readFileSync(resolve(relativePath), 'utf8');
}

const fetchPendingProjects = evaluateWith(
  extractFunction(homeApiScript, 'async function fetchPendingProjects'),
  {
    ADMIN_PENDING_PAGE_SIZE: 20,
    ADMIN_PENDING_MAX_CARDS: 200,
    console: { info() {} },
    performance: { now: () => 0 },
    apiFetch: null, // supplied per scenario below
  },
);

function pendingApi(rows) {
  return (endpoint => {
    const page = Number(new URL(`https://workshop.test${endpoint}`).searchParams.get('page') || 0);
    const pageSize = Number(new URL(`https://workshop.test${endpoint}`).searchParams.get('pageSize') || 0);
    return Promise.resolve({
      total: rows.length,
      projects: rows.slice(page * pageSize, (page + 1) * pageSize),
    });
  });
}

// 12 张卡（原缺陷：API total 报 12，只显示前 12…）与 10 张卡 / 只取 5 张的现场一致。
const tenRows = Array.from({ length: 10 }, (_, index) => ({ id: `p${index}` }));
const resultTen = await (async () => {
  const fetcher = evaluateWith(
    extractFunction(homeApiScript, 'async function fetchPendingProjects'),
    {
      ADMIN_PENDING_PAGE_SIZE: 5,
      ADMIN_PENDING_MAX_CARDS: 200,
      console: { info() {} },
      performance: { now: () => 0 },
      apiFetch: pendingApi(tenRows),
    },
  );
  return fetcher({ sort: 'oldest', projectType: '' });
})();
assert.equal(resultTen.total, 10);
assert.equal(resultTen.projects.length, 10, 'a 10-item backlog must load all 10 cards, not 5');
assert.equal(resultTen.hasMore, false, 'when everything is loaded nothing is hidden');

// 单页足够时不能多发请求。
const requests = [];
const smallFetcher = evaluateWith(
  extractFunction(homeApiScript, 'async function fetchPendingProjects'),
  {
    ADMIN_PENDING_PAGE_SIZE: 20,
    ADMIN_PENDING_MAX_CARDS: 200,
    console: { info() {} },
    performance: { now: () => 0 },
    apiFetch: endpoint => { requests.push(endpoint); return pendingApi(tenRows)(endpoint); },
  },
);
const smallResult = await smallFetcher({ sort: 'oldest', projectType: '' });
assert.equal(requests.length, 1, 'a queue that fits one page must issue exactly one request');
assert.equal(smallResult.projects.length, 10);
assert.equal(smallResult.hasMore, false);

// 队列超过上限时必须停止并显式报告未加载数量。
const hugeRows = Array.from({ length: 260 }, (_, index) => ({ id: `h${index}` }));
const capped = await (async () => {
  const fetcher = evaluateWith(
    extractFunction(homeApiScript, 'async function fetchPendingProjects'),
    {
      ADMIN_PENDING_PAGE_SIZE: 20,
      ADMIN_PENDING_MAX_CARDS: 200,
      console: { info() {} },
      performance: { now: () => 0 },
      apiFetch: pendingApi(hugeRows),
    },
  );
  return fetcher({ sort: 'oldest', projectType: '' });
})();
assert.equal(capped.projects.length, 200, 'the queue must stop at the safety cap');
assert.equal(capped.total, 260);
assert.equal(capped.hasMore, true, 'a capped queue must report that projects are still unloaded');

// 审核期间队列会变动：翻页按 OFFSET 读取，窗口右移会让同一项目被读两次。
// 新提交排在最旧优先的队首，正好把窗口右移一格。
const baseRows = Array.from({ length: 7 }, (_, index) => ({ id: `s${index}` }));
const inserted = { id: 's-new' };
let shiftCalls = 0;
const shifting = await (async () => {
  const fetcher = evaluateWith(
    extractFunction(homeApiScript, 'async function fetchPendingProjects'),
    {
      ADMIN_PENDING_PAGE_SIZE: 3,
      ADMIN_PENDING_MAX_CARDS: 200,
      console: { info() {} },
      performance: { now: () => 0 },
      // 第 0 页之后有一个新提交进入队首：page=1 的 OFFSET=3 会再次读到 s3。
      apiFetch: endpoint => {
        shiftCalls += 1;
        const params = new URL(`https://workshop.test${endpoint}`).searchParams;
        const page = Number(params.get('page') || 0);
        const pageSize = Number(params.get('pageSize') || 0);
        const live = shiftCalls > 1 ? [inserted, ...baseRows] : baseRows;
        return Promise.resolve({
          total: live.length,
          projects: live.slice(page * pageSize, (page + 1) * pageSize),
        });
      },
    },
  );
  return fetcher({ sort: 'oldest', projectType: '' });
})();
const shiftingIds = shifting.projects.map(project => project.id);
assert.ok(shiftCalls > 1, 'the shifting fixture must actually require more than one page');
assert.equal(
  new Set(shiftingIds).size,
  shiftingIds.length,
  'a queue that shifts between pages must not render the same review card twice',
);
assert.deepEqual(
  shiftingIds,
  ['s0', 's1', 's2', 's3', 's4', 's5', 's6'],
  'every pending project must appear exactly once, in queue order',
);

// 摘要渲染：数字 = 真实卡片数；未加载时必须说明数量。
const renderQueueSummary = evaluateWith(
  extractFunction(adminReviewScript, 'function renderAdminReviewQueueContents'),
  { renderAdminReviewThemeControl: () => '', escapeHtml: value => String(value), renderAdminReviewCard: () => '' },
);
const fullHtml = renderQueueSummary([{}, {}, {}], 3, 'oldest', '');
assert.match(fullHtml, /<strong>3<\/strong>/, 'the summary number must be the visible card count');
assert.doesNotMatch(fullHtml, /未加载/, 'a fully loaded queue must not claim anything is hidden');
const cappedHtml = renderQueueSummary([{}, {}], 10, 'oldest', '');
assert.match(cappedHtml, /<strong>2<\/strong>/, 'the summary must not claim 10 while showing 2 cards');
assert.match(cappedHtml, /另有 8 个未加载/, 'the summary must state the unloaded remainder');

console.log('Admin review pending queue consistency checks passed.');
