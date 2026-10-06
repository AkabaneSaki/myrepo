import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeProjectVersionBase } from '../src/utils/version.js';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

const [
  readEndpoint,
  repairEndpoint,
  socialEndpoint,
  recommendationsEndpoint,
  apiScript,
  authFlow,
  bridgeScript,
  installModal,
  actionsScript,
  detailModal,
  updateModal,
  repairUi,
  updateCenter,
  hostSource,
  worldbookSource,
  repairSource,
] = await Promise.all([
  read('src/endpoints/projects/read.ts'),
  read('src/endpoints/projects/repair.ts'),
  read('src/endpoints/projects/social.ts'),
  read('src/endpoints/recommendations.ts'),
  read('src/pages/home/api.ts'),
  read('src/pages/home/app/auth-flow.ts'),
  read('src/pages/home/tavern-bridge.ts'),
  read('src/pages/home/modal/project-install.ts'),
  read('src/pages/home/app/actions.ts'),
  read('src/pages/home/modal/project-detail.ts'),
  read('src/pages/home/modal/project-update.ts'),
  read('src/pages/home/repair-ui.ts'),
  read('src/pages/home/update-center.ts'),
  read('../src/CreativeWorkshop/bridge/host.ts'),
  read('../src/CreativeWorkshop/services/worldbook.ts'),
  read('../src/CreativeWorkshop/services/repair.ts'),
]);

assert.match(readEndpoint, /export class ProjectInstallInfo/);
assert.match(readEndpoint, /if \(!payload\) return c\.json\(\{ error: '请先 Discord 登录后再下载 \/ 安装 DLC' \}, 401\)/);
assert.match(readEndpoint, /SELECT id, version, download_url, author_id, status, is_published, visibility/);
assert.match(readEndpoint, /downloadUrl: null/g);
assert.match(readEndpoint, /r2Storage\.getProxyUrl/);
assert.match(readEndpoint, /const currentVersion = normalizeProjectVersionBase\(project\.version\)/);
assert.match(readEndpoint, /const latestVersion = normalizeProjectVersionBase\(row\.version\)/);
assert.equal(normalizeProjectVersionBase('4.3'), '1.0.0');

const installInfoStart = readEndpoint.indexOf('export class ProjectInstallInfo');
const projectFetchStart = readEndpoint.indexOf('export class ProjectFetch', installInfoStart);
const installInfoSource = readEndpoint.slice(installInfoStart, projectFetchStart);
assert.ok(installInfoStart >= 0 && projectFetchStart > installInfoStart);
assert.doesNotMatch(installInfoSource, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
assert.doesNotMatch(installInfoSource, /project_likes|project_subscribes|download_history|acquisition/i);

assert.match(repairEndpoint, /safeById = resolved\.byId\.map\(project => \(\{ \.\.\.project, downloadUrl: null \}\)\)/);
assert.match(recommendationsEndpoint, /parseProjectRow\(row\), downloadUrl: null/);

assert.match(apiScript, /fetchProjectInstallInfo/);
assert.match(apiScript, /\/install-info/);
assert.match(authFlow, /requireDiscordLoginForDownload/);
assert.match(installModal, /requireDiscordLoginForDownload\(\"安装 DLC\"\)/);
assert.match(actionsScript, /requireDiscordLoginForDownload\('更新 DLC'\)/);
assert.match(detailModal, /requireDiscordLoginForDownload\(\"更新 DLC\"\)/);
assert.match(repairUi, /requireDiscordLoginForDownload\('修复 DLC'\)/);
assert.match(updateCenter, /requireDiscordLoginForDownload\('更新 DLC'\)/);

assert.match(bridgeScript, /fetchProjectInstallInfo\(projectId, selection\?\.projectVersion \|\| null\)/);
assert.match(bridgeScript, /downloadUrl: installInfo\.downloadUrl/);
assert.match(bridgeScript, /fetchProjectInstallInfo\(projectId, projectVersion\)/);
assert.match(bridgeScript, /fetchProjectInstallInfo\(projectId\)/);
assert.doesNotMatch(bridgeScript, /syncInstallSubscription|已自动订阅更新|已取消更新订阅/);
assert.doesNotMatch(detailModal, /ratingNeedsInstallRepair|setProjectSubscription\(detailProject\.id, true\)/);

const ratingSetStart = socialEndpoint.indexOf('export class ProjectRatingSet');
const likeToggleStart = socialEndpoint.indexOf('export class ProjectLikeToggle', ratingSetStart);
const ratingSetSource = socialEndpoint.slice(ratingSetStart, likeToggleStart);
assert.ok(ratingSetStart >= 0 && likeToggleStart > ratingSetStart);
assert.match(ratingSetSource, /if \(!payload\) return c\.json\(\{ error: '请先登录' \}, 401\)/);
assert.doesNotMatch(ratingSetSource, /project_subscribes|安装这个 DLC 后才能评分/);
assert.doesNotMatch(readEndpoint, /AS installed\s*\n\s*`/);
assert.match(updateModal, /await confirmProjectUpdate/);

assert.match(hostSource, /payload\?\.downloadUrl/);
assert.match(worldbookSource, /downloadUrlOverride\?: string/);
assert.match(worldbookSource, /downloadUrl: downloadUrlOverride/);
assert.match(repairSource, /downloadUrl\?: string \| null/);

const allSources = [
  readEndpoint,
  repairEndpoint,
  recommendationsEndpoint,
  apiScript,
  authFlow,
  bridgeScript,
  installModal,
  actionsScript,
  detailModal,
  updateModal,
  repairUi,
  updateCenter,
  hostSource,
  worldbookSource,
  repairSource,
].join('\n');
assert.doesNotMatch(allSources, /user_project_library|acquisition_history|download_history/);

console.log('Discord-gated download smoke: ok');
