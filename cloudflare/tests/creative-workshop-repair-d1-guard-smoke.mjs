import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const apiSource = await readFile(new URL('../src/pages/home/api.ts', import.meta.url), 'utf8');
const repairUiSource = await readFile(new URL('../src/pages/home/repair-ui.ts', import.meta.url), 'utf8');
const projectsSource = await readFile(new URL('../src/endpoints/projects.ts', import.meta.url), 'utf8');
const dbSource = await readFile(new URL('../src/utils/db.ts', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
const migrationSource = await readFile(new URL('../migrations/0017_repair_resolve_guard.sql', import.meta.url), 'utf8');

assert.match(indexSource, /post\('\/api\/projects\/repair-resolve', ProjectRepairResolve\)/);
assert.match(projectsSource, /REPAIR_RESOLVE_DAILY_LIMIT = 40/);
assert.match(projectsSource, /REPAIR_DAILY_LOCK_MESSAGE = '好啦別再点了喵！截图然后去DC找我吧喵！'/);
assert.match(projectsSource, /code: 'REPAIR_DAILY_LOCKED'/);

const resolverStart = dbSource.indexOf('resolvePublicRepairCandidates: async');
assert.ok(resolverStart >= 0, 'repair DB resolver must exist');
const resolverEnd = dbSource.indexOf('\n  update: async (', resolverStart);
assert.ok(resolverEnd > resolverStart, 'repair DB resolver block must be bounded');
const resolverBlock = dbSource.slice(resolverStart, resolverEnd);
assert.doesNotMatch(resolverBlock, /\bLIKE\b/i, 'automatic repair resolver must not use LIKE');
assert.match(resolverBlock, /INDEXED BY idx_projects_public_id/);
assert.match(resolverBlock, /INDEXED BY idx_projects_public_normalized_name/);
assert.match(migrationSource, /idx_projects_public_id/);
assert.match(migrationSource, /idx_projects_public_normalized_name/);

assert.match(apiSource, /apiFetch\('\/api\/projects\/repair-resolve'/);
assert.match(apiSource, /REPAIR_RESOLVE_CACHE_TTL_MS = 5 \* 60 \* 1000/);
assert.match(apiSource, /REPAIR_RESOLVE_LOCK_STORAGE_PREFIX/);
assert.match(apiSource, /state\.currentUser\?\.id \|\| 'anonymous'/);

const autoMatchStart = apiSource.indexOf("async function findWorkshopProjectsForRepair(candidate, manualQuery = '')");
const autoMatchEnd = apiSource.indexOf('\nasync function fetchInstalledProjectDetails', autoMatchStart);
assert.ok(autoMatchStart >= 0 && autoMatchEnd > autoMatchStart, 'repair auto match function must exist');
const autoMatchBlock = apiSource.slice(autoMatchStart, autoMatchEnd);
const manualBranchEnd = autoMatchBlock.indexOf("\n  const detectedProjectId");
const manualBranch = autoMatchBlock.slice(0, manualBranchEnd);
const automaticBranch = autoMatchBlock.slice(manualBranchEnd);
assert.match(manualBranch, /searchWorkshopProjectsByName\(manualQuery\)/);
assert.doesNotMatch(automaticBranch, /searchWorkshopProjectsByName/, 'automatic repair identity matching must not call public fuzzy search');
assert.match(automaticBranch, /resolveWorkshopRepairCandidates/);

assert.doesNotMatch(
  repairUiSource,
  /Promise\.all\(selected\.map\(item => analyzeDlcRepairItem/,
  'Select All must not fan out one resolver request per candidate',
);
assert.match(repairUiSource, /const resolved = await resolveWorkshopRepairCandidates\(requests\)/);
assert.match(repairUiSource, /repairLocked \? 'disabled' : ''/);
assert.match(repairUiSource, /REPAIR_DAILY_LOCK_MESSAGE/);

console.log('CreativeWorkshop repair D1 guard smoke: ok');
