import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyzeProjectCode, formatUploaderCodeCheckError, toUploaderCodeCheck } from '../src/utils/ejs-preflight.mjs';

function worldbook(entries) {
  return JSON.stringify({ entries: Object.fromEntries(entries.map((entry, index) => [String(index), { uid: index, ...entry }])) });
}

function regexFile(scripts) {
  return JSON.stringify(scripts);
}

function rules(report) {
  return report.findings.map(item => item.ruleId);
}

const safe = analyzeProjectCode([{
  fileName: 'safe.json',
  type: 'worldbook',
  text: worldbook([{ comment: 'safe', content: '<% { const value = 1; void value; } %>' }]),
}]);
assert.equal(safe.gate, 'accept');
assert.equal(safe.audit, 'green');

const lexical = analyzeProjectCode([{
  fileName: 'lexical.json',
  type: 'worldbook',
  text: worldbook([{ comment: 'bad-top-level', content: '<% const leaked = 1; %>' }]),
}]);
assert.equal(lexical.gate, 'reject');
assert.ok(rules(lexical).includes('L2'));
assert.match(formatUploaderCodeCheckError(lexical), /L2/);

const syntax = analyzeProjectCode([{
  fileName: 'syntax.json',
  type: 'worldbook',
  text: worldbook([{ comment: 'broken', content: '<% const broken = ; %>' }]),
}]);
assert.equal(syntax.gate, 'reject');
assert.ok(rules(syntax).includes('EJS-PARSE'));

const collision = analyzeProjectCode([{
  fileName: 'collision.json',
  type: 'worldbook',
  text: worldbook([
    { comment: 'one', content: '<% const duplicate = 1; %>' },
    { comment: 'two', content: '<% const duplicate = 2; %>' },
  ]),
}]);
assert.ok(rules(collision).includes('L6'));

const multiIssue = analyzeProjectCode([{
  fileName: 'multi.json',
  type: 'worldbook',
  text: worldbook([
    { comment: 'one', content: '<% const duplicate = 1; %>' },
    { comment: 'two', content: '<% const duplicate = 2; %>' },
    { comment: 'bad-private', content: '\n@@private\n<% const local = 1; %>' },
  ]),
}]);
const multiUploader = toUploaderCodeCheck(multiIssue);
assert.ok(multiUploader.findings.length >= 5);
assert.ok(multiUploader.findings.some(item => item.ruleId === 'L6'));
assert.ok(multiUploader.findings.some(item => item.ruleId === 'L7'));

const decorator = analyzeProjectCode([{
  fileName: 'decorator.json',
  type: 'worldbook',
  text: worldbook([{ comment: 'bad-private', content: '\n@@private\n<% const local = 1; %>' }]),
}]);
assert.equal(decorator.gate, 'reject');
assert.ok(rules(decorator).includes('L7'));

const evalReport = analyzeProjectCode([{
  fileName: 'eval.json',
  type: 'worldbook',
  text: worldbook([{ comment: 'eval', content: '<% { const x = eval("1+1"); void x; } %>' }]),
}]);
assert.equal(evalReport.gate, 'reject');
assert.ok(rules(evalReport).includes('M1'));
const uploaderEval = toUploaderCodeCheck(evalReport);
assert.ok(uploaderEval.findings.some(item => item.ruleId === 'SCRIPT-RISK'));
assert.ok(!uploaderEval.findings.some(item => item.ruleId === 'M1'));

const network = analyzeProjectCode([{
  fileName: 'network.json',
  type: 'worldbook',
  text: worldbook([{ comment: 'network', content: '<% { fetch("https://example.com/data"); } %>' }]),
}]);
assert.equal(network.gate, 'accept');
assert.equal(network.audit, 'yellow');
assert.ok(rules(network).includes('M4'));
assert.ok(!toUploaderCodeCheck(network).findings.some(item => item.ruleId === 'M4'));

const regexEval = analyzeProjectCode([{
  fileName: 'regex.json',
  type: 'regex',
  text: regexFile([{ id: 'r1', scriptName: 'bad regex', findRegex: 'x', replaceString: '<script>eval("1+1")</script>' }]),
}]);
assert.equal(regexEval.gate, 'reject');
assert.ok(rules(regexEval).includes('M1'));
assert.ok(!rules(regexEval).some(rule => /^L[1-7]$/.test(rule)));

const assetsSource = fs.readFileSync(new URL('../src/endpoints/projects/assets.ts', import.meta.url), 'utf8');
assert.match(assetsSource, /analyzeProjectCode\(\[\{ fileName: `project-\$\{projectId\}\.json`/);
assert.match(assetsSource, /analyzeProjectCode\(\[\{ fileName: `regex-\$\{projectId\}\.json`/);
assert.match(assetsSource, /toUploaderCodeCheck\(codeCheck\)/);
assert.match(assetsSource, /422/);
assert.match(assetsSource, /class ProjectUploadPreflight/);
assert.match(assetsSource, /自动检查通过，可以继续/);

const indexSource = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
assert.match(indexSource, /\/api\/projects\/preflight\/:kind/);

const apiSource = fs.readFileSync(new URL('../src/pages/home/api.ts', import.meta.url), 'utf8');
assert.match(apiSource, /async function preflightProjectUpload\(file, kind\)/);
assert.match(apiSource, /\/api\/projects\/preflight\//);

const editorSource = fs.readFileSync(new URL('../src/pages/home/modal/project-editor.ts', import.meta.url), 'utf8');
assert.match(editorSource, /runPreparedPreflight/);
assert.match(editorSource, /preflightState !== "ok"/);
assert.match(editorSource, /自动检查通过，可以继续/);

const uploadPreviewSource = fs.readFileSync(new URL('../src/pages/home/upload-preview.ts', import.meta.url), 'utf8');
assert.match(uploadPreviewSource, /function renderUploadPreflightStatus/);
assert.match(uploadPreviewSource, /upload-preflight-status/);
assert.match(uploadPreviewSource, /codeCheck\.findings/);
assert.match(uploadPreviewSource, /findings\.map/);
assert.match(uploadPreviewSource, /自动检查未通过：发现/);
assert.match(uploadPreviewSource, /upload-preflight-finding-title/);
assert.match(editorSource, /prepared\.codeCheck\);/);

const stylesSource = fs.readFileSync(new URL('../src/pages/home/styles.ts', import.meta.url), 'utf8');
assert.match(stylesSource, /data-admin-review-theme="light"\] \.admin-code-check-head strong/);
assert.match(stylesSource, /data-admin-review-theme="light"\] \.external-links-note/);

const adminSource = fs.readFileSync(new URL('../src/endpoints/admin.ts', import.meta.url), 'utf8');
assert.match(adminSource, /codeCheckInputs/);
assert.match(adminSource, /codeCheck\.gate === 'reject'/);
assert.match(adminSource, /codeCheck,/);

const adminUiSource = fs.readFileSync(new URL('../src/pages/home/modal/admin-review.ts', import.meta.url), 'utf8');
assert.match(adminUiSource, /function renderAdminCodeCheck\(report\)/);
assert.match(adminUiSource, /renderAdminCodeCheck\(codeCheck\)/);
assert.match(adminUiSource, /codeCheck\?\.gate === \"reject\" \? \"disabled\"/);

console.log('EJS upload gate + audit report smoke: ok');
