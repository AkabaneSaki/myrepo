import assert from 'node:assert/strict';
import { File } from 'node:buffer';
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
  homeUploadPreviewScript: await evaluateStandalone('src/pages/home/upload-preview.ts', 'homeUploadPreviewScript'),
  homeReviewDiffRenderScript: await evaluateStandalone('src/pages/home/render/review-diff.ts', 'homeReviewDiffRenderScript'),
  homeLayoutRenderScript: await evaluateStandalone('src/pages/home/render/layout.ts', 'homeLayoutRenderScript'),
  homeModalsScript: await evaluateStandalone('src/pages/home/modals.ts', 'homeModalsScript'),
};

for (const [name, script] of Object.entries(fragments)) {
  assert.equal(typeof script, 'string', `${name} must evaluate to JavaScript text`);
  new Function(script);
}

const uploadPreviewUi = Function(
  'validateJsonUpload',
  'assertUploadSize',
  'File',
  `${fragments.homeUploadPreviewScript}; return { prepareRegexUploads, normalizeUploadWorldbookEntry, appendUniqueUploadFiles };`,
)(
  async file => JSON.parse(await file.text()),
  file => {
    if (Number(file?.size || 0) > 10 * 1024 * 1024) throw new Error('文件过大');
  },
  File,
);
const regexFive = new File([
  JSON.stringify(Array.from({ length: 5 }, (_, index) => ({ scriptName: `A-${index + 1}`, findRegex: 'a', replaceString: '' }))),
], 'regex-five.json', { type: 'application/json' });
const regexTwo = new File([
  JSON.stringify(Array.from({ length: 2 }, (_, index) => ({ scriptName: `B-${index + 1}`, findRegex: 'b', replaceString: '' }))),
], 'regex-two.json', { type: 'application/json' });
const appendedRegexFiles = uploadPreviewUi.appendUniqueUploadFiles([regexFive], [regexFive, regexTwo]);
assert.equal(appendedRegexFiles.length, 2);
assert.equal(appendedRegexFiles[0], regexFive);
assert.equal(appendedRegexFiles[1], regexTwo);
const mergedRegex = await uploadPreviewUi.prepareRegexUploads(appendedRegexFiles);
assert.equal(mergedRegex.groups.length, 2);
assert.equal(mergedRegex.groups[0].count, 5);
assert.equal(mergedRegex.groups[1].count, 2);
assert.equal(mergedRegex.entries.length, 7);
assert.equal(JSON.parse(await mergedRegex.uploadFile.text()).length, 7);

const fileDropUi = Function(
  'appendUniqueUploadFiles',
  `${fragments.homeModalsScript}; return { bindFileDrop };`,
)(uploadPreviewUi.appendUniqueUploadFiles);
const dropListeners = new Map();
const fakeDrop = {
  textContent: '选择正则',
  onclick: null,
  classList: { add() {}, remove() {} },
  addEventListener(type, listener) { dropListeners.set(type, listener); },
};
const fakeInput = { multiple: true, files: [regexFive], value: 'first', click() {} };
const seenSelections = [];
let latestMergedEntryCount = 0;
fileDropUi.bindFileDrop(fakeDrop, fakeInput, '选择正则', async files => {
  seenSelections.push(files);
  latestMergedEntryCount = files.length ? (await uploadPreviewUi.prepareRegexUploads(files)).entries.length : 0;
});
await fakeInput.onchange();
assert.equal(seenSelections.at(-1).length, 1);
assert.equal(latestMergedEntryCount, 5);
assert.equal(fakeInput.value, '');
fakeInput.files = [regexTwo];
fakeInput.value = 'second';
await fakeInput.onchange();
assert.equal(seenSelections.at(-1).length, 2, 'second file-picker selection must append');
assert.equal(latestMergedEntryCount, 7);
assert.equal(fakeInput._fileDropController.getFiles().length, 2);
await fakeInput._fileDropController.setFiles([regexTwo]);
assert.equal(seenSelections.at(-1).length, 1, 'removing a selected regex file must update the active selection');
assert.equal(latestMergedEntryCount, 2);
const dropEvent = { preventDefault() {}, dataTransfer: { files: [regexFive], dropEffect: '' } };
dropListeners.get('drop')(dropEvent);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(seenSelections.at(-1).length, 2, 'dropping another regex JSON must append');
assert.equal(latestMergedEntryCount, 7);
const d4PreviewEntry = uploadPreviewUi.normalizeUploadWorldbookEntry({
  comment: 'D4 entry',
  content: 'test',
  position: 4,
  depth: 6,
  role: 2,
  order: 99,
  constant: true,
}, 0);
assert.equal(d4PreviewEntry.positionType, 'at_depth');
assert.equal(d4PreviewEntry.depth, 6);
assert.equal(d4PreviewEntry.role, 'assistant');
assert.equal(d4PreviewEntry.order, 99);
assert.equal(d4PreviewEntry.constant, true);

const clientVersionSource = await readFile(resolve('../src/CreativeWorkshop/version.ts'), 'utf8');
const clientVersionMatch = clientVersionSource.match(/CREATIVE_WORKSHOP_CLIENT_VERSION\s*=\s*'([0-9]+\.[0-9]+\.[0-9]+)'/);
const advertisedVersionMatch = fragments.homeLayoutRenderScript.match(/WORKSHOP_RELEASE_VERSION = \"([0-9]+\.[0-9]+\.[0-9]+)\"/);
const advertisedImportMatch = fragments.homeLayoutRenderScript.match(/myrepo@([0-9]+\.[0-9]+\.[0-9]+)\/test-dist\/CreativeWorkshop\/index\.js/);
assert.ok(clientVersionMatch, 'Creative Workshop client self-version must be readable');
assert.ok(advertisedVersionMatch, 'Workshop advertised release version must be readable');
assert.ok(advertisedImportMatch, 'Workshop advertised release import tag must be readable');
assert.equal(advertisedVersionMatch[1], clientVersionMatch[1], 'Advertised Workshop release must match client self-version');
assert.equal(advertisedImportMatch[1], clientVersionMatch[1], 'Advertised Workshop import tag must match client self-version');

assert.match(fragments.homeModalsScript, /id=\"versionLabel\"/);
assert.match(fragments.homeModalsScript, /id=\"regexInput\" accept=\"\.json\" multiple/);
assert.doesNotMatch(fragments.homeModalsScript, /!payload\.name \|\| !fileInput\.files\[0\]/);
assert.match(fragments.homeModalsScript, /validateProjectTaxonomySelection\(payload\)/);
assert.match(fragments.homeModalsScript, /validateProjectContentSelection\(payload\.projectType, hasWorldbook, hasRegex\)/);
assert.match(fragments.homeModalsScript, /id=\"extensionType\"/);
assert.match(fragments.homeModalsScript, /data-facet-group/);
assert.match(fragments.homeModalsScript, /taxonomy-chip/);
assert.match(fragments.homeModalsScript, /preparedWorldbook = hasWorldbook \?/);
assert.match(fragments.homeModalsScript, /async function beginProjectInstall/);
assert.match(fragments.homeModalsScript, /if \(worldbookEntries\.length > 0\)/);
assert.match(fragments.homeModalsScript, /if \(regexEntries\.length > 0\)/);
assert.match(fragments.homeModalsScript, /requestInstallProject\(projectId/);
assert.match(fragments.homeModalsScript, /worldbookUploadPreview/);
assert.match(fragments.homeModalsScript, /regexUploadPreview/);
assert.match(fragments.homeModalsScript, /coverUploadPreview/);
assert.match(fragments.homeModalsScript, /_fileDropController/);
assert.match(fragments.homeModalsScript, /dragenter/);
assert.match(fragments.homeModalsScript, /data-regex-upload-remove/);
assert.match(fragments.homeUploadPreviewScript, /data-regex-upload-remove/);
assert.match(fragments.homeUploadPreviewScript, /data-upload-preview-clear/);
assert.match(fragments.homeUploadPreviewScript, /renderDetailSection\('世界书条目'/);
assert.match(fragments.homeUploadPreviewScript, /renderDetailSection\('正则列表'/);
assert.match(fragments.homeModalsScript, /审核外链/);
assert.match(fragments.homeDetailModalRenderScript, /collectProjectExternalLinks/);
assert.match(fragments.homeDetailModalRenderScript, /未访问、未验证远端内容/);
assert.match(fragments.homeDetailModalRenderScript, /角色定义前/);
assert.match(fragments.homeDetailModalRenderScript, /tag-system-ejs/);
assert.match(fragments.homeDetailModalRenderScript, /tag-system-artwork/);
assert.match(fragments.homeDetailModalRenderScript, /const tagsHtml = inspectionTagsHtml \+ creatorTagsHtml/);
assert.match(fragments.homeModalsScript, /admin-review-signal--ejs/);
assert.match(fragments.homeDetailModalRenderScript, /顺序 \${order}/);
assert.match(fragments.homeDetailModalRenderScript, /type === \"at_depth\"/);
assert.doesNotMatch(fragments.homeDetailModalRenderScript, /<span>深度 \${depth}<\/span>/);
assert.match(fragments.homeReviewDiffRenderScript, /renderWorldbookEntryBehaviorMeta/);
assert.match(fragments.homeModalsScript, /版本名称（可选）/);
assert.match(fragments.homeModalsScript, /id=\"releaseUpdateCode\"/);
assert.match(fragments.homeModalsScript, /codeField\.select\(\)/);
assert.match(fragments.homeModalsScript, /document\.execCommand\("copy"\)/);
assert.doesNotMatch(fragments.homeModalsScript, /function copyTextCompat\(text\)/);
assert.doesNotMatch(fragments.homeModalsScript, /window\.prompt\("复制最新版 Creative Workshop 导入代码"/);
assert.doesNotMatch(fragments.homeModalsScript, /versionBump|Patch|Minor|Major/);
assert.match(fragments.homeCardsRenderScript, /撤回更新/);
assert.doesNotMatch(fragments.homeCardsRenderScript, /tag-system-ejs/);
assert.match(fragments.homeCardsRenderScript, /card-artwork-badge/);
assert.match(fragments.homeCardsRenderScript, /getProjectDisplayTags\(project\)/);
assert.match(fragments.homeModalsScript, /data-display-tag/);
assert.match(fragments.homeModalsScript, /首页展示标签最多/);
assert.match(fragments.homeModalsScript, /normalizeCustomTagsInput/);
assert.match(fragments.homeCardsRenderScript, /fa-images/);
assert.doesNotMatch(fragments.homeCardsRenderScript, /creatorTagsHtml/);
assert.match(fragments.homeCardsRenderScript, /getProjectTypeDisplayLabel\(project\)/);
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
  'getProjectTypeDisplayLabel',
  'getAuthorName',
  'getAuthorAvatar',
  'isProjectEditable',
  'isProjectPending',
  'isRejectedDraft',
  'getProjectReviewBadge',
  'getProjectRejectReason',
  'formatDate',
  'getProjectPublishedAt',
  'getProjectDisplayTags',
  'PROJECT_TAXONOMY',
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
  project => Array.isArray(project.displayTags) ? project.displayTags : [],
  { systemSignals: { ejs: { label: 'EJS', card: false }, characterArtwork: { label: '有角色立绘', card: true } }, display: { cardCustomTags: true } },
);
const displayTagCardHtml = cardRenderUi.renderProjectCard({ id: 'display-tags', name: 'Display Tags', version: '1.0.0', versionLabel: null, displayTags: ['人鱼', '纯爱'], hasCharacterArtwork: true, tags: [], downloadsCount: 0 });
assert.match(displayTagCardHtml, />人鱼<\/span>/);
assert.match(displayTagCardHtml, />纯爱<\/span>/);
assert.match(displayTagCardHtml, /card-cover[^>]*>.*card-artwork-badge/);
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
  'PROJECT_TAXONOMY',
  `${fragments.homeUtilsScript}\n${fragments.homeModalsScript}; return { buildProjectFormHtml };`,
)({
  extensionTypes: ['规则', '内容'],
  characterFacets: { 种族: ['人类'], 身份: ['法师'] },
  maxCustomTags: 4,
});
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
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.14'), false);
versionState.tavern.clientVersionResolved = true;
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.14'), true);
versionState.tavern.clientVersion = '2.0.12';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.14'), true);
versionState.tavern.clientVersion = '2.0.13';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.14'), true);
versionState.tavern.clientVersion = '2.0.14';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.14'), false);
versionState.tavern.clientVersion = '2.0.15';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.14'), false);
versionState.tavern.clientVersion = 'not-a-version';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice('2.0.14'), true);
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
const testProjectContentPolicy = {
  系统核心: { required: ['worldbook'], anyOf: [] },
  角色: { required: ['worldbook'], anyOf: [] },
  事件: { required: ['worldbook'], anyOf: [] },
  扩展: { required: [], anyOf: ['worldbook', 'regex'] },
};
const testProjectTaxonomy = {
  projectTypes: ['事件', '系统核心', '角色', '扩展'],
  extensionTypes: ['规则', '内容'],
  characterFacets: { 种族: ['人类'], 身份: ['法师'] },
  maxCustomTags: 4,
};
const homeScript = Function(...fragmentNames, 'projectContentPolicyJson', 'projectTaxonomyJson', `return (${appExpression});`)(
  ...Object.values(fragments),
  JSON.stringify(testProjectContentPolicy),
  JSON.stringify(testProjectTaxonomy),
);
assert.equal(typeof homeScript, 'string');
new Function(homeScript);
const contentPolicyUi = Function(
  'PROJECT_CONTENT_POLICY',
  `${fragments.homeModalsScript}; return { validateProjectContentSelection, getProjectContentRequirementText };`,
)(testProjectContentPolicy);
assert.equal(contentPolicyUi.validateProjectContentSelection('扩展', false, true).valid, true);
assert.equal(contentPolicyUi.validateProjectContentSelection('扩展', true, false).valid, true);
assert.equal(contentPolicyUi.validateProjectContentSelection('系统', false, true).valid, false);
assert.equal(contentPolicyUi.validateProjectContentSelection('角色', false, true).valid, false);
assert.equal(contentPolicyUi.validateProjectContentSelection('事件', false, true).valid, false);
assert.match(contentPolicyUi.getProjectContentRequirementText('扩展'), /世界书或正则至少一种/);
assert.match(homeScript, /reviewProject\(project\.id, \{ action,/);
assert.match(homeScript, /expectedRevision: project\?\.draftRevision \|\| reviewProjectData\?\.draftRevision/);
assert.match(homeScript, /确定撤回这次更新吗/);
assert.match(homeScript, /正在审核\/被退回的更新草稿也会一并删除/);
assert.match(homeScript, /document\.querySelectorAll\('\.project-card'\)/);
assert.match(homeScript, /document\.querySelectorAll\('\.delete-project-btn'\)/);
assert.doesNotMatch(homeScript, /document\.querySelectorAll\('\.detail-btn'\)/);

console.log('assembled /assets/home.js syntax smoke: ok');
