import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function readExportExpression(relativePath, exportName) {
  const source = await readFile(resolve(relativePath), 'utf8');
  const marker = `export const ${exportName} = `;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${exportName} in ${relativePath}`);
  const raw = source.slice(start + marker.length).trim();
  const expression = raw.endsWith(';') ? raw.slice(0, -1) : raw;
  return expression;
}

async function evaluateStandalone(relativePath, exportName) {
  const expression = await readExportExpression(relativePath, exportName);
  return Function(`return (${expression});`)();
}

const fragments = {
  homeStateScript: await evaluateStandalone('src/pages/home/state.ts', 'homeStateScript'),
  homeUtilsScript: await evaluateStandalone('src/pages/home/utils.ts', 'homeUtilsScript'),
  homeTavernBridgeScript: await evaluateStandalone('src/pages/home/tavern-bridge.ts', 'homeTavernBridgeScript'),
  homeApiScript: await evaluateStandalone('src/pages/home/api.ts', 'homeApiScript'),
  homeCardsRenderScript: await evaluateStandalone('src/pages/home/render/cards.ts', 'homeCardsRenderScript'),
  homeDetailModalRenderScript: await evaluateStandalone('src/pages/home/render/detail-modal.ts', 'homeDetailModalRenderScript'),
  homeLayoutRenderScript: await evaluateStandalone('src/pages/home/render/layout.ts', 'homeLayoutRenderScript'),
  homeModalsScript: await evaluateStandalone('src/pages/home/modals.ts', 'homeModalsScript'),
};

for (const [name, script] of Object.entries(fragments)) {
  assert.equal(typeof script, 'string', `${name} must evaluate to JavaScript text`);
  new Function(script);
}

assert.match(fragments.homeModalsScript, /id=\"versionLabel\"/);
assert.match(fragments.homeModalsScript, /版本名称（可选）/);
assert.doesNotMatch(fragments.homeModalsScript, /versionBump|Patch|Minor|Major/);
assert.match(fragments.homeCardsRenderScript, /撤回更新/);
assert.match(fragments.homeCardsRenderScript, /delete-project-btn/);
assert.match(fragments.homeCardsRenderScript, /editButtonHtml = isReviewDraftProject && isPendingProject/);
assert.match(fragments.homeCardsRenderScript, /role=\"button\" tabindex=\"0\"/);
assert.doesNotMatch(fragments.homeCardsRenderScript, /detail-btn/);
assert.doesNotMatch(fragments.homeCardsRenderScript, /审核中的项目暂不可删除/);

const cardViewModelUi = Function(
  'getLikeState',
  'getLocalProjectMeta',
  'getLegacyInstalledProjectMatches',
  'getProjectPendingAction',
  'state',
  'escapeHtml',
  `${fragments.homeCardsRenderScript}; return { buildProjectCardViewModel };`,
)(
  () => ({ liked: false, count: 0 }),
  () => null,
  () => [],
  () => null,
  { tavern: { connected: false, installedProjectsLoaded: false } },
  value => String(value),
);
assert.equal(
  cardViewModelUi.buildProjectCardViewModel({ id: 'legacy', version: '1.2.3', versionLabel: null }).versionHtml,
  '<span>1.2.3</span>',
);
assert.equal(
  cardViewModelUi.buildProjectCardViewModel({ id: 'labeled', version: '1.2.3', versionLabel: '夏季版' }).versionHtml,
  '<span>夏季版</span>',
);
const cardRenderUi = Function(
  'getLikeState',
  'getLocalProjectMeta',
  'getLegacyInstalledProjectMatches',
  'getProjectPendingAction',
  'state',
  'escapeHtml',
  'getCoverImageSources',
  'getTypeClass',
  'getBaseTag',
  'getAuthorName',
  'getAuthorAvatar',
  'isProjectEditable',
  'isProjectPending',
  'isRejectedDraft',
  'getProjectReviewBadge',
  'getProjectRejectReason',
  'formatDate',
  'getProjectPublishedAt',
  `${fragments.homeCardsRenderScript}; return { renderProjectCard };`,
)(
  () => ({ liked: false, count: 0 }),
  () => null,
  () => [],
  () => null,
  { tavern: { connected: false, installedProjectsLoaded: false }, currentUser: null },
  value => String(value),
  () => ({ primary: 'cover', fallback: 'fallback', placeholder: 'placeholder', authenticated: '' }),
  () => 'extension',
  () => '扩展',
  () => 'Author',
  () => 'avatar',
  () => false,
  () => false,
  () => false,
  () => '',
  () => '',
  value => String(value),
  () => '2026/9/6',
);
const legacyCardHtml = cardRenderUi.renderProjectCard({ id: 'legacy', name: 'Legacy', version: '1.2.3', versionLabel: null, tags: [], downloadsCount: 0 });
assert.match(legacyCardHtml, /card-meta card-meta--version"><span>1\.2\.3<\/span> <span>2026\/9\/6<\/span>/);
const labeledCardHtml = cardRenderUi.renderProjectCard({ id: 'labeled', name: 'Labeled', version: '1.2.3', versionLabel: '夏季版', tags: [], downloadsCount: 0 });
assert.match(labeledCardHtml, /card-meta card-meta--version"><span>夏季版<\/span> <span>2026\/9\/6<\/span>/);

const createLegacyIdentityUi = () => Function(
  `${fragments.homeStateScript}; return { state, setProjectsPage, setInstalledProjects, getLocalProjectMeta, getLegacyInstalledProjectMatches };`,
)();
const legacyIdentityUi = createLegacyIdentityUi();
const canonicalProjectId = '11111111-1111-4111-8111-111111111111';
legacyIdentityUi.setInstalledProjects([{
  projectId: '旧工坊项目',
  name: '旧工坊项目',
  legacyProjectName: '旧工坊项目',
  localVersion: null,
  entryCount: 2,
  regexCount: 1,
}]);
legacyIdentityUi.setProjectsPage({
  projects: [{ id: canonicalProjectId, name: '旧工坊项目' }],
  append: false,
  page: 0,
  pageSize: 50,
  hasMore: false,
});
assert.equal(legacyIdentityUi.getLocalProjectMeta(canonicalProjectId)?.legacyProjectName, '旧工坊项目');
assert.equal(legacyIdentityUi.getLocalProjectMeta('旧工坊项目'), null);

const ambiguousLegacyUi = createLegacyIdentityUi();
ambiguousLegacyUi.setInstalledProjects([{
  projectId: '同名旧项目',
  name: '同名旧项目',
  legacyProjectName: '同名旧项目',
  localVersion: null,
  entryCount: 1,
  regexCount: 0,
}]);
ambiguousLegacyUi.setProjectsPage({
  projects: [
    { id: '22222222-2222-4222-8222-222222222222', name: '同名旧项目' },
    { id: '33333333-3333-4333-8333-333333333333', name: '同名旧项目' },
  ],
  append: false,
  page: 0,
  pageSize: 50,
  hasMore: false,
});
assert.equal(ambiguousLegacyUi.getLocalProjectMeta('同名旧项目')?.legacyProjectName, '同名旧项目');
assert.equal(
  ambiguousLegacyUi.getLegacyInstalledProjectMatches({ id: '22222222-2222-4222-8222-222222222222', name: '同名旧项目' }).length,
  1,
);

const installedRemoteUi = Function(
  `${fragments.homeStateScript}; return { state, setProjectsPage, setInstalledProjects, mergeInstalledRemoteProjects, mergeProjectsForInstalledView };`,
)();
const installedRemoteProjectId = '328361a6-7479-400d-8e5b-a1a8dc73cea5';
installedRemoteUi.setProjectsPage({
  projects: [{ id: canonicalProjectId, name: '其他项目' }],
  append: false,
  page: 0,
  pageSize: 50,
  hasMore: true,
});
installedRemoteUi.setInstalledProjects([{
  projectId: installedRemoteProjectId,
  name: '灰风',
  localVersion: '1.0.0',
  entryCount: 1,
  regexCount: 0,
}]);
installedRemoteUi.mergeInstalledRemoteProjects([{
  id: installedRemoteProjectId,
  name: '灰风',
  version: '1.0.0',
  authorName: '莱卡',
  coverImage: 'remote-cover.png',
  tags: ['角色'],
}]);
installedRemoteUi.state.tavern.connected = true;
installedRemoteUi.state.showSubscribedAndInstalledProjects = true;
const installedRemoteProjects = installedRemoteUi.mergeProjectsForInstalledView(installedRemoteUi.state.projects);
const hydratedInstalledRemoteProject = installedRemoteProjects.find(project => project.id === installedRemoteProjectId);
assert.ok(hydratedInstalledRemoteProject);
assert.equal(hydratedInstalledRemoteProject.authorName, '莱卡');
assert.equal(hydratedInstalledRemoteProject.coverImage, 'remote-cover.png');
assert.notEqual(hydratedInstalledRemoteProject.source, 'local-only');

const migratedCardUi = Function(
  'getLikeState',
  'getLocalProjectMeta',
  'getLegacyInstalledProjectMatches',
  'getProjectPendingAction',
  'state',
  'escapeHtml',
  `${fragments.homeCardsRenderScript}; return { buildProjectCardViewModel };`,
)(
  () => ({ liked: false, count: 0 }),
  () => ({ projectId: canonicalProjectId, legacyProjectName: '旧工坊项目', localVersion: null }),
  () => [],
  () => null,
  { tavern: { connected: true, installedProjectsLoaded: true } },
  value => String(value),
);
assert.equal(
  migratedCardUi.buildProjectCardViewModel({ id: canonicalProjectId, name: '旧工坊项目', version: '2.0.0' }).canUpdate,
  true,
);

const legacyConflictView = Function(
  'getLikeState',
  'getLocalProjectMeta',
  'getLegacyInstalledProjectMatches',
  'getProjectPendingAction',
  'state',
  'escapeHtml',
  `${fragments.homeCardsRenderScript}; return { buildProjectCardViewModel };`,
)(
  () => ({ liked: false, count: 0 }),
  () => null,
  () => [{}],
  () => null,
  { tavern: { connected: true, installedProjectsLoaded: true } },
  value => String(value),
);
const legacyConflictCard = legacyConflictView.buildProjectCardViewModel({ id: 'remote', name: '同名旧项目', version: '2.0.0' });
assert.equal(legacyConflictCard.installDisabled, true);
assert.equal(legacyConflictCard.installText, '旧版安装待识别');

const projectFormUi = Function(
  `${fragments.homeUtilsScript}\n${fragments.homeModalsScript}; return { buildProjectFormHtml };`,
)();
const createProjectFormHtml = projectFormUi.buildProjectFormHtml('create');
assert.match(createProjectFormHtml, /id="projectForm"/);
assert.match(createProjectFormHtml, /id="fileInput"/);
assert.match(createProjectFormHtml, /id="versionLabel"/);

const versionState = { tavern: { clientVersion: null, clientVersionResolved: false } };
const workshopVersionUi = Function(
  'state',
  `${fragments.homeUtilsScript}; return { parseWorkshopVersion, compareWorkshopVersions, shouldShowWorkshopReleaseNotice };`,
)(versionState);
assert.deepEqual(workshopVersionUi.parseWorkshopVersion('2.0.13'), [2, 0, 13]);
assert.deepEqual(workshopVersionUi.parseWorkshopVersion('v2.0.13'), [2, 0, 13]);
assert.equal(workshopVersionUi.parseWorkshopVersion('2.0'), null);
assert.equal(workshopVersionUi.parseWorkshopVersion('latest'), null);
assert.equal(workshopVersionUi.compareWorkshopVersions('2.0.12', '2.0.13'), -1);
assert.equal(workshopVersionUi.compareWorkshopVersions('2.0.13', '2.0.13'), 0);
assert.equal(workshopVersionUi.compareWorkshopVersions('2.0.14', '2.0.13'), 1);
assert.equal(workshopVersionUi.compareWorkshopVersions('2.0.9', '2.0.12'), -1);
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.13'), false);
versionState.tavern.clientVersionResolved = true;
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.13'), true);
versionState.tavern.clientVersion = '2.0.12';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.13'), true);
versionState.tavern.clientVersion = '2.0.13';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.13'), false);
versionState.tavern.clientVersion = '2.0.14';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.13'), false);
versionState.tavern.clientVersion = 'not-a-version';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.13'), true);
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('broken-release'), false);

const dateUi = Function(`${fragments.homeUtilsScript}; return { getProjectPublishedAt };`)();
assert.equal(dateUi.getProjectPublishedAt({ latestApprovedAt: '2026-09-04', reviewedAt: '2026-09-03', createdAt: '2026-09-02' }), '2026-09-04');
assert.equal(dateUi.getProjectPublishedAt({ reviewedAt: '2026-09-03', createdAt: '2026-09-02' }), '2026-09-02');
assert.equal(dateUi.getProjectPublishedAt({ createdAt: '2026-09-02' }), '2026-09-02');

const appSource = await readFile(resolve('src/pages/home/app.ts'), 'utf8');
const withoutImports = appSource.replace(/^import .*;\r?\n/gm, '');
const marker = 'export const homeScript = ';
const start = withoutImports.indexOf(marker);
assert.notEqual(start, -1, 'Missing homeScript export');
const rawAppExpression = withoutImports.slice(start + marker.length).trim();
const appExpression = rawAppExpression.endsWith(';') ? rawAppExpression.slice(0, -1) : rawAppExpression;
const fragmentNames = Object.keys(fragments);
const homeScript = Function(...fragmentNames, `return (${appExpression});`)(...Object.values(fragments));
assert.equal(typeof homeScript, 'string');
new Function(homeScript);
assert.match(homeScript, /reviewProject\(projectId, \{ action, expectedRevision: project\?\.draftRevision \}\)/);
assert.match(homeScript, /reviewProject\(projectId, \{ action, rejectReason: reason, expectedRevision: project\?\.draftRevision \}\)/);
assert.match(homeScript, /确定撤回这次更新吗/);
assert.match(homeScript, /正在审核\/被退回的更新草稿也会一并删除/);
assert.match(homeScript, /document\.querySelectorAll\('\.project-card'\)/);
assert.match(homeScript, /document\.querySelectorAll\('\.delete-project-btn'\)/);
assert.doesNotMatch(homeScript, /document\.querySelectorAll\('\.detail-btn'\)/);

console.log('assembled /assets/home.js syntax smoke: ok');
