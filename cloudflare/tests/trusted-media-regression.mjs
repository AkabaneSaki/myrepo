import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { analyzeProjectCodeV2 } from '../src/utils/ejs-checker/index.mjs';
import { collectProjectExternalLinks, externalLinksNeedingReview } from '../src/utils/external-links/collect.mjs';

const A = 'https://files.catbox.moe/a.png';
const B = 'https://i.ibb.co/b.webp';
const BAD = 'https://other.example/c.png';
const ejs = code => '@@private\n<% { ' + code + ' } %>';
const projectFor = (content, type) => type === 'regex' ? { regexEntries: [{ replaceString: content }] } : { worldbookEntries: [{ content }] };
const reportFor = (content, type) => analyzeProjectCodeV2([{ fileName: 'media.json', type, text: JSON.stringify(type === 'regex' ? { id: 'media', findRegex: 'x', replaceString: content } : { entries: { 1: { content } } }) }]);
const linkFindings = report => report.findings.filter(item => /^U[2-5]$/.test(item.ruleId) || item.ruleId === 'AH2');
let cases = 0;

const trusted = [
  ['HTML image', `<img src="${A}">`],
  ['HTML video/poster', `<video src="https://files.catbox.moe/a.mp4" poster="${B}"></video>`],
  ['HTML srcset', `<picture><source srcset="${A} 1x, ${B} 2x"></picture>`],
  ['CSS style attribute', `<div style="background-image:url('${A}')"></div>`],
  ['CSS stylesheet', `<style>.portrait { background: url(${A}) }</style>`],
  ['Markdown media', `![立绘](${A})`],
];
for (const type of ['worldbook', 'regex']) for (const [label, content] of trusted) {
  const records = collectProjectExternalLinks(projectFor(content, type));
  assert.ok(records.length, `${type}/${label}: media observation missing`);
  assert.deepEqual(externalLinksNeedingReview(records), [], `${type}/${label}: audit noise`);
  assert.deepEqual(linkFindings(reportFor(content, type)), [], `${type}/${label}: checker noise`);
  cases++;
}
for (const [label, code] of [
  ['media property', `const profile={avatarUrl:"${A}"};`],
  ['media assignment', `image.src="${A}";`],
  ['DOM media element', `const portrait=document.createElement('img'); portrait.src="${A}";`],
  ['const reference', `const chosen="${A}"; image.src=chosen;`],
  ['trusted conditional', `image.src=flag?"${A}":"${B}";`],
  ['trusted candidate map', `const choices={one:"${A}",two:"${B}"}; image.src=choices[mood];`],
]) {
  const content = ejs(code);
  const records = collectProjectExternalLinks(projectFor(content, 'worldbook'));
  assert.ok(records.length, label);
  assert.deepEqual(externalLinksNeedingReview(records), [], label);
  assert.deepEqual(linkFindings(reportFor(content, 'worldbook')), [], label);
  cases++;
}

// One URL identity, separate media and non-media observations even within a source.
for (const type of ['worldbook', 'regex']) for (const content of [
  `<img src="${A}">请参考 ${A}`,
  `<img src="${A}"><a href="${A}">查看</a>`,
  `<img src="${A}">[查看](${A})`,
]) {
  const records = collectProjectExternalLinks(projectFor(content, type));
  assert.equal(records.length, 1, 'normalized identity duplicated');
  assert.ok(records[0].observations.some(item => item.usage === 'media' && item.trust === 'trusted'));
  assert.equal(externalLinksNeedingReview(records).length, 1, 'media laundered prose/navigation');
  assert.ok(linkFindings(reportFor(content, type)).some(item => item.ruleId === 'U2'));
  cases++;
}
for (const code of [
  `const chosen="${A}"; image.src=chosen; const explanation="${A}";`,
  `const image="${A}"; window.open(image);`,
  `const image="${A}"; fetch(image);`,
  `const chosen="${A}"; image.src=chosen; const link=document.createElement('a'); link.href=chosen;`,
  `const chosen="${A}"; image.src=chosen; const link=document.createElement('a'); link.setAttribute('href',chosen);`,
  `const chosen="${A}"; image.src=chosen; console.log(chosen);`,
  `const chosen="${A}"; image.src=chosen; console.log(chosen.trim());`,
]) {
  const content = ejs(code);
  const records = collectProjectExternalLinks(projectFor(content, 'worldbook'));
  assert.equal(externalLinksNeedingReview(records).length, 1, code);
  assert.ok(linkFindings(reportFor(content, 'worldbook')).some(item => item.ruleId === 'U2'), code);
  cases++;
}
for (const field of ['description', 'precautions']) {
  const records = collectProjectExternalLinks({ ...projectFor(`<img src="${A}">`, 'regex'), [field]: `说明 ${A}` });
  assert.equal(records.length, 1);
  assert.deepEqual(externalLinksNeedingReview(records)[0].reviewSources, [field]);
  cases++;
}

for (const value of [
  'http://files.catbox.moe/a.png', 'https://sub.files.catbox.moe/a.png',
  'https://files.catbox.moe.evil.example/a.png', 'https://files.catbox.moe/a.js',
  'https://u:p@files.catbox.moe/a.png', 'https://files.catbox.moe/$1.png',
  'https://files.catbox.moe/$<mood>.png', 'https://files.catbox.moe/$&.png',
]) {
  const content = `<img src="${value}">`;
  assert.equal(externalLinksNeedingReview(collectProjectExternalLinks(projectFor(content, 'regex'))).length, 1, value);
  assert.ok(linkFindings(reportFor(content, 'regex')).length, value);
  cases++;
}
for (const content of [`请看 ${A}`, `文字 url(${A})`, `<a href="${A}">跳转</a>`, `<link href="${A}">`, `<style>@import url(${A});</style>`, `<style>.x::before{content:"url(${A})"}</style>`, `<div style='content:"url(${A})"'></div>`, `<style>/* .x{background:url(${A})} */</style>`]) {
  assert.equal(externalLinksNeedingReview(collectProjectExternalLinks(projectFor(content, 'regex'))).length, 1, content);
  assert.ok(linkFindings(reportFor(content, 'regex')).length, content);
  cases++;
}
for (const code of [
  `image.src=flag?"${A}":"${BAD}";`,
  `const choices={one:"${A}",two:runtimeTarget}; image.src=choices[mood];`,
  `const choices={one:"${A}",...runtimeChoices}; image.src=choices[mood];`,
  `const fallback="${A}"; image.src=runtimeTarget;`,
  'image.src=runtimeTarget;',
  'image.src=`https://files.catbox.moe/${mood}.png`;',
  `const choices=["${A}"]; choices.push(runtimeTarget); image.src=choices[mood];`,
  `const choices={one:"${A}"}; Object.assign(choices, runtimeChoices); image.src=choices[mood];`,
  `const choices={one:"${A}"}; const alias=choices; alias.two=runtimeTarget; image.src=choices[mood];`,
]) {
  const report = reportFor(ejs(code), 'worldbook');
  assert.equal(report.audit, 'yellow', code);
  assert.ok(linkFindings(report).length, code);
  cases++;
}
for (const content of ['<img src="<%= runtimeTarget %>">', '<img src="https://files.catbox.moe/<%= mood %>.png">', '<style>.a{background:url("https://files.catbox.moe/<%= mood %>.png")}</style>']) {
  assert.ok(linkFindings(reportFor(ejs('') + content, 'worldbook')).some(item => item.ruleId === 'AH2'), content);
  assert.equal(collectProjectExternalLinks(projectFor(content, 'worldbook')).some(record => record.observations.some(item => item.trust === 'trusted')), false, content);
  cases++;
}
const outputReuse = `@@private\n<% const chosen="${A}"; image.src=chosen; %><%= chosen %>`;
assert.equal(externalLinksNeedingReview(collectProjectExternalLinks(projectFor(outputReuse, 'worldbook'))).length, 1);
assert.ok(linkFindings(reportFor(outputReuse, 'worldbook')).some(item => item.ruleId === 'U2'));
cases++;
const transformedOutputReuse = `@@private\n<% const chosen="${A}"; image.src=chosen; %><%= chosen.trim() %>`;
assert.equal(externalLinksNeedingReview(collectProjectExternalLinks(projectFor(transformedOutputReuse, 'worldbook'))).length, 1);
assert.ok(linkFindings(reportFor(transformedOutputReuse, 'worldbook')).some(item => item.ruleId === 'U2'));
cases++;

// Audit rendering consumes the same summary; trusted media requires no acknowledgement.
const loadScript = (path, name) => {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const expression = source.slice(source.indexOf(`export const ${name} = `) + `export const ${name} = `.length).trim().replace(/;$/, '');
  return Function(`return (${expression});`)();
};
const detailScript = loadScript('../src/pages/home/render/detail-modal.ts', 'homeDetailModalRenderScript');
const adminScript = loadScript('../src/pages/home/modal/admin-review.ts', 'homeAdminReviewModalScript');
const ui = runInNewContext(detailScript + '\n' + adminScript + '\n({ renderExternalLinksPanel, renderAdminInspectionSignals })', { escapeHtml: value => String(value) });
const summary = input => {
  const externalLinkRecords = collectProjectExternalLinks(input);
  return { externalLinkRecords, externalLinksNeedingReview: externalLinksNeedingReview(externalLinkRecords) };
};
const mediaProject = summary(projectFor(`<img src="${A}">`, 'regex'));
assert.equal(ui.renderExternalLinksPanel([], [], { project: mediaProject, reviewOnly: true }), '');
assert.equal(ui.renderAdminInspectionSignals([], [], mediaProject).includes('外链 1'), false);
const proseProject = summary({ ...projectFor(`<img src="${A}">`, 'regex'), description: A });
assert.ok(ui.renderAdminInspectionSignals([], [], proseProject).includes('外链 1'));
const panel = ui.renderExternalLinksPanel([], [], { project: proseProject, reviewOnly: true });
assert.ok(panel.includes(A));
assert.ok(panel.includes('简介'));
assert.equal(panel.includes('description'), false);
cases++;

// Exercise the shipped browser Worker message, not just the source collector.
const workerBase64 = readFileSync(new URL('../src/generated/upload-checker.txt', import.meta.url), 'utf8');
let response;
const self = { postMessage: value => { response = value; } };
runInNewContext(Buffer.from(workerBase64, 'base64').toString('utf8'), { self, URL, TextEncoder, setTimeout, clearTimeout });
await self.onmessage({ data: { operation: 'external-links', project: projectFor(`<img src="${A}">`, 'regex') } });
assert.equal(response.success, true);
assert.equal(response.summary.externalLinksNeedingReview.length, 0);
assert.equal(response.summary.externalLinkRecords[0].observations[0].usage, 'media');
cases++;
console.log(`trusted-media regression: ${cases} cases passed`);
