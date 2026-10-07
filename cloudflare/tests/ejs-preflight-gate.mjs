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
const adminSource = fs.readFileSync(new URL('../src/endpoints/admin.ts', import.meta.url), 'utf8');

// #42: the Worker must never execute the heavy checker on the upload or review path.
const indexTsSource = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
assert.doesNotMatch(assetsSource, /analyzeProjectCodeCached|analyzeProjectCodeV2/, 'upload and preflight must not run the heavy checker');
assert.doesNotMatch(adminSource, /analyzeProjectCodeCached|analyzeProjectCodeV2/, 'review detail and approval must not run the heavy checker');
assert.doesNotMatch(adminSource, /buildAuditSnapshot/, 'only the device may build an audit snapshot');
assert.match(assetsSource, /issueCreatorAttestation/, 'preflight must stamp a content attestation');
assert.match(assetsSource, /verifyCreatorAttestation/, 'uploads must verify the attestation');
assert.match(assetsSource, /x-workshop-content-attestation/);
assert.match(assetsSource, /hashContentText/);
assert.match(assetsSource, /class ProjectUploadPreflight/);
assert.match(assetsSource, /class ProjectUpload/);
assert.match(assetsSource, /class ProjectRegexUpload/);
assert.match(adminSource, /issueReviewChallenge/);
assert.match(adminSource, /verifyReviewerResult/);
assert.match(adminSource, /contentFilesHash/);
assert.match(indexTsSource, /\/assets\/review-checker\.js/);
assert.match(indexTsSource, /CODE_CHECK_SERVICE/, 'durable object routing must be retained on the live worker');

const indexSource = indexTsSource;
assert.match(indexSource, /\/api\/projects\/preflight\/:kind/);

const apiSource = fs.readFileSync(new URL('../src/pages/home/api.ts', import.meta.url), 'utf8');
assert.match(apiSource, /async function preflightProjectUpload\(file, kind\)/);
assert.match(apiSource, /\/api\/projects\/preflight\//);
assert.match(apiSource, /X-Workshop-Content-Attestation/);
assert.match(apiSource, /function runAdminReviewDeviceCheck\(deviceCheck\)/);
assert.match(apiSource, /REVIEW_CHECKER_URL/);

const editorSource = fs.readFileSync(new URL('../src/pages/home/modal/project-editor.ts', import.meta.url), 'utf8');
assert.match(editorSource, /runPreparedPreflight/);
assert.match(editorSource, /preflightState !== "ok"/);
assert.match(editorSource, /prepared\.attestation = result\.attestation/);

const adminUiSource = fs.readFileSync(new URL('../src/pages/home/modal/admin-review.ts', import.meta.url), 'utf8');
assert.match(adminUiSource, /function renderAdminCodeCheck\(report, detail = null\)/);
assert.match(adminUiSource, /renderAdminCodeCheck\(codeCheck, checkDetail\)/);
assert.match(adminUiSource, /runAdminReviewDeviceCheck\(detail\.deviceCheck\)/);
assert.match(adminUiSource, /reviewerResult: \{ \.\.\.deviceResult/);
assert.doesNotMatch(adminUiSource, /reviewToken: detail\.reviewToken/, 'the review token was replaced by a content-bound device result');

const attestationSource = fs.readFileSync(new URL('../src/utils/ejs-checker/attestation.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(attestationSource, /^import /m, 'binding helpers must import no checker engine');
assert.doesNotMatch(attestationSource, /analyzeProjectCode|parseEjs|from 'parse5'|from 'acorn'/);

const uploadWorkerSource = fs.readFileSync(new URL('../src/utils/ejs-checker/upload-worker.mjs', import.meta.url), 'utf8');
assert.match(uploadWorkerSource, /analyzeProjectCodeV2/, 'the creator device must run the complete rule set');
const reviewWorkerSource = fs.readFileSync(new URL('../src/utils/ejs-checker/review-worker.mjs', import.meta.url), 'utf8');
assert.match(reviewWorkerSource, /analyzeProjectCodeV2/, 'the reviewer device must run the complete rule set');
assert.match(reviewWorkerSource, /applyAuditBaseline/);

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
assert.match(entryPrompt, /SillyTavern \/ 命定创意工坊/);
assert.match(entryPrompt, /本次提供的世界书条目总数：1/);
assert.match(entryPrompt, /## 世界书条目 1/);
assert.match(entryPrompt, /多个 <% \.\.\. %> EJS 代码块/);
assert.match(entryPrompt, /\[L1\] 顶层 var/);
assert.match(entryPrompt, /\[L6\] 跨世界书条目名称冲突/);
assert.match(entryPrompt, /不要写“无法完整验证”/);
assert.match(entryPrompt, /自检结果：[\s\S]*L1: PASS \/ FAIL[\s\S]*L7: PASS \/ FAIL/);
assert.doesNotMatch(entryPrompt, /Owner \/ Lifecycle \/ Cleanup/);
const exportedReport = uploadPreviewTest.buildUploadCheckReport({ gate: 'reject', engine: 'v2', parserCompatibility: 'test parser', findings: groupedFindings }, groupedPrepared, 'worldbook');
assert.match(exportedReport, /命定创意工坊上传检查报告/);
assert.match(exportedReport, /给 LLM 的修复提示/);
assert.match(exportedReport, /Entry A/);
assert.match(exportedReport, /Entry B/);
assert.match(exportedReport, /检查版本：v2/);
assert.match(exportedReport, /语法检查依据：test parser/);
assert.match(uploadPreviewTest.buildUploadLlmFixPrompt([{ruleId:'CHECKER-INTERNAL'}], groupedPrepared, 'worldbook'), /无需因此修改源码/);
const parseOnlyPrompt = uploadPreviewTest.buildUploadLlmFixPrompt([{
  ruleId:'EJS-PARSE', severity:'high', title:'EJS 无法解析', detail:'语法错误', suggestion:'修复语法',
  entry:'Entry A', uid:1, line:1, column:1, book:'demo.json',
}], groupedPrepared, 'worldbook');
assert.match(parseOnlyPrompt, /优先简单、局部、保守/);
assert.match(parseOnlyPrompt, /不确定时不要猜测命定创意工坊或 SillyTavern 的隐藏实现/);
assert.doesNotMatch(parseOnlyPrompt, /Owner \/ Lifecycle \/ Cleanup/);
assert.doesNotMatch(parseOnlyPrompt, /项目专属、明确的 globalThis 命名空间/);

const offlineSource = fs.readFileSync(new URL('../../util/ejs-preflight.html', import.meta.url), 'utf8');
assert.match(offlineSource, /命定创意工坊 · EJS \/ 正则检查/);
assert.match(offlineSource, /TXT 模式一次只检查 1 个世界书条目/);
assert.match(offlineSource, /粘贴纯文本一次只检查 1 个世界书条目/);
assert.match(offlineSource, /function analyzeSingleWorldbookText/);
assert.match(offlineSource, /function makeSingleWorldbookInput/);
assert.match(offlineSource, /character_book/);
assert.match(offlineSource, /本次提供的世界书条目总数/);
assert.match(offlineSource, /不要写“无法完整验证”/);

const stylesSource = fs.readFileSync(new URL('../src/pages/home/styles.ts', import.meta.url), 'utf8');
assert.match(stylesSource, /data-admin-review-theme="light"\] \.admin-code-check-head strong/);
assert.match(stylesSource, /data-admin-review-theme="light"\] \.external-links-note/);
assert.match(stylesSource, /\.admin-code-source-line\.is-target/);
assert.match(stylesSource, /data-admin-review-theme="light"\] \.admin-code-source-line\.is-target/);

const adminUiRenderSource = adminUiSource;
assert.match(adminUiRenderSource, /function renderAdminCodeCheck\(report, detail = null\)/);
assert.match(adminUiRenderSource, /function renderAdminAuditReadableEvidence\(detail, item\)/);
assert.match(adminUiRenderSource, /条目中可见 URL/);
assert.match(adminUiRenderSource, /data-admin-code-jump/);
assert.match(adminUiRenderSource, /function bindAdminCodeCheckNavigation\(overlay, detail\)/);
assert.match(adminUiRenderSource, /data-admin-audit-recheck/);
assert.match(adminUiRenderSource, /prefetchedDetail \|\| await fetchAdminReviewDetail\(project\.id\)/);
assert.match(adminUiRenderSource, /deviceCheckPending \? "disabled" : ""/, 'approval stays disabled until the device check finished');

console.log('EJS upload gate + audit report smoke: ok');
