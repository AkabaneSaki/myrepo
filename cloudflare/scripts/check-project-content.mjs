import assert from 'node:assert/strict';
import { validateProjectContentPolicy } from '../src/config/project-content-policy.ts';
import {
  extractProjectEntries,
  isEmptyProjectContentText,
  removeProjectEntryFromJson,
  validateProjectContentText,
} from '../src/utils/project-content.ts';
import {
  CHARACTER_ARTWORK_INCOMPLETE_WARNING,
  inspectProjectEntry,
} from '../src/utils/project-inspection.ts';
import { parseRegexEntriesPreview, parseWorldbookEntriesPreview, summarizeProjectInspection } from '../src/utils/project-preview.ts';

const arrayBook = JSON.stringify({ entries: [
  { uid: 10, comment: 'A' },
  { uid: 20, comment: 'B' },
  { uid: 30, comment: 'C' },
] });
assert.deepEqual(extractProjectEntries(JSON.parse(arrayBook), 'worldbook').map(item => item.entryKey), [
  'uid:10', 'uid:20', 'uid:30',
]);
const arrayRemoved = JSON.parse(removeProjectEntryFromJson(arrayBook, 'worldbook', 'uid:20').text);
assert.deepEqual(arrayRemoved.entries.map(entry => entry.uid), [10, 30]);

const objectBook = JSON.stringify({ entries: {
  alpha: { uid: 1, comment: 'A' },
  beta: { uid: 2, comment: 'B' },
} });
assert.deepEqual(extractProjectEntries(JSON.parse(objectBook), 'worldbook').map(item => item.entryKey), [
  'object:alpha', 'object:beta',
]);
const objectRemoved = JSON.parse(removeProjectEntryFromJson(objectBook, 'worldbook', 'object:alpha').text);
assert.deepEqual(Object.keys(objectRemoved.entries), ['beta']);

const singleRegex = JSON.stringify({ id: 'cleanup', scriptName: 'Cleanup' });
const regexRemoved = JSON.parse(removeProjectEntryFromJson(singleRegex, 'regex', 'id:cleanup').text);
assert.deepEqual(regexRemoved, []);

assert.throws(() => removeProjectEntryFromJson(arrayBook, 'worldbook', 'uid:999'), /条目不存在/);

assert.equal(validateProjectContentText(arrayBook, 'worldbook').valid, true);
assert.equal(validateProjectContentText(objectBook, 'worldbook').valid, true);
assert.equal(validateProjectContentText('[{"id":"cleanup","scriptName":"Cleanup","findRegex":"foo"}]', 'regex').valid, true);
assert.equal(validateProjectContentText(arrayBook, 'regex').valid, false);
assert.match(validateProjectContentText(arrayBook, 'regex').error, /世界书/);
assert.equal(validateProjectContentText(singleRegex, 'worldbook').valid, false);
assert.match(validateProjectContentText(singleRegex, 'worldbook').error, /正则/);
assert.equal(validateProjectContentText('[{"id":"cleanup","findRegex":"foo"}]', 'regex').valid, false);
assert.equal(isEmptyProjectContentText('[]', 'regex'), true);
assert.equal(isEmptyProjectContentText('{"entries":{}}', 'regex'), true);
assert.equal(isEmptyProjectContentText('{"entries":[]}', 'worldbook'), true);
assert.equal(validateProjectContentPolicy(['角色'], { worldbook: false, regex: true }).valid, false);
assert.equal(validateProjectContentPolicy(['系统'], { worldbook: false, regex: true }).valid, false);
assert.equal(validateProjectContentPolicy(['事件'], { worldbook: false, regex: true }).valid, false);
assert.equal(validateProjectContentPolicy(['扩展'], { worldbook: false, regex: true }).valid, true);
assert.equal(validateProjectContentPolicy(['扩展', '角色'], { worldbook: false, regex: true }).valid, false);
assert.equal(validateProjectContentPolicy(['扩展'], { worldbook: true, regex: false }).valid, true);
assert.equal(validateProjectContentPolicy(['扩展'], { worldbook: false, regex: false }).valid, false);
assert.equal(validateProjectContentText(singleRegex, 'regex').valid, true);
assert.equal(validateProjectContentText('{"hello":"world"}', 'worldbook').valid, false);
assert.equal(validateProjectContentText('{"hello":"world"}', 'regex').valid, false);
assert.equal(validateProjectContentText('{"entries":[]}', 'worldbook').valid, false);
assert.equal(validateProjectContentText('not-json', 'worldbook').valid, false);

const plainInspection = inspectProjectEntry({ content: '普通世界书内容' }, 'worldbook');
assert.equal(plainInspection.hasEjs, false);
assert.equal(plainInspection.hasCharacterArtwork, false);
assert.deepEqual(plainInspection.externalLinks, []);

const normalEjsInspection = inspectProjectEntry({ content: '<%_ const value = 1; _%>正文' }, 'worldbook');
assert.equal(normalEjsInspection.hasEjs, true);
assert.equal(normalEjsInspection.hasCharacterArtwork, false);

const artworkContent = `<%# char-info-ejs-builder:start:v2 %>
<%_
{
  const profile = {
    "characterName": "克瑞西达",
    "avatarUrl": "https://files.catbox.moe/2lwbf6.png",
    "coverUrl": "https://files.catbox.moe/p6vp2s.png",
    "gallery": [{ "title": "主立绘", "sources": ["https://files.catbox.moe/9ayahb.webm"] }]
  };
  setLocalVar('char_info.profile', profile);
}
_%>
<%# char-info-ejs-builder:end:v2 %>`;
const artworkInspection = inspectProjectEntry({ content: artworkContent }, 'worldbook');
assert.equal(artworkInspection.hasEjs, true);
assert.equal(artworkInspection.hasCharacterArtwork, true);
assert.equal(artworkInspection.characterArtworkBlockCount, 1);
assert.deepEqual(artworkInspection.inspectionWarnings, []);
assert.deepEqual(artworkInspection.externalLinks, [
  { url: 'https://files.catbox.moe/2lwbf6.png', hostname: 'files.catbox.moe' },
  { url: 'https://files.catbox.moe/p6vp2s.png', hostname: 'files.catbox.moe' },
  { url: 'https://files.catbox.moe/9ayahb.webm', hostname: 'files.catbox.moe' },
]);

const brokenArtworkInspection = inspectProjectEntry(
  { content: '<%# char-info-ejs-builder:start:v2 %>\n<%_ const profile = {}; _%>\n后面的世界书正文' },
  'worldbook',
);
assert.equal(brokenArtworkInspection.hasEjs, true);
assert.equal(brokenArtworkInspection.hasCharacterArtwork, false);
assert.deepEqual(brokenArtworkInspection.inspectionWarnings, [CHARACTER_ARTWORK_INCOMPLETE_WARNING]);

const findOnlyRegexInspection = inspectProjectEntry(
  { findRegex: 'https://match-only.example/foo', replaceString: '普通替换文本' },
  'regex',
);
assert.equal(findOnlyRegexInspection.hasEjs, false);
assert.deepEqual(findOnlyRegexInspection.externalLinks, []);

const replaceEjsInspection = inspectProjectEntry(
  { findRegex: 'foo', replaceString: '<%= value %>' },
  'regex',
);
assert.equal(replaceEjsInspection.hasEjs, true);

const externalLinkInspection = inspectProjectEntry(
  {
    content:
      '图一 https://Example.com/a.png，重复 https://example.com/a.png。\n文档：https://docs.example.com/readme?q=1).',
  },
  'worldbook',
);
assert.deepEqual(externalLinkInspection.externalLinks, [
  { url: 'https://example.com/a.png', hostname: 'example.com' },
  { url: 'https://docs.example.com/readme?q=1', hostname: 'docs.example.com' },
]);

const unsafeSchemeInspection = inspectProjectEntry(
  { content: 'javascript:alert(1) file:///C:/secret.txt data:text/html,bad' },
  'worldbook',
);
assert.deepEqual(unsafeSchemeInspection.externalLinks, []);

const htmlBoundaryInspection = inspectProjectEntry(
  { content: 'https://example.com/image.png<script>alert(1)</script>' },
  'worldbook',
);
assert.deepEqual(htmlBoundaryInspection.externalLinks, [
  { url: 'https://example.com/image.png', hostname: 'example.com' },
]);

const previewBook = JSON.stringify({ entries: [{ uid: 1, comment: '立绘模板', content: artworkContent }] });
const previewEntry = parseWorldbookEntriesPreview(previewBook)[0];
assert.equal(previewEntry.hasEjs, true);
assert.equal(previewEntry.hasCharacterArtwork, true);
assert.equal(previewEntry.characterArtworkBlockCount, 1);
assert.equal(previewEntry.externalLinks.length, 3);


const behaviorPreview = parseWorldbookEntriesPreview(JSON.stringify({ entries: [
  { uid: 2, comment: 'Nested', position: { type: 'at_depth', depth: 6, order: 601, role: 'assistant' } },
  { uid: 3, comment: 'Legacy', position: 0, depth: 4, order: -20, role: 1 },
] }));
assert.deepEqual(
  { positionType: behaviorPreview[0].positionType, depth: behaviorPreview[0].depth, order: behaviorPreview[0].order, role: behaviorPreview[0].role },
  { positionType: 'at_depth', depth: 6, order: 601, role: 'assistant' },
);
assert.deepEqual(
  { positionType: behaviorPreview[1].positionType, depth: behaviorPreview[1].depth, order: behaviorPreview[1].order, role: behaviorPreview[1].role },
  { positionType: 'before_character_definition', depth: 4, order: -20, role: 'user' },
);

const regexPreview = parseRegexEntriesPreview(JSON.stringify([{ id: 'ejs', replaceString: '<%= value %>' }]))[0];
assert.equal(regexPreview.hasEjs, true);
assert.equal(regexPreview.hasCharacterArtwork, false);
assert.deepEqual(regexPreview.externalLinks, []);

assert.deepEqual(summarizeProjectInspection([previewEntry], [regexPreview]), { hasEjs: true, hasCharacterArtwork: true });
assert.deepEqual(summarizeProjectInspection([], []), { hasEjs: false, hasCharacterArtwork: false });

console.log('project content validation, entry removal, and content inspection OK');
