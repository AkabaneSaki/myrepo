import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
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

const multilineAssignment = analyzeProjectCode([{
  fileName: 'multiline-assignment.json',
  type: 'worldbook',
  text: worldbook([{ comment: 'valid-multiline', content: '<% { let skillCount =\n  Object.keys({ a: 1 }).length;\nvoid skillCount; } %>' }]),
}]);
assert.ok(!rules(multilineAssignment).includes('EJS-PARSE'));

const literalAssignments = analyzeProjectCode([{
  fileName: 'literal-assignments.json',
  type: 'worldbook',
  text: worldbook([{
    comment: 'valid-literals',
    content: '<% { const name = "艾莉亚"; let mode = \'\'; const signal = `prefix`; const pattern = /abc/gi; void name; void mode; void signal; void pattern; } %>',
  }]),
}]);
assert.ok(!rules(literalAssignments).includes('EJS-PARSE'));

const commentOnlyMissingRhs = analyzeProjectCode([{
  fileName: 'missing-rhs-comment.json',
  type: 'worldbook',
  text: worldbook([{ comment: 'broken-comment-rhs', content: '<% const broken = /* still empty */ ; %>' }]),
}]);
assert.ok(rules(commentOnlyMissingRhs).includes('EJS-PARSE'));

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
assert.match(uploadPreviewSource, /function groupUploadPreflightFindings/);
assert.match(uploadPreviewSource, /function buildUploadLlmFixPrompt/);
assert.match(uploadPreviewSource, /function downloadUploadCheckReport/);
assert.match(uploadPreviewSource, /data-upload-copy-group/);
assert.match(uploadPreviewSource, /data-upload-copy-all/);
assert.match(uploadPreviewSource, /data-upload-export-report/);
assert.match(uploadPreviewSource, /自动检查未通过：发现/);
assert.match(uploadPreviewSource, /upload-preflight-group-name/);
assert.match(editorSource, /prepared\.codeCheck, prepared, kind/);

const uploadPreviewModule = await import('data:text/javascript;base64,' + Buffer.from(uploadPreviewSource).toString('base64'));
const uploadPreviewContext = {};
vm.runInNewContext(
  uploadPreviewModule.homeUploadPreviewScript
    + '\n;globalThis.__uploadPreviewTest={groupUploadPreflightFindings,buildUploadLlmFixPrompt,buildUploadCheckReport};',
  uploadPreviewContext,
);
const uploadPreviewTest = uploadPreviewContext.__uploadPreviewTest;
const groupedFindings = [
  { ruleId: 'L2', severity: 'high', title: '顶层 let', detail: 'A', suggestion: '局部化', entry: 'Entry A', uid: 1, line: 5, column: 1, book: 'demo.json' },
  { ruleId: 'L4', severity: 'high', title: '裸赋值', detail: 'B', suggestion: '声明变量', entry: 'Entry A', uid: 1, line: 9, column: 1, book: 'demo.json' },
  { ruleId: 'L2', severity: 'high', title: '顶层 let', detail: 'C', suggestion: '局部化', entry: 'Entry B', uid: 2, line: 3, column: 1, book: 'demo.json' },
];
const groupedPrepared = { entries: [
  { uid: 1, comment: 'Entry A', content: '<% let a = 1; %>' },
  { uid: 2, comment: 'Entry B', content: '<% let b = 2; %>' },
  { uid: 3, comment: 'Healthy', content: 'no issue' },
] };
const groupedCards = uploadPreviewTest.groupUploadPreflightFindings(groupedFindings);
assert.equal(groupedCards.length, 2);
assert.equal(groupedCards[0].findings.length, 2);
const entryPrompt = uploadPreviewTest.buildUploadLlmFixPrompt(groupedCards[0].findings, groupedPrepared, 'worldbook');
assert.match(entryPrompt, /\[L2\]/);
assert.match(entryPrompt, /\[L4\]/);
assert.match(entryPrompt, /<% let a = 1; %>/);
assert.doesNotMatch(entryPrompt, /<% let b = 2; %>/);
assert.doesNotMatch(entryPrompt, /no issue/);
const exportedReport = uploadPreviewTest.buildUploadCheckReport({ gate: 'reject', findings: groupedFindings }, groupedPrepared, 'worldbook');
assert.match(exportedReport, /Poem Workshop 上传检查报告/);
assert.match(exportedReport, /给 LLM 的修复提示/);
assert.match(exportedReport, /Entry A/);
assert.match(exportedReport, /Entry B/);

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
