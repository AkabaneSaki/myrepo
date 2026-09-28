import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from '../../node_modules/typescript/lib/typescript.js';

const source = await readFile(new URL('../../src/CreativeWorkshop/services/install-identity.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;

const module = { exports: {} };
vm.runInNewContext(compiled, {
  module,
  exports: module.exports,
  JSON, String, Number, Object, Array, Error,
}, { filename: 'install-identity.ts' });

const api = module.exports;
const metadata = {
  cw_project_id: '11111111-1111-4111-8111-111111111111',
  cw_project_name_display: '测试 %> <% 项目',
  cw_project_version: '2.2.0:beta%1',
  cw_remote_version: '2.2.0:beta%1',
  cw_entry_key: '11111111-1111-4111-8111-111111111111:uid:27',
  cw_name_format_version: 4,
};
const creatorContent = '<%_ const profile = { value: "%> creator text" }; _%>\n原本正文';

const injected = api.injectCreativeWorkshopWorldbookMetadata(creatorContent, metadata);
assert.ok(injected.startsWith('<%# poem-workshop-meta:v1-start\n'));
assert.ok(injected.includes('\npoem-workshop-meta:v1-end %>'));
assert.ok(injected.includes('\npoem-workshop-meta:v1-end %>\n\n<%_ const profile'));
assert.equal(api.stripCreativeWorkshopWorldbookMetadata(injected), creatorContent);
assert.deepEqual(JSON.parse(JSON.stringify(api.readCreativeWorkshopWorldbookMetadata(injected))), metadata);

const envelopeEnd = injected.indexOf(api.CREATIVE_WORKSHOP_WORLD_BOOK_META_END)
  + api.CREATIVE_WORKSHOP_WORLD_BOOK_META_END.length;
const blockOnly = injected.slice(0, envelopeEnd);
assert.equal(
  blockOnly.slice(0, -api.CREATIVE_WORKSHOP_WORLD_BOOK_META_END.length).includes('%>'),
  false,
  'metadata payload must not contain an early EJS close delimiter',
);

const updated = api.injectCreativeWorkshopWorldbookMetadata(injected, {
  ...metadata,
  cw_project_version: '2.2.1',
  cw_remote_version: '2.2.1',
});
assert.equal(updated.split('poem-workshop-meta:v1-start').length - 1, 1);
assert.equal(api.stripCreativeWorkshopWorldbookMetadata(updated), creatorContent);
assert.equal(api.readCreativeWorkshopWorldbookMetadata(updated).cw_project_version, '2.2.1');

const charInfoBlock = `<%# char-info-ejs-builder:start:v2 %>
<%_ const image = "avatar.png"; _%>
<%# char-info-ejs-builder:end:v2 %>
`;
const workshopAfterCharInfo = charInfoBlock + injected;
assert.deepEqual(
  JSON.parse(JSON.stringify(api.readCreativeWorkshopWorldbookMetadata(workshopAfterCharInfo))),
  metadata,
  'Workshop identity must remain readable after another tool prepends EJS',
);
assert.equal(
  api.stripCreativeWorkshopWorldbookMetadata(workshopAfterCharInfo),
  charInfoBlock + creatorContent,
  'stripping Workshop metadata must leave prepended CharInfo EJS byte-for-byte intact',
);

const updatedAfterCharInfo = api.injectCreativeWorkshopWorldbookMetadata(workshopAfterCharInfo, {
  ...metadata,
  cw_project_version: '2.3.0',
  cw_remote_version: '2.3.0',
});
assert.ok(updatedAfterCharInfo.startsWith(charInfoBlock), 'existing Workshop metadata must update in place, not jump above CharInfo');
assert.equal(updatedAfterCharInfo.split('poem-workshop-meta:v1-start').length - 1, 1);
assert.equal(api.readCreativeWorkshopWorldbookMetadata(updatedAfterCharInfo).cw_project_version, '2.3.0');
assert.equal(
  api.stripCreativeWorkshopWorldbookMetadata(updatedAfterCharInfo),
  charInfoBlock + creatorContent,
);

const workshopBlock = api.buildCreativeWorkshopWorldbookMetadataBlock(metadata);
const workshopAtBottom = creatorContent + '\nBOTTOM-SEPARATOR\n' + workshopBlock;
assert.deepEqual(
  JSON.parse(JSON.stringify(api.readCreativeWorkshopWorldbookMetadata(workshopAtBottom))),
  metadata,
  'Workshop identity position must not matter',
);
const updatedAtBottom = api.injectCreativeWorkshopWorldbookMetadata(workshopAtBottom, {
  ...metadata,
  cw_project_version: '2.4.0',
  cw_remote_version: '2.4.0',
});
assert.ok(updatedAtBottom.startsWith(creatorContent + '\nBOTTOM-SEPARATOR\n'));
assert.ok(updatedAtBottom.endsWith('poem-workshop-meta:v1-end %>'));
assert.equal(api.readCreativeWorkshopWorldbookMetadata(updatedAtBottom).cw_project_version, '2.4.0');

const staleProjectBlock = api.buildCreativeWorkshopWorldbookMetadataBlock({
  ...metadata,
  cw_project_id: 'old-project-id',
  cw_entry_key: 'old-project-id:uid:27',
});
const copiedIntoNewProject = charInfoBlock + staleProjectBlock + creatorContent;
const restampedForCurrentProject = api.injectCreativeWorkshopWorldbookMetadata(copiedIntoNewProject, metadata);
assert.ok(restampedForCurrentProject.startsWith(charInfoBlock), 'a copied single Workshop block keeps its position');
assert.equal(restampedForCurrentProject.split('poem-workshop-meta:v1-start').length - 1, 1);
assert.equal(
  api.readCreativeWorkshopWorldbookMetadata(restampedForCurrentProject).cw_project_id,
  metadata.cw_project_id,
  'a single stale Workshop block may be safely restamped for the current project',
);
assert.equal(
  api.stripCreativeWorkshopWorldbookMetadata(restampedForCurrentProject),
  charInfoBlock + creatorContent,
);

const duplicateSameIdentity =
  charInfoBlock +
  workshopBlock +
  '\nMIDDLE\n' +
  api.buildCreativeWorkshopWorldbookMetadataBlock({
    ...metadata,
    cw_project_version: '1.0.0',
    cw_remote_version: '1.0.0',
  }) +
  creatorContent;
const deduplicated = api.injectCreativeWorkshopWorldbookMetadata(duplicateSameIdentity, {
  ...metadata,
  cw_project_version: '3.0.0',
  cw_remote_version: '3.0.0',
});
assert.equal(deduplicated.split('poem-workshop-meta:v1-start').length - 1, 1, 'same-identity duplicates must collapse to one block');
assert.equal(api.readCreativeWorkshopWorldbookMetadata(deduplicated).cw_project_version, '3.0.0');
assert.equal(
  api.stripCreativeWorkshopWorldbookMetadata(deduplicated),
  charInfoBlock + '\nMIDDLE\n' + creatorContent,
  'dedupe must remove only Workshop-owned blocks and preserve surrounding creator content',
);

const conflictingBlocks =
  workshopBlock +
  '\n' +
  api.buildCreativeWorkshopWorldbookMetadataBlock({
    ...metadata,
    cw_project_id: '22222222-2222-4222-8222-222222222222',
    cw_entry_key: '22222222-2222-4222-8222-222222222222:uid:99',
  }) +
  creatorContent;
assert.equal(api.readCreativeWorkshopWorldbookMetadata(conflictingBlocks), null);
assert.throws(
  () => api.injectCreativeWorkshopWorldbookMetadata(conflictingBlocks, metadata),
  /互相冲突/,
  'different Workshop identities in one content must fail closed',
);

const malformedWorkshopBlock =
  charInfoBlock +
  '<%# poem-workshop-meta:v1-start\n{"cw_project_id":"broken"} %>' +
  creatorContent;
assert.equal(api.readCreativeWorkshopWorldbookMetadata(malformedWorkshopBlock), null);
assert.equal(api.stripCreativeWorkshopWorldbookMetadata(malformedWorkshopBlock), malformedWorkshopBlock);
assert.throws(
  () => api.injectCreativeWorkshopWorldbookMetadata(malformedWorkshopBlock, metadata),
  /损坏或不完整/,
  'malformed reserved Workshop blocks must never be silently deleted or rewritten',
);

const plainMarkerWords = '正文提到 poem-workshop-meta:v1-start 和 poem-workshop-meta:v1-end 但不是 EJS envelope';
assert.equal(
  api.injectCreativeWorkshopWorldbookMetadata(plainMarkerWords, metadata),
  api.buildCreativeWorkshopWorldbookMetadataBlock(metadata, '\n\n') + plainMarkerWords,
  'plain marker words outside the exact reserved EJS envelope are ordinary creator text',
);

const yamlStyleContent = '---\n基本信息：\n  名称：珊瑚・红';
const injectedYamlStyleContent = api.injectCreativeWorkshopWorldbookMetadata(yamlStyleContent, metadata);
assert.ok(
  injectedYamlStyleContent.includes('poem-workshop-meta:v1-end %>\n\n---\n基本信息：'),
  'Workshop metadata must leave a blank line before creator content instead of sticking to its first line',
);
assert.equal(
  api.stripCreativeWorkshopWorldbookMetadata(injectedYamlStyleContent),
  yamlStyleContent,
  'the Workshop-owned separator must be removed together with metadata so creator content round-trips exactly',
);

const creatorContentWithOwnBlankLine = '\n\n---\n作者自己保留的空行';
const injectedWithOwnBlankLine = api.injectCreativeWorkshopWorldbookMetadata(creatorContentWithOwnBlankLine, metadata);
assert.ok(injectedWithOwnBlankLine.endsWith(creatorContentWithOwnBlankLine));
assert.equal(
  api.stripCreativeWorkshopWorldbookMetadata(injectedWithOwnBlankLine),
  creatorContentWithOwnBlankLine,
  'existing creator-owned blank lines must not be consumed by metadata stripping',
);

const contentOnlyEntry = { content: injected };
assert.equal(api.getCreativeWorkshopWorldbookMetadataString(contentOnlyEntry, 'cw_project_id'), metadata.cw_project_id);
const extraWinsEntry = { content: injected, extra: { cw_project_id: 'extra-project' } };
assert.equal(api.getCreativeWorkshopWorldbookMetadataString(extraWinsEntry, 'cw_project_id'), 'extra-project');

const regexId = api.buildCreativeWorkshopRegexId(
  metadata.cw_project_id,
  'id:creator:%:规则',
  '2.2.0:beta%1',
);
assert.ok(regexId.startsWith('creative_workshop:' + metadata.cw_project_id + ':'));
assert.deepEqual(
  JSON.parse(JSON.stringify(api.parseCreativeWorkshopRegexId(regexId))),
  {
    schemaVersion: 1,
    projectId: metadata.cw_project_id,
    entryKey: 'id:creator:%:规则',
    installedVersion: '2.2.0:beta%1',
  },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(api.parseCreativeWorkshopRegexId(
    'creative_workshop:' + metadata.cw_project_id + ':id:legacy:entry',
  ))),
  {
    schemaVersion: 0,
    projectId: metadata.cw_project_id,
    entryKey: 'id:legacy:entry',
    installedVersion: null,
  },
);

console.log('CreativeWorkshop install identity smoke: ok');
