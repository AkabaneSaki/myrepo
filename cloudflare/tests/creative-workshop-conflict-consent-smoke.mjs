import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modals = (await Promise.all([
  '../src/pages/home/modal/project-update.ts',
  '../src/pages/home/modal/project-install.ts',
].map(path => readFile(new URL(path, import.meta.url), 'utf8')))).join('\n');
const bridge = await readFile(new URL('../src/pages/home/tavern-bridge.ts', import.meta.url), 'utf8');
const host = await readFile(new URL('../../src/CreativeWorkshop/bridge/host.ts', import.meta.url), 'utf8');
const worldbook = await readFile(new URL('../../src/CreativeWorkshop/services/worldbook.ts', import.meta.url), 'utf8');
const admin = await readFile(new URL('../src/endpoints/admin.ts', import.meta.url), 'utf8');

assert.match(modals, /chooseOriginalConflictInstallManagement/);
assert.match(modals, /不用，我自己处理并安装/);
assert.match(modals, /是，帮我关闭并安装/);
assert.match(modals, /if \(manageOriginalConflicts === null\) return/);
assert.match(modals, /confirmProjectUpdate\(project\.id, project\.version, manageOriginalConflicts, chosenBook, approvedDuplicates \|\| \[\]\)/);
assert.doesNotMatch(modals, /fetchCharacterReferenceVersionItems/);
assert.match(modals, /requestInstallProject\(projectId, \{ worldbookName: target, projectVersion, manageOriginalConflicts \}\)/);

assert.match(bridge, /manageOriginalConflicts: manageOriginalConflicts === true/);
assert.match(host, /event\.data\.payload\?\.manageOriginalConflicts === true/);

assert.match(worldbook, /manageOriginalConflicts = false/);
assert.match(worldbook, /if \(manageOriginalConflicts\) \{/);
assert.doesNotMatch(worldbook, /await restoreCreativeWorkshopOriginalConflicts\(projectId\)/);
assert.match(admin, /conflictsWithOriginal: project\.conflictsWithOriginal/);
assert.match(modals, /角色 Regex/);
assert.match(admin, /originalConflictReferenceItemIds: project\.originalConflictReferenceItemIds/);
assert.match(admin, /originalConflictEntryNames: project\.originalConflictEntryNames/);

const publishCheck = await readFile(new URL('../src/pages/home/publish-check.ts', import.meta.url), 'utf8');
const webBridge = await readFile(new URL('../src/pages/home/tavern-bridge.ts', import.meta.url), 'utf8');
const readEndpoint = await readFile(new URL('../src/endpoints/projects/read.ts', import.meta.url), 'utf8');
assert.match(publishCheck,/原版正则/);
assert.match(publishCheck,/item.kind === 'regex'/);
assert.match(modals,/chooseAmbiguousOriginalRegexes/);
assert.match(modals,/请选择|请为每条同名正则选择/);
assert.match(modals,/inspectOriginalConflictChoices/);
assert.match(webBridge,/pendingOriginalConflictPreviews/);
assert.match(webBridge,/bridge:inspect-original-conflicts/);
assert.match(webBridge,/originalConflictSelections/);
assert.match(host,/bridge:inspect-original-conflicts/);
assert.match(host,/originalConflictDisambiguation: true/);
assert.match(host,/originalConflictSelections/);
assert.match(readEndpoint,/originalConflictTargets/);
assert.match(worldbook,/assertCreativeWorkshopOriginalConflictsResolved/);

console.log('CreativeWorkshop conflict consent smoke: ok');
