import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CHECKER_LIMITS } from '../src/utils/ejs-checker/limits.mjs';

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

const homeAppSource = (await Promise.all([
  'src/pages/home/app.ts',
  'src/pages/home/app/auth-flow.ts',
  'src/pages/home/app/actions.ts',
  'src/pages/home/app/bootstrap.ts',
].map(path => readFile(resolve(path), 'utf8')))).join('\n');
const homePageSource = await readFile(resolve('src/pages/home.ts'), 'utf8');
const homeStylesSource = await readFile(resolve('src/pages/home/styles.ts'), 'utf8');
const recommendationsEndpointSource = await readFile(resolve('src/endpoints/recommendations.ts'), 'utf8');
const indexSource = await readFile(resolve('src/index.ts'), 'utf8');
const projectReadEndpointSource = await readFile(resolve('src/endpoints/projects/read.ts'), 'utf8');
const fragments = {
  homeStateScript: await evaluateStandalone('src/pages/home/state.ts', 'homeStateScript'),
  homeUtilsScript: await evaluateStandalone('src/pages/home/utils.ts', 'homeUtilsScript'),
  homeTavernBridgeScript: await evaluateStandalone('src/pages/home/tavern-bridge.ts', 'homeTavernBridgeScript'),
  homeApiScript: await evaluateStandalone('src/pages/home/api.ts', 'homeApiScript'),
  homeDailyRandomDrawScript: await evaluateStandalone('src/pages/home/daily-random.ts', 'homeDailyRandomDrawScript'),
  homeCardsRenderScript: await evaluateStandalone('src/pages/home/render/cards.ts', 'homeCardsRenderScript'),
  homeDetailModalRenderScript: await evaluateStandalone('src/pages/home/render/detail-modal.ts', 'homeDetailModalRenderScript'),
  homeExternalLinksScript: await evaluateStandalone('src/pages/home/external-links.ts', 'homeExternalLinksScript'),
  homeUploadPreviewScript: await evaluateStandalone('src/pages/home/upload-preview.ts', 'homeUploadPreviewScript'),
  homeReviewDiffRenderScript: await evaluateStandalone('src/pages/home/render/review-diff.ts', 'homeReviewDiffRenderScript'),
  homeLayoutRenderScript: await evaluateStandalone('src/pages/home/render/layout.ts', 'homeLayoutRenderScript'),
  homePublishCheckScript: await evaluateStandalone('src/pages/home/publish-check.ts', 'homePublishCheckScript'),
  homeAppAuthFlowScript: await evaluateStandalone('src/pages/home/app/auth-flow.ts', 'homeAppAuthFlowScript'),
  homeAppActionsScript: await evaluateStandalone('src/pages/home/app/actions.ts', 'homeAppActionsScript'),
  homeAppBootstrapScript: await evaluateStandalone('src/pages/home/app/bootstrap.ts', 'homeAppBootstrapScript'),
  homeModalsScript: [
    await evaluateStandalone('src/pages/home/modal/core.ts', 'homeModalCoreScript'),
    await evaluateStandalone('src/pages/home/modal/project-detail.ts', 'homeProjectDetailModalScript'),
    await evaluateStandalone('src/pages/home/modal/project-update.ts', 'homeProjectUpdateModalScript'),
    await evaluateStandalone('src/pages/home/modal/project-install.ts', 'homeProjectInstallModalScript'),
    await evaluateStandalone('src/pages/home/modal/project-editor.ts', 'homeProjectEditorModalScript'),
    await evaluateStandalone('src/pages/home/modal/admin-review.ts', 'homeAdminReviewModalScript'),
    await evaluateStandalone('src/pages/home/modal/admin-tools.ts', 'homeAdminToolsModalScript'),
    await evaluateStandalone('src/pages/home/modal/devteam-recommend.ts', 'homeDevTeamRecommendModalScript'),
  ].join('\n'),
  homeRepairScript: await evaluateStandalone('src/pages/home/repair-ui.ts', 'homeRepairScript'),
  homeUpdateCenterScript: await evaluateStandalone('src/pages/home/update-center.ts', 'homeUpdateCenterScript'),
  homePresentationScript: await evaluateStandalone('src/pages/home/presentation.ts', 'homePresentationScript'),
};

for (const [name, script] of Object.entries(fragments)) {
  assert.equal(typeof script, 'string', `${name} must evaluate to JavaScript text`);
  assert.doesNotMatch(script, /REDACTED_/, `${name} must not contain a persisted redaction placeholder`);
  new Function(script);
}

// Catalog layout is a display choice; the existing card renderer and pagination stay shared.
const catalogLayoutTestState = { catalogLayout: 'list', filterRequestPending: false, searchKeyword: '' };
const catalogToggleSource = fragments.homeLayoutRenderScript.match(/function renderCatalogLayoutToggle\(\) \{[\s\S]*?\n\}/)?.[0];
const catalogGridSource = fragments.homeLayoutRenderScript.match(/function renderProjectsGrid\(projects\) \{[\s\S]*?\n\}/g)?.at(-1);
assert.ok(catalogToggleSource && catalogGridSource);
const catalogLayoutTestUi = new Function(
  'state', 'getActivePublicTags', 'renderProjectCard',
  `${catalogToggleSource}\n${catalogGridSource}\nreturn { renderCatalogLayoutToggle, renderProjectsGrid };`,
)(
  catalogLayoutTestState, () => [],
  project => `<article class="project-card">${project.name}</article>`,
);
assert.match(catalogLayoutTestUi.renderCatalogLayoutToggle(), /data-catalog-layout="list" class="active"/);
assert.match(catalogLayoutTestUi.renderProjectsGrid([{ name: 'test-work' }]), /class="projects-grid catalog-layout--list"/);
catalogLayoutTestState.catalogLayout = 'grid';
assert.match(catalogLayoutTestUi.renderCatalogLayoutToggle(), /data-catalog-layout="grid" class="active"/);
assert.match(catalogLayoutTestUi.renderProjectsGrid([{ name: 'test-work' }]), /class="projects-grid catalog-layout--grid"/);
assert.match(fragments.homeAppActionsScript, /localStorage\.setItem\(CATALOG_LAYOUT_KEY, nextLayout\)/);

// A browse shelf refresh must not zero out editor picks absent from that shelf.
const statsSyncSource = fragments.homeStateScript.match(/function syncProjectStats\(projects, options = \{\}\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(statsSyncSource, 'syncProjectStats must remain testable');
const updateLikeSource = fragments.homeStateScript.match(/function updateLikeState\(projectId, payload\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(updateLikeSource, 'like responses must update the shared stats state');
const statsState = {
  editorRecommendations: [
    { id: 'editor-only', likesCount: 10, userLiked: true },
    { id: 'also-on-shelf', likesCount: 4 },
  ],
  likesMap: new Map(),
  subsMap: new Map(),
};
const syncStats = new Function('state', statsSyncSource + '\nreturn syncProjectStats;')(statsState);
const updateStatsLike = new Function('state', updateLikeSource + '\nreturn updateLikeState;')(statsState);
syncStats(statsState.editorRecommendations, { replace: false });
syncStats([{ id: 'shelf-only', likesCount: 2 }, { id: 'also-on-shelf', likesCount: 7 }]);
assert.deepEqual(statsState.likesMap.get('editor-only'), { count: 10, liked: true });
assert.deepEqual(statsState.likesMap.get('also-on-shelf'), { count: 7, liked: false });
assert.deepEqual(statsState.likesMap.get('shelf-only'), { count: 2, liked: false });
syncStats([{ id: 'another-shelf', likesCount: 3 }], { replace: false });
assert.equal(statsState.likesMap.get('editor-only').count, 10);
updateStatsLike('editor-only', { count: 9, liked: false });
syncStats([{ id: 'next-shelf', likesCount: 1 }]);
assert.deepEqual(statsState.likesMap.get('editor-only'), { count: 9, liked: false }, 'an unlike must survive an unrelated shelf refresh');
updateStatsLike('editor-only', { count: 10, liked: true });
syncStats([{ id: 'next-shelf', likesCount: 1 }]);
assert.deepEqual(statsState.likesMap.get('editor-only'), { count: 10, liked: true }, 'a like must survive an unrelated shelf refresh');
assert.equal(statsState.likesMap.has('shelf-only'), false, 'old shelf entries must not accumulate');
syncStats([{ id: 'editor-only', likesCount: 12, userLiked: true }]);
assert.deepEqual(statsState.likesMap.get('editor-only'), { count: 12, liked: true }, 'fresh project data must update the retained stats');
statsState.editorRecommendations = [];
syncStats([]);
assert.equal(statsState.likesMap.size, 0, 'removed editor picks must not remain in the stats map');

const worldbookList = { innerHTML: '', querySelectorAll: () => [] };
const additionalTab = {
  dataset: { installTarget: 'additional' },
  classList: { toggle: () => {} },
  addEventListener(_event, handler) { this.click = handler; },
};
const installModal = Function(
  'state', 'openModal', 'escapeHtml',
  `${await evaluateStandalone('src/pages/home/modal/project-install.ts', 'homeProjectInstallModalScript')}\nreturn openInstallWorldbookModal;`,
)(
  { tavern: { worldbooks: {
    primary: '主世界书',
    additional: ['已绑定B', '已绑定A', '已绑定B'],
    available: ['B10', 'B2', 'A', '主世界书', '已绑定A', 'B2'],
  } } },
  () => ({
    querySelector: selector => selector === '[data-additional-worldbook-list]' ? worldbookList : null,
    querySelectorAll: selector => selector === '[data-install-target]' ? [additionalTab] : [],
  }),
  value => value,
);
installModal('project-for-sorting-test', null);
additionalTab.click();
assert.deepEqual(
  [...worldbookList.innerHTML.matchAll(/data-worldbook-name="([^"]+)"/g)].map(match => match[1]),
  ['已绑定B', '已绑定A', 'A', 'B2', 'B10'],
  'bound worldbooks must stay first in binding order; other worldbooks must sort by name without duplicates or primary',
);

assert.match(homePageSource, /theme-color\" content=\"#0f1012/);
assert.match(homePageSource, /rel=\"icon\" href=\"data:,/);
assert.match(homePageSource, /html,body\{margin:0;min-height:100%;background:#0f1012/);
assert.match(homeStylesSource, /body \{[^}]*background:#0f1012/);
// #16: DLC Kitchen recommendation covers inherit the shared square Discover cover ratio.
assert.match(homeStylesSource, /\.discover-card-cover-shell\s*\{[^}]*aspect-ratio:1\/1/);
assert.doesNotMatch(homeStylesSource, /\.devteam-recommend-item \.discover-card-cover-shell\s*\{[^}]*aspect-ratio:/);
assert.match(
  fragments.homeCardsRenderScript,
  /const reviewBadge = showAdminActions \? getProjectReviewBadge\(project\) : "";/,
  'ordinary viewers must not render creator/admin review badges on public cards',
);
assert.match(
  fragments.homeCardsRenderScript,
  /const rejectReason = showAdminActions \? getProjectRejectReason\(project\) : "";/,
  'ordinary viewers must not render creator/admin rejection state on public cards',
);
assert.match(homeAppSource, /mobileToolSheet\.inert = true/);
assert.match(homeAppSource, /mobileToolSheet\.inert = false/);
assert.match(homeAppSource, /mobileToolSheet\.contains\(activeElement\).*activeElement\.blur/);
assert.match(fragments.homeLayoutRenderScript, /aria-hidden=.*inert/);
assert.match(homeStylesSource, /\.project-form \.upload-file-preview \.detail-keywords-block/);
assert.match(homeStylesSource, /\.project-form \.upload-file-preview \.keyword-chip/);
assert.doesNotMatch(homeStylesSource, /\.upload-preview-summary \{[^}]*rgba\(99,102,241/);
assert.match(homeStylesSource, /\.form-group \.taxonomy-chip \{[^}]*position:relative;/);
assert.match(homeStylesSource, /\.form-group \.taxonomy-chip input \{[^}]*inset:0;[^}]*width:100%;[^}]*height:100%;[^}]*border:0;/);
assert.doesNotMatch(homeStylesSource, /\.form-group \.taxonomy-chip input \{[^}]*clip-path:inset\(50%\)/);
assert.match(homeStylesSource, /\.project-form-modal \{[^}]*overflow:clip;/);
assert.match(homeStylesSource, /\.project-form \.form-group input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),/);
assert.match(homeStylesSource, /\.project-form \.form-group input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):focus,/);
assert.match(fragments.homeModalsScript, /data-admin-review-view="full"/, "update review must expose a full-content view");
assert.match(fragments.homeModalsScript, /data-admin-review-full-body/, "full review entries must start as lazy shells");
assert.match(fragments.homeModalsScript, /body\.dataset\.loaded/, "full review entry content must hydrate only after expansion");
assert.match(homeStylesSource, /\.admin-review-full-content \.entry-content\.open \{[^}]*max-height:min\(56vh,560px\);[^}]*overflow:auto;/, "expanded full review entries must stay height-limited and scrollable");
assert.match(fragments.homeModalsScript, /cw-admin-review-theme/, "admin review theme choice must persist locally");
assert.match(fragments.homeModalsScript, /data-admin-review-theme-option="light"/, "admin review must expose a light theme option");
assert.match(fragments.homeModalsScript, /data-admin-review-theme-option="dark"/, "admin review must expose a dark theme option");
assert.match(fragments.homeModalsScript, /document\.querySelectorAll\("\.admin-review-overlay,\.admin-review-detail-overlay"\)/, "theme changes must sync queue and detail overlays");
assert.match(homeStylesSource, /\.admin-review-overlay\[data-admin-review-theme="light"\]/, "admin review must include scoped light-theme styling");

assert.doesNotMatch(
  fragments.homeTavernBridgeScript,
  /event\.source !== window\.parent/,
  'embedded bridge must not reject valid host replies from a script-runner iframe context',
);
assert.match(
  fragments.homeTavernBridgeScript,
  /data\.namespace !== TAVERN_BRIDGE_NAMESPACE/,
  'embedded bridge must still reject messages outside its namespace',
);



const safeLinkUtils = Function(`${fragments.homeUtilsScript}; return { escapeHtml, normalizeExternalHttpUrl };`)();
const safeMarkdownUi = Function(
  'escapeHtml',
  'normalizeExternalHttpUrl',
  `${fragments.homeDetailModalRenderScript}; return { renderSafeMarkdown, collectExternalHttpUrlsFromText };`,
)(safeLinkUtils.escapeHtml, safeLinkUtils.normalizeExternalHttpUrl);
const discordUrl = 'https://discord.com/channels/1417861565679669272/1501937377684488402';
const markdownSafetySample = `## 更新\n- **重点**\n- [Discord](${discordUrl})\n<script>alert(1)</script>\n[bad](javascript:alert(1))`;
const markdownSafetyHtml = safeMarkdownUi.renderSafeMarkdown(markdownSafetySample);
assert.match(markdownSafetyHtml, /<h3[^>]*>更新<\/h3>/);
assert.match(markdownSafetyHtml, /<strong>重点<\/strong>/);
assert.match(markdownSafetyHtml, /data-external-url="https:\/\/discord\.com\/channels\//);
assert.doesNotMatch(markdownSafetyHtml, /href=/i, 'creator Markdown links must never navigate directly');
assert.doesNotMatch(markdownSafetyHtml, /<script/i, 'raw creator HTML must remain escaped');
assert.match(markdownSafetyHtml, /&lt;script&gt;/);
assert.equal(safeLinkUtils.normalizeExternalHttpUrl('javascript:alert(1)'), '');
assert.equal(safeLinkUtils.normalizeExternalHttpUrl('https://user:pass@example.com/'), '');
assert.deepEqual(safeMarkdownUi.collectExternalHttpUrlsFromText(`联系：${discordUrl}`), [discordUrl]);
const codeFenceSafetyHtml = safeMarkdownUi.renderSafeMarkdown('```html\n<script>alert(1)</script>\n```');
assert.doesNotMatch(codeFenceSafetyHtml, /<script/i, 'fenced code must not become executable HTML');
assert.match(codeFenceSafetyHtml, /&lt;script&gt;/);
assert.deepEqual(safeMarkdownUi.collectExternalHttpUrlsFromText('坏链接 https:// 后续文字'), [], 'malformed URLs must terminate scanning without hanging');

const projectUpdateDiffUi = Function(
  'escapeHtml',
  'renderWorldbookEntryBehaviorMeta',
  `${fragments.homeReviewDiffRenderScript}; return { renderProjectUpdateDiffSummary, renderProjectUpdateDiffSection };`,
)(safeLinkUtils.escapeHtml, () => '');
const projectUpdateDiffHtml = projectUpdateDiffUi.renderProjectUpdateDiffSection(
  '正则变化',
  'fa-code',
  [{
    status: 'modified',
    entryKey: 'regex:test',
    changedFields: ['replaceString'],
    previous: { scriptName: 'Test Regex', replaceString: 'old value' },
    current: { scriptName: 'Test Regex', replaceString: 'new value' },
    previousReviewText: 'scriptName: Test Regex\nreplaceString: old value',
    currentReviewText: 'scriptName: Test Regex\nreplaceString: new value',
  }],
  'regex',
);
assert.match(projectUpdateDiffHtml, /admin-review-diff-line--del/);
assert.match(projectUpdateDiffHtml, /admin-review-diff-line--add/);
assert.match(projectUpdateDiffHtml, /old value/);
assert.match(projectUpdateDiffHtml, /new value/);
const projectUpdateSummaryHtml = projectUpdateDiffUi.renderProjectUpdateDiffSummary({ summary: { changed: 1, added: 0, modified: 1, deleted: 0 } });
assert.match(projectUpdateSummaryHtml, /1<\/strong> 处内容变化/);
assert.doesNotMatch(projectUpdateSummaryHtml, /需要审核|未修改/);

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

const workshopConfig = JSON.parse(await readFile(resolve('../config/workshop.json'), 'utf8'));
assert.match(fragments.homeUtilsScript, /WORKSHOP_CONFIG\.client\.stable/);
assert.match(fragments.homeUtilsScript, /WORKSHOP_CONFIG\.client\.staging/);
assert.doesNotMatch(fragments.homeLayoutRenderScript, /WORKSHOP_MINIMUM_CLIENT_VERSION/);
assert.match(workshopConfig.client.stable, /^\d+\.\d+\.\d+$/);
assert.equal(Object.hasOwn(workshopConfig.client, 'minimum'), false);
assert.match(workshopConfig.client.staging, /^\d+\.\d+\.\d+-dev\d+$/);
assert.doesNotMatch(fragments.homeLayoutRenderScript, /WORKSHOP_RELEASE_IMPORT/);
assert.match(fragments.homeModalsScript, /宝宝们，记得按上面的步骤更新脚本～知道了吗？/);
assert.match(fragments.homeModalsScript, /id=\"releaseUpdateAcknowledgeBtn\"/);
assert.match(fragments.homeModalsScript, /releaseUpdateAcknowledgeBtn[\s\S]*requestCloseWorkshop\(\)/);
assert.match(fragments.homeModalsScript, /id=\"releaseUpdateLookAgainBtn\"/);
assert.match(fragments.homeModalsScript, /可以唷～那再看一眼/);
assert.doesNotMatch(fragments.homeModalsScript, /releaseUpdateCode|data-dependency-copy|getScriptDependencySuggestedImport/);
assert.match(fragments.homeTavernBridgeScript, /shouldShowWorkshopReleaseNotice\(\)[\s\S]*openReleaseNoticeModal\(\)/);
assert.match(fragments.homeTavernBridgeScript, /WORKSHOP_CONFIG\.scriptDependencies/);

assert.match(fragments.homeModalsScript, /id=\"versionLabel\"/);
assert.match(fragments.homeModalsScript, /id=\"regexInput\"[^>]*accept=\"\.json\"[^>]*multiple/);
assert.doesNotMatch(fragments.homeModalsScript, /!payload\.name \|\| !fileInput\.files\[0\]/);
assert.match(fragments.homeModalsScript, /validateProjectTaxonomySelection\(payload\)/);
assert.match(fragments.homeModalsScript, /validateProjectContentSelection\(payload\.projectType, hasWorldbook, hasRegex\)/);
assert.doesNotMatch(fragments.homeModalsScript, /id=\"extensionType\"/);
assert.match(fragments.homeModalsScript, /data-facet-group/);
assert.match(fragments.homeModalsScript, /taxonomy-chip/);
assert.match(fragments.homeModalsScript, /creator-tag-picker/);
assert.match(fragments.homeModalsScript, /data-preset-tag/);
assert.match(fragments.homeModalsScript, /PROJECT_TAXONOMY\.extensionTypes/);
assert.match(fragments.homeModalsScript, /PROJECT_TAXONOMY\.characterFacets/);
assert.doesNotMatch(fragments.homeModalsScript, /characterFacetsGroup/);
assert.match(fragments.homeModalsScript, /封面展示标签（可选）/);
assert.match(fragments.homeModalsScript, /openCreatorPublishCheck\(characterReferences\)/);
assert.match(fragments.homeModalsScript, /openCreatorPublishCheck\(characterReferences, project\)/);
assert.match(fragments.homeModalsScript, /if \(hasNewFile \|\| hasNewRegex\) \{/);
assert.match(fragments.homeModalsScript, /showToast\(updateResult\.draftProjectId \?/);
assert.doesNotMatch(
  fragments.homeModalsScript,
  /renderProjectDetail\(project, \[\], \[\]\)/,
  'player update modal must not embed the full project detail UI',
);
assert.match(fragments.homeModalsScript, /renderProjectUpdateDiffSummary\(reviewDiff\)/);
assert.match(fragments.homeModalsScript, /renderProjectUpdateDiffSection\("世界书变化"/);
assert.match(fragments.homeModalsScript, /renderProjectUpdateDiffSection\("正则变化"/);
assert.match(fragments.homePublishCheckScript, /发布前检查/);
assert.match(fragments.homePublishCheckScript, /parseOriginalBaselineItem/);
assert.match(fragments.homePublishCheckScript, /tags\[0\] !== '本体'/);
assert.match(fragments.homePublishCheckScript, /显示系统内容/);
assert.match(fragments.homePublishCheckScript, /data-original-entry-id/);
assert.match(fragments.homePublishCheckScript, /event\.target === overlay/);
assert.match(fragments.homeApiScript, /fetchCharacterReferenceVersionItems/);
const publishCheckUi = Function(
  'escapeHtml',
  `${fragments.homePublishCheckScript}; return { parseOriginalBaselineItem, buildOriginalBaselineTree };`,
)(value => String(value));
const groupedOriginal = publishCheckUi.parseOriginalBaselineItem({
  id: 'base-1',
  kind: 'worldbook',
  displayName: '[本体][势力][诺斯加德联盟][城镇][白曜城]五馆街',
});
assert.deepEqual(groupedOriginal.path, ['势力', '诺斯加德联盟', '城镇', '白曜城']);
assert.equal(groupedOriginal.title, '五馆街');
assert.equal(publishCheckUi.parseOriginalBaselineItem({ id: 'dlc-1', kind: 'worldbook', displayName: '[DLC][角色]测试' }), null);
const systemOriginal = publishCheckUi.parseOriginalBaselineItem({ id: 'system-1', kind: 'worldbook', displayName: '[本体][变量][mvu_update]测试' });
assert.equal(systemOriginal.system, true);
const treeResult = publishCheckUi.buildOriginalBaselineTree([
  { id: 'base-1', kind: 'worldbook', displayName: '[本体][势力][诺斯加德联盟][城镇][白曜城]五馆街' },
  { id: 'system-1', kind: 'worldbook', displayName: '[本体][变量][mvu_update]测试' },
], new Set(), { query: '白曜城', showSystem: false });
assert.equal(treeResult.visibleCount, 1);
assert.match(treeResult.html, /诺斯加德联盟/);
assert.match(treeResult.html, /白曜城/);
assert.match(treeResult.html, /五馆街/);
assert.doesNotMatch(treeResult.html, /mvu_update/);
assert.match(fragments.homeModalsScript, /preparedWorldbook = hasWorldbook \?/);
assert.match(fragments.homeModalsScript, /async function beginProjectInstall/);
assert.match(fragments.homeModalsScript, /if \(worldbookEntries\.length > 0\)/);
assert.match(fragments.homeModalsScript, /if \(regexEntries\.length > 0\)/);
assert.match(fragments.homeModalsScript, /requestInstallProject\(projectId/);
assert.match(fragments.homeModalsScript, /data-new-additional-worldbook/);
assert.match(fragments.homeModalsScript, /data-new-additional-worldbook-confirm/);
assert.match(fragments.homeModalsScript, /已有同名世界书，将安装到现有世界书/);
assert.match(fragments.homeModalsScript, /新附加世界书不能与角色主世界书同名/);
assert.match(fragments.homeModalsScript, /newAdditionalConfirm\?\.click\(\)/);
assert.match(fragments.homeApiScript, /INSTALLED_PROJECT_BATCH_SIZE = 50/);
assert.match(fragments.homeApiScript, /apiFetch\('\/api\/projects\/batch'/);
assert.match(fragments.homeApiScript, /JSON\.stringify\(\{ projectIds \}\)/);
assert.doesNotMatch(fragments.homeApiScript, /missingProjectIds\.map\(async projectId/);
assert.doesNotMatch(fragments.homeApiScript, /selectDiscoverProjects|getDiscoverRotationBucket|DISCOVER_CANDIDATE_POOL_SIZE/);
assert.match(fragments.homeApiScript, /\{ key: 'discover', sort: 'discover', pageSize: 10 \}/);
assert.match(fragments.homeApiScript, /\{ key: 'updated', sort: 'updated', pageSize: 5 \}/);

assert.match(fragments.homeLayoutRenderScript, /随机发现/);
assert.match(fragments.homeLayoutRenderScript, /最近更新/);

assert.match(fragments.homeCardsRenderScript, /const projectType = getBaseTag\(project\)/);
assert.match(fragments.homeCardsRenderScript, /const typeClass = getTypeClass\(project\)/);
assert.match(fragments.homeCardsRenderScript, /getProjectDisplayTags\(project\)\.slice\(0, 5\)/);
assert.ok(fragments.homeCardsRenderScript.includes('class="tag">#${escapeHtml(tag)}</span>'));
assert.ok(fragments.homeCardsRenderScript.includes('class="card-title-row"'));
assert.ok(fragments.homeCardsRenderScript.includes('card-type-badge--${typeClass}'));
assert.ok(fragments.homeCardsRenderScript.includes('class="card-type-label">${escapeHtml(projectType)}</span>'));
assert.doesNotMatch(fragments.homeCardsRenderScript, /card-type-icon|fa-puzzle-piece|fa-user-group|fa-microchip|fa-calendar-days/);
assert.doesNotMatch(fragments.homeCardsRenderScript, /Set\(\[baseTag, \.\.\.getProjectDisplayTags/);
assert.match(fragments.homeDetailModalRenderScript, /getInstalledLocationLabel/);
assert.match(fragments.homeDetailModalRenderScript, /附加世界书/);
assert.match(fragments.homeDetailModalRenderScript, /角色正则/);
const installLocationUi = Function('state', `${fragments.homeDetailModalRenderScript}; return { getInstalledLocationLabel };`)({
  tavern: { worldbooks: { primary: '主世界书', additional: ['附加 A'] } },
});
assert.equal(installLocationUi.getInstalledLocationLabel({ isInstalled: true, worldbookName: '主世界书' }, [{}], []), '角色主世界书 · 主世界书');
assert.equal(installLocationUi.getInstalledLocationLabel({ isInstalled: true, worldbookName: '附加 A' }, [{}], []), '附加世界书 · 附加 A');
assert.equal(installLocationUi.getInstalledLocationLabel({ isInstalled: true, worldbookName: null }, [], [{}]), '角色正则');
assert.equal(installLocationUi.getInstalledLocationLabel({ isInstalled: false, worldbookName: '附加 A' }, [{}], []), '');
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
assert.match(fragments.homeModalsScript, /需要确认的链接/);
assert.match(fragments.homeDetailModalRenderScript, /collectProjectExternalLinks/);
assert.match(fragments.homeDetailModalRenderScript, /未访问、未验证远端内容/);
assert.match(fragments.homeDetailModalRenderScript, /角色定义前/);
assert.match(fragments.homeDetailModalRenderScript, /detail-entry-ejs-badge/);
assert.doesNotMatch(fragments.homeDetailModalRenderScript, /tag-system-ejs/);
assert.match(fragments.homeDetailModalRenderScript, /data-detail-entry-group-toggle/);
assert.match(fragments.homeDetailModalRenderScript, /getCommonWorldbookPrefixCount/);
assert.match(fragments.homeModalsScript, /data-detail-entry-group-toggle/);
assert.match(fragments.homeDetailModalRenderScript, /mobile-project-detail/);
assert.match(fragments.homeDetailModalRenderScript, /data-mobile-reader-kind/);
assert.match(fragments.homeDetailModalRenderScript, /data-mobile-entry-reader/);
assert.match(fragments.homeDetailModalRenderScript, /data-mobile-description-toggle/);
assert.match(fragments.homeModalsScript, /data-mobile-reader-picker-search/);
assert.match(fragments.homeModalsScript, /mobile-reader-open/);
assert.match(fragments.homeModalsScript, /getMobileReaderSourceIndex/);
assert.match(fragments.homeDetailModalRenderScript, /tag-system-artwork/);
assert.match(fragments.homeDetailModalRenderScript, /const tagsHtml = inspectionTagsHtml \+ creatorTagsHtml/);
assert.match(fragments.homeModalsScript, /admin-review-signal--ejs/);
// #44: the pending queue must page through every actionable review, not stop at one page.
assert.match(fragments.homeApiScript, /const ADMIN_PENDING_PAGE_SIZE = \d+;/);
assert.match(fragments.homeApiScript, /while \(true\)[\s\S]{0,900}page \+= 1;/);
assert.match(fragments.homeStateScript, /DEFAULT_SORT_MODE = 'discover'/);
assert.match(fragments.homeStateScript, /viewMode: 'discover'/);
assert.match(fragments.homeLayoutRenderScript, /data-workshop-view=\"discover\"/);
assert.match(fragments.homeLayoutRenderScript, /renderDiscoverHome/);
assert.match(fragments.homeLayoutRenderScript, /renderDevTeamRecommendations\(\)/);
assert.match(fragments.homeCardsRenderScript, /EDITOR PICKS/);
assert.match(fragments.homeCardsRenderScript, /renderDiscoverShelf\("编辑精选"/);
assert.match(fragments.homeCardsRenderScript, /devteam-recommend-btn/);
assert.match(fragments.homeApiScript, /\/api\/devteam-recommendations/);
assert.match(recommendationsEndpointSource, /SUPER_ADMIN_USER_ID/);
assert.match(recommendationsEndpointSource, /FROM super_admins super_admin/);
assert.match(recommendationsEndpointSource, /devteam_recommendations r INDEXED BY idx_devteam_recommendations_updated/);
assert.match(recommendationsEndpointSource, /GROUP BY r\.project_id[\s\S]*?ORDER BY MAX\(r\.updated_at\)[\s\S]*?LIMIT 100/);
assert.match(recommendationsEndpointSource, /myRecommendedProjectIds/);
assert.doesNotMatch(recommendationsEndpointSource, /curator\.title AS curator_title/);
assert.doesNotMatch(recommendationsEndpointSource, /curator_global_name/);
assert.doesNotMatch(recommendationsEndpointSource, /curator_avatar/);
assert.match(recommendationsEndpointSource, /editor_pick_saved/);
assert.match(recommendationsEndpointSource, /editor_pick_removed/);
const startupInitialRenderIndex = fragments.homeAppBootstrapScript.indexOf('renderApp();');
const startupAuthTaskIndex = fragments.homeAppBootstrapScript.indexOf("const authTask = timedTask('auth'");
const startupRecommendationsTaskIndex = fragments.homeAppBootstrapScript.indexOf("const recommendationsTask = timedTask('editor-picks'");
const startupShelvesTaskIndex = fragments.homeAppBootstrapScript.indexOf("const shelvesTask = timedTask('discover-shelves'");
const startupAwaitIndex = fragments.homeAppBootstrapScript.indexOf('await Promise.allSettled');
assert.ok(startupInitialRenderIndex >= 0 && startupInitialRenderIndex < startupAuthTaskIndex, 'Workshop shell must render before startup API tasks');
assert.ok(startupAuthTaskIndex >= 0 && startupRecommendationsTaskIndex > startupAuthTaskIndex && startupShelvesTaskIndex > startupRecommendationsTaskIndex, 'startup tasks must be scheduled before the settle barrier');
assert.ok(startupAwaitIndex > startupShelvesTaskIndex, 'Editor picks must not block Discover shelves startup');
assert.doesNotMatch(indexSource, /\/api\/admin\/devteam-curator-profile/);
assert.doesNotMatch(fragments.homeApiScript, /fetchDlcKitchenProfile|saveDlcKitchenProfile/);
assert.doesNotMatch(fragments.homeCardsRenderScript, /DLC KITCHEN|data-devteam-curator-shift/);
assert.doesNotMatch(fragments.homeAppActionsScript, /openDlcKitchenCuratorModal|openDlcKitchenSettingsModal/);
assert.doesNotMatch(fragments.homeLayoutRenderScript, /dlcKitchenSettingsBtn|mobileDlcKitchenSettingsBtn/);
assert.doesNotMatch(fragments.homeModalsScript, /dlcKitchenCuratorTitle|dlcKitchenCuratorBio|dlcKitchenPresetAdd|devTeamReactionLabel/);
assert.match(fragments.homeModalsScript, /toggleEditorPick/);
assert.doesNotMatch(fragments.homeDetailModalRenderScript, /DLC私房菜|devteam-detail-recommendation/);
assert.match(fragments.homeDetailModalRenderScript, /detail-devteam-recommend-btn/);
assert.match(fragments.homeModalsScript, /detail-devteam-recommend-btn/);
assert.doesNotMatch(fragments.homeCardsRenderScript, /还没有私房菜/);
assert.doesNotMatch(fragments.homeLayoutRenderScript, /shelves\.downloads/);
assert.doesNotMatch(fragments.homeLayoutRenderScript, /shelves\.likes/);
assert.doesNotMatch(fragments.homeApiScript, /key: 'downloads', sort: 'downloads'/);
assert.doesNotMatch(fragments.homeApiScript, /key: 'likes', sort: 'likes'/);
assert.doesNotMatch(fragments.homeLayoutRenderScript, /value: \"discover\", label: \"发现\"/);
assert.match(fragments.homeLayoutRenderScript, /value: \"published\", label: \"最新发布\"/);
assert.doesNotMatch(fragments.homeLayoutRenderScript, /玩家好评（暂未开放）|最低门槛|renderMetricFilters/);
assert.match(fragments.homeLayoutRenderScript, /value: \"downloads\", label: \"下载最多\"/);
assert.match(fragments.homeLayoutRenderScript, /value: \"updated\", label: \"最近更新\"/);
assert.match(fragments.homeLayoutRenderScript, /value: \"likes\", label: \"点赞最多\"/);
for (const sort of ['downloads_7d', 'downloads_30d', 'likes_7d', 'likes_30d']) {
  assert.match(fragments.homeLayoutRenderScript, new RegExp('value: "' + sort + '"'));
}
assert.doesNotMatch(fragments.homeLayoutRenderScript, /data-metric-filter=/);
// Period sort choices are hidden until the backend reports a full collection window.
const periodSortSource = fragments.homeLayoutRenderScript.match(/function getBrowseSortOptions\(\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(periodSortSource);
const periodSortState = { periodPopularityReady: { days7: false, days30: false } };
const getPeriodSorts = new Function('state', `${periodSortSource}\nreturn getBrowseSortOptions;`)(periodSortState);
assert.deepEqual(getPeriodSorts().map(option => option.value), ['published', 'updated', 'downloads', 'likes']);
periodSortState.periodPopularityReady.days7 = true;
assert.deepEqual(getPeriodSorts().map(option => option.value), ['published', 'updated', 'downloads', 'likes', 'downloads_7d', 'likes_7d']);
periodSortState.periodPopularityReady.days30 = true;
assert.deepEqual(getPeriodSorts().map(option => option.value), ['published', 'updated', 'downloads', 'likes', 'downloads_7d', 'downloads_30d', 'likes_7d', 'likes_30d']);
assert.match(fragments.homeApiScript, /periodPopularityReady: data\.periodPopularityReady/);
assert.match(fragments.homeStateScript, /days7: payload\?\.periodPopularityReady\?\.days7 === true/);
assert.match(fragments.homeApiScript, /projectType/);
assert.match(fragments.homeApiScript, /params\.set\('tags', activeTags\.join\(','\)\)/);
assert.match(fragments.homeLayoutRenderScript, /data-unified-search/);
assert.doesNotMatch(fragments.homeModalsScript, /codeCheck\?\.gate === "reject" \|\| deviceCheckPending/, 'high EJS finding must not disable human approval');
assert.match(fragments.homeModalsScript, /data-admin-review-submit="approve"/, 'human override uses the existing approval action');
assert.match(fragments.homeModalsScript, /manualOverrideReason/, 'human override reason must be sent for server validation');
assert.match(fragments.homeModalsScript, /highFindings\.length/, 'high-risk confirmation shows finding count');
assert.match(fragments.homeModalsScript, /工具未完成检查 · 待人工复核/, 'processing limit must not be mislabeled a required creator fix');
assert.match(fragments.homeModalsScript, /检查受限/, 'processing limit must be reported separately from high-risk findings');
assert.match(fragments.homeModalsScript, /不能证明代码有误，也不能证明安全/, 'reviewer must see that incomplete analysis does not imply a verdict');
assert.match(fragments.homeLayoutRenderScript, /mobileBaseTagFilter/);
assert.match(fragments.homeLayoutRenderScript, /mobile-breadcrumb/);
assert.match(fragments.homeLayoutRenderScript, /getMobileCurrentSortLabel/);
assert.match(fragments.homeLayoutRenderScript, /sortCrumb/);
assert.match(fragments.homeLayoutRenderScript, /data-return-all-projects/);
assert.match(fragments.homeLayoutRenderScript, /id=\"myProjectsUploadBtn\"/);
assert.match(fragments.homeLayoutRenderScript, /my-projects-page-head/);
assert.match(homeAppSource, /querySelectorAll\('\[data-return-all-projects\]'\)/);
assert.match(homeAppSource, /myProjectsUploadBtn\.onclick = openUploadProject/);
assert.match(homeAppSource, /state\.showSubscribedAndInstalledProjects = false/);
assert.match(fragments.homeLayoutRenderScript, /data-mobile-tool=\"page\"/);
assert.match(fragments.homeLayoutRenderScript, /data-search-tag/);
assert.doesNotMatch(fragments.homeLayoutRenderScript, /projectTagFilterMobile/);
assert.doesNotMatch(fragments.homeLayoutRenderScript, /data-mobile-tool=\"filter\"/);
assert.doesNotMatch(fragments.homeLayoutRenderScript, /mobile-category-nav/);
assert.match(fragments.homeLayoutRenderScript, /扩展方向/);
assert.match(fragments.homeCardsRenderScript, /card-owner-stats/);
assert.match(fragments.homeCardsRenderScript, /card-public-stats/);
assert.match(fragments.homeCardsRenderScript, /discover-card-like like-btn/);
assert.doesNotMatch(fragments.homeLayoutRenderScript, /data-metric-filter=/);
assert.doesNotMatch(fragments.homeLayoutRenderScript, /data-clear-metric-filter=/);
assert.match(fragments.homeApiScript, /async function setPrivateProjectRating\(projectId, rating, comment = ''\)/);
assert.match(fragments.homeDetailModalRenderScript, /data-project-rating/);
assert.match(fragments.homeDetailModalRenderScript, /记名评分喵，目前只用于 Workshop 内部收集/);
assert.match(fragments.homeDetailModalRenderScript, /评分和留言目前只保存于 Workshop，不向作者或公众显示/);
assert.doesNotMatch(fragments.homeDetailModalRenderScript, /匿名评分|匿名留言|只有作者能看到/);
assert.match(fragments.homeDetailModalRenderScript, /data-private-rating-comment/);
assert.match(fragments.homeDetailModalRenderScript, /data-private-rating-submit/);
assert.doesNotMatch(fragments.homeDetailModalRenderScript, /private-rating-comments/);
assert.match(fragments.homeModalsScript, /setPrivateProjectRating\(projectId, rating, comment\)/);
assert.match(fragments.homeModalsScript, /selectPrivateRating\(rating\)/);
assert.match(fragments.homeModalsScript, /评分已保存到 Workshop/);
assert.doesNotMatch(fragments.homeModalsScript, /匿名评分已送给作者/);
assert.match(projectReadEndpointSource, /reason: '评分和留言目前只保存于 Workshop，不向作者或公众显示'/);
assert.doesNotMatch(projectReadEndpointSource, /作者可以查看匿名评分统计/);
assert.doesNotMatch(projectReadEndpointSource, /SELECT COUNT\(\*\) AS rating_count/);
assert.doesNotMatch(projectReadEndpointSource, /SELECT rating, comment_text/);
assert.doesNotMatch(fragments.homeModalsScript, /ratingNeedsInstallRepair/);
assert.doesNotMatch(fragments.homeModalsScript, /setProjectSubscription\(detailProject\.id, true\)/);
assert.match(fragments.homeModalsScript, /ratingStarsWrap\?\.classList\.add\("previewing"\)/);
assert.match(fragments.homeModalsScript, /classList\.toggle\("preview"/);
assert.match(fragments.homeCardsRenderScript, /view\.downloadsCount/);
assert.match(fragments.homeModalsScript, /最旧优先/);
assert.match(fragments.homeModalsScript, /最新优先/);
assert.match(fragments.homeModalsScript, /refreshAdminReviewQueue/);
const adminPanelLoadingOpenIndex = fragments.homeModalsScript.indexOf('const loadingOverlay = openModal');
const adminPanelInitialFetchIndex = fragments.homeModalsScript.indexOf('const data = await fetchPendingProjects');
assert.ok(adminPanelLoadingOpenIndex >= 0 && adminPanelInitialFetchIndex > adminPanelLoadingOpenIndex, 'admin review must open its loading shell before awaiting the queue API');
assert.match(fragments.homeModalsScript, /data-admin-review-retry/);
assert.match(fragments.homeModalsScript, /审核队列加载失败/);
assert.match(fragments.homeLayoutRenderScript, /state\.filterRequestPending\) return `?<div class="projects-grid"><p class="projects-empty projects-loading"/);
assert.match(fragments.homeLayoutRenderScript, /mobile-header-notice-btn/);
assert.match(fragments.homeLayoutRenderScript, /mobile-account-script-update/);
assert.match(fragments.homeAppActionsScript, /mobileHeaderNoticeBtn/);
assert.match(fragments.homeAppActionsScript, /openMobileTool\('account'\)/);
assert.match(fragments.homeLayoutRenderScript, /desktopUpdateHubBtn/);
assert.doesNotMatch(fragments.homeLayoutRenderScript, /id="dlcUpdateStatusBtn"/, 'desktop header must not expose a separate DLC update button');
assert.match(fragments.homeApiScript, /function searchWorkshopProjectsForRepair\(query, methodPrefix = 'auto_search'\)/);
assert.match(fragments.homeApiScript, /if \(projects\.length === 1\) \{[\s\S]*status: 'unique', method: methodPrefix \+ '_single_result'/);
assert.match(fragments.homeRepairScript, /if \(match\.status === 'none' && fallbackName\) \{[\s\S]*searchWorkshopProjectsForRepair\(fallbackName, 'auto_search'\)/);
assert.doesNotMatch(fragments.homeRepairScript, /能自动判断的事情已经帮你做完/);
assert.match(fragments.homeUpdateCenterScript, /function openWorkshopUpdateHub\(\)/);
assert.match(fragments.homeUpdateCenterScript, /data-update-hub-dlc/);
assert.match(fragments.homeUpdateCenterScript, /data-update-hub-scripts/);
assert.match(fragments.homeAppActionsScript, /desktopUpdateHubBtn/);
assert.match(fragments.homeApiScript, /admin pending loaded/);
assert.match(fragments.homeModalsScript, /const refreshedQueue = await fetchPendingProjects/);
assert.match(fragments.homeModalsScript, /if \(!liveIds\.has\(String\(card\.dataset\.projectId\)\)\) card\.remove\(\)/);
assert.match(fragments.homeModalsScript, /queue\.innerHTML = renderAdminReviewQueueContents/);
assert.match(fragments.homeModalsScript, /refreshSequence/);
assert.match(fragments.homeModalsScript, /aria-busy/);
assert.doesNotMatch(fragments.homeModalsScript, /overlay\.remove\(\);\s*openAdminPanel\(\{ sort:/);
assert.doesNotMatch(fragments.homeModalsScript, /overlay\.remove\(\);\s*openAdminPanel\(\{ sort, projectType:/);
assert.match(fragments.homeModalsScript, /data-admin-review-type/);
assert.doesNotMatch(fragments.homeModalsScript, /data-action="detail"/);
assert.doesNotMatch(fragments.homeModalsScript, /查看详情/);
assert.match(fragments.homeModalsScript, /放到队尾/);
assert.match(fragments.homeModalsScript, /data-admin-review-start/);
assert.match(fragments.homeModalsScript, /开始审查/);
assert.match(fragments.homeModalsScript, /data-admin-review-cleanup/);
assert.match(fragments.homeModalsScript, /清理过期请求/);
assert.match(fragments.homeModalsScript, /cleanupOutdatedReviewDrafts\(\)/);
assert.match(fragments.homeApiScript, /\/api\/admin\/pending\/cleanup/);
assert.match(homeStylesSource, /\.admin-review-cleanup-btn \{[^}]*min-height:42px/);
assert.match(homeStylesSource, /@media \(max-width:640px\)[\s\S]*\.admin-review-cleanup-btn \{[^}]*min-height:46px/);
assert.doesNotMatch(fragments.homeModalsScript, /openCharacterReferenceAdminModal/);
assert.doesNotMatch(fragments.homeModalsScript, /data-character-reference-admin/);
assert.doesNotMatch(fragments.homeModalsScript, /角色卡版本管理/);
assert.doesNotMatch(fragments.homeApiScript, /createCharacterReference\(/);
assert.doesNotMatch(fragments.homeApiScript, /createCharacterReferenceVersion\(/);
assert.doesNotMatch(homeStylesSource, /character-reference-modal/);
assert.doesNotMatch(homeStylesSource, /project-form-section-head--plain/);
assert.doesNotMatch(fragments.homeModalsScript, /reviewQueueSummary/);
assert.doesNotMatch(fragments.homeModalsScript, /imageLinkCount/);
assert.doesNotMatch(fragments.homeModalsScript, /admin-review-card-changes/);
assert.match(fragments.homeModalsScript, /打开后检查详细变化/);
assert.match(fragments.homeModalsScript, /admin-review-mini-signal--ejs/);
assert.match(fragments.homeModalsScript, /声明冲突的原版条目/);
assert.match(fragments.homeModalsScript, /玩家安装或更新时仍会被明确询问是否由 Workshop 帮忙关闭/);
assert.match(fragments.homeModalsScript, /admin-review-workflow-bar/);
assert.match(fragments.homeModalsScript, /连续审核/);
assert.match(fragments.homeModalsScript, /data-admin-review-prev/);
assert.match(fragments.homeModalsScript, /data-admin-review-next/);
assert.match(fragments.homeModalsScript, /const canPrev = currentQueueIndex > 0/);
assert.match(fragments.homeModalsScript, /const canNext = currentQueueIndex >= 0 && currentQueueIndex < orderedQueueProjects\.length - 1/);
assert.doesNotMatch(fragments.homeModalsScript, /% ordered\.length/);
assert.match(fragments.homeModalsScript, /removeAdminReviewQueueProject/);
assert.match(fragments.homeModalsScript, /fetchProjects\(true\)\.catch/);
assert.match(fragments.homeModalsScript, /const nextIndex = currentIndex >= 0 && currentIndex < remaining\.length \? currentIndex : 0/);
assert.match(fragments.homeModalsScript, /openAdminReviewDetail\(remaining\[nextIndex\], queueOverlay, queueProjects\)/);
assert.match(fragments.homeModalsScript, /admin-log-trace/);
assert.doesNotMatch(fragments.homeModalsScript, /getAdminReviewVersionLabel/);
assert.doesNotMatch(fragments.homeModalsScript, /admin-review-detail-times/);
assert.match(fragments.homeModalsScript, /admin-review-thumb/);
assert.match(fragments.homeModalsScript, /bindCoverImageFallbacks\(overlay\)/);
assert.doesNotMatch(fragments.homeModalsScript, /admin-review-desc-preview/);
assert.match(fragments.homeDetailModalRenderScript, /顺序 \${order}/);
assert.match(fragments.homeDetailModalRenderScript, /type === \"at_depth\"/);
assert.doesNotMatch(fragments.homeDetailModalRenderScript, /<span>深度 \${depth}<\/span>/);
assert.match(fragments.homeReviewDiffRenderScript, /renderWorldbookEntryBehaviorMeta/);
assert.match(fragments.homeModalsScript, /版本号（可选）/);
assert.doesNotMatch(fragments.homeModalsScript, /releaseUpdateCode|codeField\.select|document\.execCommand\("copy"\)/);
assert.doesNotMatch(fragments.homeModalsScript, /function copyTextCompat\(text\)/);
assert.doesNotMatch(fragments.homeModalsScript, /window\.prompt\("复制最新版 Creative Workshop 导入代码"/);
assert.doesNotMatch(fragments.homeModalsScript, /versionBump|Patch|Minor|Major/);
assert.match(fragments.homeCardsRenderScript, /撤回更新/);
assert.match(fragments.homeCardsRenderScript, /继续编辑/);
assert.doesNotMatch(fragments.homeCardsRenderScript, /tag-system-ejs/);
assert.match(fragments.homeCardsRenderScript, /card-quality-signal/);
assert.doesNotMatch(fragments.homeCardsRenderScript, /icon-stat-btn/);
assert.match(fragments.homeLayoutRenderScript, /mobile-tool-dock/);
assert.match(fragments.homeLayoutRenderScript, /projectSearchInputMobile/);
assert.match(fragments.homeDetailModalRenderScript, /detail-stats-row/);
assert.match(fragments.homeDetailModalRenderScript, /detail-like-btn/);
assert.match(fragments.homeDetailModalRenderScript, /detail-like-label/);
assert.match(fragments.homeDetailModalRenderScript, /compatibility-row/);
assert.match(fragments.homeDetailModalRenderScript, /compatibility-status-dot/);
assert.match(fragments.homeModalsScript, /label\.textContent = nextLike\.liked \? "已喜欢" : "喜欢"/);
assert.doesNotMatch(fragments.homeDetailModalRenderScript, /canManageProject/);
assert.match(fragments.homeDetailModalRenderScript, /isProjectEditable\(project\)/);
assert.match(fragments.homeLayoutRenderScript, /script-dependency-health-btn/);
assert.match(fragments.homeModalsScript, /openScriptDependencyHealthModal/);
assert.match(fragments.homeModalsScript, /label for="projName"/);
assert.match(fragments.homeModalsScript, /label for="projDesc"/);
assert.match(fragments.homeModalsScript, /label for="projPrecautions"/);
assert.match(fragments.homeModalsScript, /label for="versionLabel"/);
assert.match(fragments.homeModalsScript, /label for="baseTag"/);
assert.match(fragments.homeModalsScript, /label for="customTags"/);
assert.match(fragments.homeModalsScript, /worldbookFileLabel" for="fileInput"/);
assert.match(fragments.homeModalsScript, /regexFileLabel" for="regexInput"/);
assert.match(fragments.homeModalsScript, /label for="coverInput"/);
assert.match(fragments.homeModalsScript, /name="worldbookFile" aria-label="世界书文件"/);
assert.match(fragments.homeModalsScript, /name="regexFiles" aria-label="正则文件"/);
assert.match(fragments.homeModalsScript, /name="coverImage" aria-label="封面图"/);
assert.match(fragments.homeModalsScript, /for="\$\{inputId\}"><input id="\$\{inputId\}" type="checkbox" data-preset-tag/);
assert.match(fragments.homeModalsScript, /display-tag-chip" for="\$\{inputId\}"><input id="\$\{inputId\}" type="checkbox" data-display-tag/);
assert.match(fragments.homeModalsScript, /overlay\.style\.zIndex = String\(9999 \+ document\.querySelectorAll\("\.modal-overlay"\)\.length\)/);
assert.match(fragments.homeModalsScript, /compatibility-modal/);
assert.match(fragments.homeModalsScript, /compatibility-section-head/);
assert.doesNotMatch(fragments.homeModalsScript, /project-form-section-head"><div><h3>角色卡版本/);
assert.match(fragments.homeModalsScript, /loadProjectOriginalConflictItems/);
assert.doesNotMatch(fragments.homeModalsScript, /resolvedOriginalConflictItems/);
assert.match(fragments.homeModalsScript, /originalConflictEntryNames/);
assert.match(fragments.homeDetailModalRenderScript, /声明冲突的原版条目/);
assert.match(fragments.homeDetailModalRenderScript, /安装或更新时 Workshop 会再次询问你是否帮忙关闭，不会直接修改/);
assert.match(homeStylesSource, /\.compatibility-modal \.close-btn \{ position:relative; z-index:4; pointer-events:auto; \}/);
assert.match(homeStylesSource, /\.compatibility-modal \.modal-content \{ width:100%; height:100dvh;/);
assert.match(homeStylesSource, /\.mobile-detail-actions \.detail-actions-panel \{ width:100%; align-items:stretch;/);
assert.match(homeStylesSource, /\.mobile-detail-actions \.detail-install-btn,.mobile-detail-actions \.detail-update-btn \{ min-width:0; min-height:46px; flex:1 1 0;/);
assert.match(homeStylesSource, /button\.detail-like-btn \{ min-height:32px; padding:0 10px; border:1px solid/);
assert.doesNotMatch(homeStylesSource, /\.external-link-domain[^\n]*rgba\(15,23,42/);
assert.doesNotMatch(homeStylesSource, /\.external-link-item code[^\n]*#BFDBFE/);
assert.match(homeStylesSource, /\.external-link-domain \{[^\n]*background:#151619/);
assert.match(homeStylesSource, /\.external-link-item code \{[^\n]*color:#cdbb9f/);
assert.doesNotMatch(fragments.homeTavernBridgeScript, /getScriptDependencySuggestedImport/);
assert.match(homeAppSource, /scriptDependencyHealthBtns/);
assert.match(fragments.homeCardsRenderScript, /getProjectDisplayTags\(project\)/);
assert.match(fragments.homeModalsScript, /data-display-tag/);
assert.match(fragments.homeModalsScript, /封面最多显示/);
assert.match(fragments.homeModalsScript, /normalizeCustomTagsInput/);
assert.match(fragments.homeCardsRenderScript, /fa-images/);
assert.doesNotMatch(fragments.homeCardsRenderScript, /creatorTagsHtml/);
assert.match(fragments.homeCardsRenderScript, /getProjectTypeDisplayLabel\(project\)/);
assert.match(fragments.homeCardsRenderScript, /delete-project-btn/);
assert.match(fragments.homeCardsRenderScript, /editButtonHtml = isPendingProject \|\| hasCurrentDraft/);
assert.match(fragments.homeCardsRenderScript, /role=\"button\" tabindex=\"0\"/);
assert.doesNotMatch(fragments.homeCardsRenderScript, /detail-btn/);
assert.doesNotMatch(fragments.homeCardsRenderScript, /审核中的项目暂不可删除/);
assert.match(fragments.homeCardsRenderScript, /rebind-project-btn/);
assert.match(fragments.homeDetailModalRenderScript, /detail-rebind-project-btn/);
assert.match(fragments.homeModalsScript, /openInstalledProjectRebindModal/);
assert.match(fragments.homeApiScript, /exactNameMatches/);
assert.match(fragments.homeTavernBridgeScript, /installedProjectId && installedProjectId !== projectId/);
assert.match(fragments.homeStateScript, /confirmInstalledProjectRebind/);
assert.doesNotMatch(fragments.homeStateScript, /canResolveLegacyProjectIdentities/);

const resolveOriginalConflicts = Function(
  `${fragments.homeModalsScript}; return loadProjectOriginalConflictItems;`,
)();
const resolvedOriginalConflicts = await resolveOriginalConflicts({
  conflictsWithOriginal: true,
  originalConflictEntryNames: ['原版条目 A'],
});
assert.equal(resolvedOriginalConflicts.complete, true);
assert.equal(resolvedOriginalConflicts.items.length, 1);
assert.equal(resolvedOriginalConflicts.items[0].displayName, '原版条目 A');

const legacyOriginalConflicts = await resolveOriginalConflicts({
  conflictsWithOriginal: true,
  originalConflictReferenceItemIds: ['wb-1'],
  originalConflictEntryNames: [],
});
assert.equal(legacyOriginalConflicts.complete, false);
assert.equal(legacyOriginalConflicts.items.length, 0);

const cardViewModelUi = Function(
  'getLikeState',
  'getLocalProjectMeta',
  'getLegacyInstalledProjectMatches',
  'getInstalledProjectRebindCandidate',
  'getProjectPendingAction',
  'state',
  'escapeHtml',
  `${fragments.homeCardsRenderScript}; return { buildProjectCardViewModel };`,
)(
  () => ({ liked: false, count: 0 }),
  () => null,
  () => [],
  () => null,
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
  'getInstalledProjectRebindCandidate',
  'getProjectPendingAction',
  'state',
  'escapeHtml',
  'getCoverImageSources',
  'getTypeClass',
  'getBaseTag',
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
  () => null,
  { tavern: { connected: false, installedProjectsLoaded: false }, currentUser: null },
  value => String(value),
  () => ({ primary: 'cover', fallback: 'fallback', placeholder: 'placeholder', authenticated: '' }),
  () => 'extension',
  () => '扩展',
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
const displayTagCardHtml = cardRenderUi.renderProjectCard({ id: 'display-tags', name: 'Display Tags', version: '1.0.0', versionLabel: null, displayTags: ['人鱼', '纯爱'], hasCharacterArtwork: true, coverImage: '/cover.png', tags: [], downloadsCount: 0 });
assert.match(displayTagCardHtml, /card-type-badge--extension/);
assert.doesNotMatch(displayTagCardHtml, /card-type-icon|fa-puzzle-piece/);
assert.match(displayTagCardHtml, />扩展<\/span>/);
assert.match(displayTagCardHtml, />#人鱼<\/span>/);
assert.match(displayTagCardHtml, />#纯爱<\/span>/);
assert.match(displayTagCardHtml, /card-cover-wrap.*card-art-badge[^>]*>.*fa-images/);
assert.doesNotMatch(displayTagCardHtml, /card-quality-signal[^>]*>.*fa-images/);
assert.doesNotMatch(displayTagCardHtml, /icon-stat-btn|card-meta--version/);
const legacyCardHtml = cardRenderUi.renderProjectCard({ id: 'legacy', name: 'Legacy', version: '1.2.3', versionLabel: null, tags: [], downloadsCount: 0 });
assert.doesNotMatch(legacyCardHtml, /card-meta--version|1\.2\.3/);
const labeledCardHtml = cardRenderUi.renderProjectCard({ id: 'labeled', name: 'Labeled', version: '1.2.3', versionLabel: '夏季版', tags: [], downloadsCount: 0 });
assert.doesNotMatch(labeledCardHtml, /card-meta--version|夏季版/);

const createLegacyIdentityUi = () => Function(
  `${fragments.homeStateScript}; return { state, setProjectsPage, setInstalledProjects, getLocalProjectMeta, getLegacyInstalledProjectMatches, setInstalledProjectRebindCandidates, getInstalledProjectRebindCandidate, confirmInstalledProjectRebind };`,
)();
const legacyIdentityUi = createLegacyIdentityUi();
const canonicalProjectId = '11111111-1111-4111-8111-111111111111';
legacyIdentityUi.setInstalledProjects([{
  projectId: '旧工坊项目',
  installedProjectId: '旧工坊项目',
  projectNameHint: '旧工坊项目',
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
assert.equal(legacyIdentityUi.getLocalProjectMeta('旧工坊项目')?.installedProjectId, '旧工坊项目');
assert.equal(legacyIdentityUi.getLocalProjectMeta(canonicalProjectId), null, 'name match must not auto-rebind');
legacyIdentityUi.setInstalledProjectRebindCandidates('旧工坊项目', [{ id: canonicalProjectId, name: '旧工坊项目' }]);
assert.equal(legacyIdentityUi.getInstalledProjectRebindCandidate('旧工坊项目')?.projects.length, 1);
assert.equal(legacyIdentityUi.getLocalProjectMeta(canonicalProjectId), null, 'candidate discovery alone must not change identity');
assert.equal(
  legacyIdentityUi.confirmInstalledProjectRebind('旧工坊项目', { id: canonicalProjectId, name: '旧工坊项目' }),
  true,
);
assert.equal(legacyIdentityUi.getLocalProjectMeta(canonicalProjectId)?.installedProjectId, '旧工坊项目');
assert.equal(legacyIdentityUi.getLocalProjectMeta('旧工坊项目'), null);

const ambiguousLegacyUi = createLegacyIdentityUi();
ambiguousLegacyUi.setInstalledProjects([{
  projectId: '同名旧项目',
  installedProjectId: '同名旧项目',
  projectNameHint: '同名旧项目',
  name: '同名旧项目',
  legacyProjectName: '同名旧项目',
  localVersion: null,
  entryCount: 1,
  regexCount: 0,
}]);
ambiguousLegacyUi.setInstalledProjectRebindCandidates('同名旧项目', [
  { id: '22222222-2222-4222-8222-222222222222', name: '同名旧项目' },
  { id: '33333333-3333-4333-8333-333333333333', name: '同名旧项目' },
]);
assert.equal(ambiguousLegacyUi.getLocalProjectMeta('同名旧项目')?.installedProjectId, '同名旧项目');
assert.equal(ambiguousLegacyUi.getInstalledProjectRebindCandidate('同名旧项目')?.projects.length, 2);
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
  'getInstalledProjectRebindCandidate',
  'getProjectPendingAction',
  'state',
  'escapeHtml',
  `${fragments.homeCardsRenderScript}; return { buildProjectCardViewModel };`,
)(
  () => ({ liked: false, count: 0 }),
  () => ({ projectId: canonicalProjectId, legacyProjectName: '旧工坊项目', localVersion: null }),
  () => [],
  () => null,
  () => null,
  { tavern: { connected: true, installedProjectsLoaded: true, installedProjectsComplete: true } },
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
  'getInstalledProjectRebindCandidate',
  'getProjectPendingAction',
  'state',
  'escapeHtml',
  `${fragments.homeCardsRenderScript}; return { buildProjectCardViewModel };`,
)(
  () => ({ liked: false, count: 0 }),
  () => null,
  () => [{}],
  () => null,
  () => null,
  { tavern: { connected: true, installedProjectsLoaded: true, installedProjectsComplete: true } },
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
const versionMessages = [];
let versionNoticeCount = 0;
const versionWindow = {
  location: { origin: new URL(workshopConfig.endpoints.production).origin },
  parent: { postMessage: message => versionMessages.push(message) },
};
const workshopVersionUi = Function(
  'state',
  'WORKSHOP_CONFIG',
  'window',
  'openReleaseNoticeModal',
  `${fragments.homeUtilsScript}; return { parseWorkshopVersion, compareWorkshopVersions, getRequiredWorkshopClientVersion, shouldShowWorkshopReleaseNotice, requireLatestWorkshopClient };`,
)(versionState, workshopConfig, versionWindow, () => { versionNoticeCount += 1; });
assert.deepEqual(workshopVersionUi.parseWorkshopVersion('2.0.13'), [2, 0, 13]);
assert.deepEqual(workshopVersionUi.parseWorkshopVersion('v2.0.13'), [2, 0, 13]);
assert.equal(workshopVersionUi.parseWorkshopVersion('2.0'), null);
assert.equal(workshopVersionUi.parseWorkshopVersion('latest'), null);
assert.equal(workshopVersionUi.compareWorkshopVersions('2.0.12', '2.0.13'), -1);
assert.equal(workshopVersionUi.compareWorkshopVersions('2.0.13', '2.0.13'), 0);
assert.equal(workshopVersionUi.compareWorkshopVersions('2.0.14', '2.0.13'), 1);
assert.equal(workshopVersionUi.compareWorkshopVersions('2.0.9', '2.0.12'), -1);
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice(), false);
assert.throws(() => workshopVersionUi.requireLatestWorkshopClient(), { code: 'CLIENT_UPDATE_REQUIRED' });
versionState.tavern.clientVersionResolved = true;
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice(), true);
versionState.tavern.clientVersion = '2.1.3';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice(), true, 'previously allowed client must now update');
versionState.tavern.clientVersion = workshopConfig.client.stable;
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice(), false);
assert.doesNotThrow(() => workshopVersionUi.requireLatestWorkshopClient());
versionState.tavern.clientVersion = '99.0.0';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice(), true, 'a newer mismatched client is not the released client');
versionState.tavern.clientVersion = 'not-a-version';
assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice(), true);

const versionBridgeUi = Function(
  'state', 'WORKSHOP_CONFIG', 'window', 'crypto',
  'requireLatestWorkshopClient', 'shouldShowWorkshopReleaseNotice', 'openReleaseNoticeModal',
  'setTavernConnectionStatus', 'setTavernClientVersion', 'renderApp',
  `${fragments.homeTavernBridgeScript}; return { postBridgeMessage, handleBridgeMessage, requestCloseWorkshop };`,
)(versionState, workshopConfig, versionWindow, { randomUUID: () => 'version-check-request' },
  workshopVersionUi.requireLatestWorkshopClient, workshopVersionUi.shouldShowWorkshopReleaseNotice,
  () => { versionNoticeCount += 1; }, () => {},
  version => { versionState.tavern.clientVersion = version; versionState.tavern.clientVersionResolved = true; },
  () => {});
const versionHandshake = version => versionBridgeUi.handleBridgeMessage({ data: {
  namespace: 'creative-workshop-bridge', type: 'bridge:handshake:ok', payload: { clientVersion: version },
} });
versionHandshake('2.1.3');
assert.ok(versionNoticeCount > 0);
assert.equal(versionMessages.length, 0, 'outdated handshake must not scan installed DLC');
for (const type of ['bridge:install-project', 'bridge:confirm-project-update', 'bridge:uninstall-project',
  'bridge:repair:project', 'bridge:repair:scan', 'bridge:get-project-diff']) {
  assert.throws(() => versionBridgeUi.postBridgeMessage(type, {}), { code: 'CLIENT_UPDATE_REQUIRED' }, type);
}
assert.equal(versionMessages.length, 0, 'blocked operations must never reach the client');
versionBridgeUi.requestCloseWorkshop();
assert.equal(versionMessages.pop().type, 'bridge:close-workshop', 'outdated client can still close the Workshop');
versionHandshake(workshopConfig.client.stable);
assert.deepEqual(versionMessages.splice(0).map(message => message.type),
  ['bridge:list-installed-projects', 'bridge:list-script-dependencies']);
versionBridgeUi.postBridgeMessage('bridge:install-project', { projectId: 'latest-client-project' });
assert.equal(versionMessages.pop().payload.projectId, 'latest-client-project');

for (const origin of [workshopConfig.endpoints.staging, ...(workshopConfig.endpoints.stagingAliases || [])]) {
  versionWindow.location.origin = new URL(origin).origin;
  assert.equal(workshopVersionUi.getRequiredWorkshopClientVersion(), workshopConfig.client.staging);
  versionState.tavern.clientVersion = workshopConfig.client.stable;
  assert.throws(() => versionBridgeUi.postBridgeMessage('bridge:install-project', {}), { code: 'CLIENT_UPDATE_REQUIRED' });
  versionState.tavern.clientVersion = workshopConfig.client.staging + '-old';
  assert.equal(workshopVersionUi.shouldShowWorkshopReleaseNotice(), true, 'staging builds must match exactly');
  versionState.tavern.clientVersion = workshopConfig.client.staging;
  assert.doesNotThrow(() => versionBridgeUi.postBridgeMessage('bridge:install-project', {}));
  versionMessages.length = 0;
}

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
const testWorkshopLimits = {
  projectUploadBytes: 1024,
  projectUploadLabel: 'test-limit',
  coverRequestOverheadBytes: 128,
  bannerUploadBytes: 512,
  bannerUploadLabel: 'test-banner-limit',
};
const taxonomyLabelUi = Function(
  'PROJECT_TAXONOMY',
  `${fragments.homeUtilsScript}; return { getProjectTypeDisplayLabel };`,
)(testProjectTaxonomy);
assert.equal(taxonomyLabelUi.getProjectTypeDisplayLabel({ projectType: '扩展', extensionType: '规则' }), '扩展 · 规则');
assert.equal(taxonomyLabelUi.getProjectTypeDisplayLabel({ projectType: '扩展', extensionType: null }), '扩展');

const homeScript = Function(...fragmentNames, 'projectContentPolicyJson', 'projectTaxonomyJson', 'workshopConfigJson', 'workshopLimitsJson', 'uploadChecker', 'reviewChecker', 'CHECKER_LIMITS', `return (${appExpression});`)(
  ...Object.values(fragments),
  JSON.stringify(testProjectContentPolicy),
  JSON.stringify(testProjectTaxonomy),
  JSON.stringify(workshopConfig),
  JSON.stringify(testWorkshopLimits),
  JSON.parse(await readFile(resolve('src/generated/upload-checker-revision.json'), 'utf8')),
  JSON.parse(await readFile(resolve('src/generated/review-checker-revision.json'), 'utf8')),
  CHECKER_LIMITS,
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
assert.match(contentPolicyUi.getProjectContentRequirementText('扩展'), /世界书或正则选一种就可以/);
assert.match(homeScript, /reviewProject\(project\.id, \{ action,/);
assert.match(homeScript, /expectedRevision: reviewProjectData\.draftRevision/);
assert.match(homeScript, /reviewerResult: \{ \.\.\.deviceResult, challenge: detail\.deviceCheck\?\.challenge/);
assert.match(homeScript, /runAdminReviewDeviceCheck\(detail\.deviceCheck\)/);
assert.doesNotMatch(homeScript, /reviewToken: detail\.reviewToken/);
assert.match(homeScript, /确定撤回这次更新吗/);
assert.match(homeScript, /当前编辑草稿也会一并删除/);
assert.match(homeScript, /document\.querySelectorAll\('\.project-card, \.discover-card'\)/);
const discoverCardRenderer = fragments.homeCardsRenderScript.match(/function renderDiscoverCard[\s\S]*?function renderProjectCard/)?.[0] || '';
assert.match(discoverCardRenderer, /discover-card-cover/);
assert.match(discoverCardRenderer, /data-cover-title/);
assert.match(discoverCardRenderer, /data-cover-position-x/);
assert.match(discoverCardRenderer, /data-cover-position-y/);
assert.match(discoverCardRenderer, /data-cover-zoom/);
assert.doesNotMatch(discoverCardRenderer, /install-btn/);
assert.match(fragments.homePresentationScript, /function openCoverPresentationModal/);
assert.match(fragments.homePresentationScript, /function openDiscoverBannerSettingsModal/);
assert.match(fragments.homeLayoutRenderScript, /bannerSettingsBtn/);
assert.match(fragments.homeCardsRenderScript, /cover-presentation-btn/);
assert.match(homeScript, /\/api\/projects\/.*cover-presentation/);
assert.match(homeScript, /document\.querySelectorAll\('\.delete-project-btn'\)/);
assert.doesNotMatch(homeScript, /document\.querySelectorAll\('\.detail-btn'\)/);

console.log('assembled /assets/home.js syntax smoke: ok');
