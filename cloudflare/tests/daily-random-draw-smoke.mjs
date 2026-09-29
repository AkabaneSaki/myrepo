import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const [
  endpointSource,
  migrationSource,
  schemaSource,
  dailyRandomUiSource,
  layoutSource,
  detailSource,
  appSource,
  rankingSource,
  categoryIndexMigration,
] = await Promise.all([
  readFile(new URL('../src/endpoints/projects/random.ts', import.meta.url), 'utf8'),
  readFile(new URL('../migrations/0027_daily_random_draw.sql', import.meta.url), 'utf8'),
  readFile(new URL('../schema.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/home/daily-random.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/home/render/layout.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/home/modal/project-detail.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/home/app.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/utils/project-daily-rankings.ts', import.meta.url), 'utf8'),
  readFile(new URL('../migrations/0030_daily_random_project_type_index.sql', import.meta.url), 'utf8'),
]);

assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS daily_random_draw_state/);
assert.match(migrationSource, /user_id TEXT PRIMARY KEY/);
assert.match(migrationSource, /daily_count INTEGER NOT NULL DEFAULT 0 CHECK \(daily_count BETWEEN 0 AND 10\)/);
assert.match(migrationSource, /recent_project_ids TEXT NOT NULL DEFAULT '\[\]'/);
assert.doesNotMatch(migrationSource, /DELETE FROM project_daily_rankings|DELETE FROM project_ranking_builds/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS daily_random_draw_state/);
assert.match(categoryIndexMigration, /ON projects\(project_type, id\)[\s\S]*WHERE status = 'approved' AND is_published = 1 AND visibility = 1/);
assert.match(schemaSource, /CREATE INDEX IF NOT EXISTS idx_projects_public_type_id/);

assert.match(endpointSource, /const DAILY_DRAW_LIMIT = 10/);
assert.match(endpointSource, /const RECENT_DRAW_LIMIT = 20/);
assert.match(endpointSource, /const DAILY_RESET_HOUR = 5/);
assert.match(endpointSource, /UTC8_OFFSET_MS = 8 \* 60 \* 60 \* 1000/);
assert.match(endpointSource, /installedProjectIds/);
assert.match(endpointSource, /discoverProjectIds/);
assert.match(endpointSource, /\.\.\.status\.recentProjectIds/);
assert.match(endpointSource, /RECENT_DRAW_LIMIT \+ 1/);
assert.match(endpointSource, /\.slice\(-RECENT_DRAW_LIMIT\)/);
assert.match(endpointSource, /projectType: z\.enum\(PROJECT_TYPES\)\.optional\(\)/);
assert.match(endpointSource, /projectType \? 'idx_projects_public_type_id' : 'idx_projects_public_id'/);
assert.match(endpointSource, /p\.project_type = \?/);
assert.match(endpointSource, /crypto\.randomUUID\(\)/);
assert.match(endpointSource, /INSERT OR IGNORE INTO daily_random_draw_state/);
assert.match(endpointSource, /UPDATE daily_random_draw_state/);
assert.doesNotMatch(endpointSource, /ORDER BY RANDOM\s*\(/i);
assert.doesNotMatch(endpointSource, /download_history|acquisition_history|user_project_library/i);

assert.match(dailyRandomUiSource, /isEmbedded[\s\S]*state\.currentUser[\s\S]*state\.tavern\.connected[\s\S]*state\.tavern\.installedProjectsLoaded/);
assert.match(dailyRandomUiSource, /state\.discoverShelves\?\.discover/);
assert.match(dailyRandomUiSource, /每日抽卡（/);
assert.match(dailyRandomUiSource, /回到首页/);
assert.match(dailyRandomUiSource, /再抽一个（今日剩余/);
assert.match(dailyRandomUiSource, /showProjectDetail\(\{ id: projectId \}, \{ dailyRandomDraw: true \}\)/);
assert.match(dailyRandomUiSource, /projectType: state\.activeBaseTag/);
assert.match(layoutSource, /catalogDraw[\s\S]*renderDailyRandomDrawEntry/);
const detailActionsStart = dailyRandomUiSource.indexOf('function attachDailyRandomDrawControls(overlay)');
const detailActionsEnd = dailyRandomUiSource.indexOf('function bindDailyRandomDrawEntry()', detailActionsStart);
assert.ok(detailActionsStart >= 0 && detailActionsEnd > detailActionsStart);
const detailActionsSource = dailyRandomUiSource.slice(detailActionsStart, detailActionsEnd);
assert.match(detailActionsSource, /if \(!overlay\?\.isConnected\) return/);
assert.doesNotMatch(detailActionsSource, /canUseDailyRandomDraw\(\)/, 'draw-origin detail footer must not depend on homepage Discover readiness');
assert.match(layoutSource, /renderDailyRandomDrawEntry\(\)/);
assert.match(detailSource, /showProjectDetail\(project, options = \{\}\)/);
assert.match(detailSource, /options\?\.dailyRandomDraw[\s\S]*attachDailyRandomDrawControls/);
assert.match(appSource, /homeDailyRandomDrawScript/);

// Daily draw must not inflate the existing 6-hour Discover ranking board.
assert.match(rankingSource, /const DISCOVERY_PICK_COUNT = 10/);
assert.match(rankingSource, /\.slice\(0, DISCOVERY_PICK_COUNT\)/);

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    project_type TEXT NOT NULL,
    status TEXT NOT NULL,
    is_published INTEGER NOT NULL,
    visibility INTEGER NOT NULL
  );
  CREATE INDEX idx_projects_public_id
    ON projects(id)
    WHERE status = 'approved' AND is_published = 1 AND visibility = 1;
  CREATE INDEX idx_projects_public_type_id
    ON projects(project_type, id)
    WHERE status = 'approved' AND is_published = 1 AND visibility = 1;
`);

const plan = db.prepare(`
  EXPLAIN QUERY PLAN
  SELECT p.id
  FROM projects p INDEXED BY idx_projects_public_id
  WHERE p.status = 'approved'
    AND p.is_published = 1
    AND p.visibility = 1
    AND p.id >= ?
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(?) excluded
      WHERE excluded.value = p.id
    )
  ORDER BY p.id ASC
  LIMIT 1
`).all('80000000-0000-4000-8000-000000000000', '[]');

const planDetail = plan.map(row => String(row.detail || '')).join(' | ');
assert.match(planDetail, /SEARCH p USING INDEX idx_projects_public_id \(id>\?\)/);
assert.doesNotMatch(planDetail, /SCAN p(?:\s|$)/);
assert.doesNotMatch(planDetail, /USE TEMP B-TREE FOR ORDER BY/);

const categoryPlan = db.prepare(`
  EXPLAIN QUERY PLAN
  SELECT p.id
  FROM projects p INDEXED BY idx_projects_public_type_id
  WHERE p.status = 'approved'
    AND p.is_published = 1
    AND p.visibility = 1
    AND p.project_type = ?
    AND p.id >= ?
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(?) excluded
      WHERE excluded.value = p.id
    )
  ORDER BY p.id ASC
  LIMIT 1
`).all('角色', '80000000-0000-4000-8000-000000000000', '[]');
const categoryPlanDetail = categoryPlan.map(row => String(row.detail || '')).join(' | ');
assert.match(categoryPlanDetail, /SEARCH p USING INDEX idx_projects_public_type_id \(project_type=\? AND id>\?\)/);
assert.doesNotMatch(categoryPlanDetail, /SCAN p(?:\s|$)/);
assert.doesNotMatch(categoryPlanDetail, /USE TEMP B-TREE FOR ORDER BY/);

db.exec(`
  INSERT INTO projects VALUES
    ('100', '事件', 'approved', 1, 1),
    ('200', '角色', 'approved', 1, 1),
    ('300', '角色', 'approved', 1, 1),
    ('400', '角色', 'pending', 1, 1);
`);
const pickCategoryProject = db.prepare(`
  SELECT p.id
  FROM projects p INDEXED BY idx_projects_public_type_id
  WHERE p.status = 'approved'
    AND p.is_published = 1
    AND p.visibility = 1
    AND p.project_type = ?
    AND p.id >= ?
    AND NOT EXISTS (
      SELECT 1 FROM json_each(?) excluded WHERE excluded.value = p.id
    )
  ORDER BY p.id ASC
  LIMIT 1
`);
assert.equal(pickCategoryProject.get('角色', '100', '[]')?.id, '200');
assert.equal(pickCategoryProject.get('角色', '100', '["200"]')?.id, '300');
assert.equal(pickCategoryProject.get('角色', '350', '[]'), undefined);
db.close();

console.log('daily random draw smoke: ok');
