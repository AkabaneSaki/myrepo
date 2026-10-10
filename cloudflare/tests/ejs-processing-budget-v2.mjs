import assert from 'node:assert/strict';
import { analyzeProjectCodeV2, analyzeLocalProjectCode } from '../src/utils/ejs-checker/index.mjs';
import { CHECKER_LIMITS } from '../src/utils/ejs-checker/limits.mjs';
import { collectProjectExternalLinks } from '../src/utils/external-links/collect.mjs';

const regexInput = scripts => [{ fileName: 'scripts.json', type: 'regex', text: JSON.stringify(scripts.map((replaceString, i) => ({ id: String(i), scriptName: 'script-' + i, findRegex: 'x', replaceString }))) }];
const worldbookInput = contents => [{ fileName: 'book.json', type: 'worldbook', text: JSON.stringify({ entries: contents.map((content, uid) => ({ uid, comment: 'entry-' + uid, content })) }) }];

for (const source of ['eval("globalThis.checkerExecuted = true")', 'Function("return 1")()', 'while(true){}']) {
  const input = regexInput(['<script>' + source + '</script>']);
  assert.equal(analyzeLocalProjectCode(input).gate, 'accept', 'local phase handles compatibility and syntax only');
  assert.equal(analyzeProjectCodeV2(input).gate, 'accept', 'capability risks are decided by the human reviewer');
  assert.equal(analyzeProjectCodeV2(input).audit, 'yellow');
}
assert.equal(globalThis.checkerExecuted, undefined, 'neither checker phase executes author code');
assert.equal(analyzeLocalProjectCode(worldbookInput(['<% const exposed = 1; %>'])).gate, 'reject');
assert.equal(analyzeLocalProjectCode(regexInput(['<script>const broken = ;</script>'])).gate, 'accept');
assert.equal(analyzeProjectCodeV2(regexInput(['<script>fetch("https://example.com/data")</script>'])).gate, 'accept');

const cases = [
  worldbookInput(Array(CHECKER_LIMITS.entries + 1).fill('small')),
  regexInput(['<script>' + ' '.repeat(CHECKER_LIMITS.javaScriptCharacters) + '0;</script>']),
  regexInput(['<script>' + '0;'.repeat(CHECKER_LIMITS.astNodesPerUnit) + '</script>']),
  regexInput(Array(4).fill('<script>' + '0;'.repeat(15000) + '</script>')),
  regexInput(Array(CHECKER_LIMITS.codeUnits + 1).fill('<script>0;</script>')),
  regexInput(['<script>' + '('.repeat(5000) + '0' + ')'.repeat(5000) + '</script>']),
];
// Body length alone is not a reason to reject large prose, HTML, or CSS.
const longCss = '<style>' + '.card{color:red}'.repeat(25000) + '</style>';
const largeCompatibleFiles = [
  worldbookInput(['x'.repeat(300001)]),
  worldbookInput(Array(21).fill('x'.repeat(100000))),
  worldbookInput(['<% { const ok = true; void ok; } %>' + 'prose'.repeat(65000)]),
  regexInput([longCss]),
  regexInput([longCss + '<script>const good = 1;</script>']),
];
for (const analyze of [analyzeLocalProjectCode, analyzeProjectCodeV2]) {
  for (const input of largeCompatibleFiles) {
    const result = analyze(input);
    assert.equal(result.gate, 'accept', JSON.stringify(result.findings.map(f => f.ruleId + ':' + f.detail)));
    assert.ok(!result.findings.some(f => f.ruleId === 'CHECKER-LIMIT'), 'large text/CSS must not hit CHECKER-LIMIT');
  }
  // Unsafe executable scripts must still be checked, even after a large CSS block.
  const unsafe = analyze(regexInput([longCss + '<script>eval("bad")</script>']));
  if (analyze === analyzeProjectCodeV2) assert.equal(unsafe.audit, 'yellow');
  for (const [caseIndex, input] of cases.entries()) {
    const result = analyze(input);
    assert.equal(result.gate, 'accept');
    assert.equal(result.audit, 'yellow');
    assert.ok(result.findings.some(item => item.ruleId === 'CHECKER-LIMIT'), 'case ' + caseIndex + ': ' + JSON.stringify(result.findings.map(item => ({ rule: item.ruleId, detail: item.detail }))));
    assert.ok(!result.findings.some(item => item.ruleId === 'EJS-PARSE' || item.ruleId === 'JS-PARSE'));
  }
  const many = analyze(regexInput(Array(200).fill('<script>(() => { const local = 1; return local; })();</script>')));
  assert.equal(many.gate, 'accept', '200 ordinary scripts are fully checked within the work budget');
  assert.equal(many.files[0].items, 200);
}
const media = collectProjectExternalLinks({
  regexEntries: [{ replaceString: longCss + '<img src="https://files.catbox.moe/test.png">' }],
});
assert.ok(media.some(record => record.url === 'https://files.catbox.moe/test.png' && record.observations.some(o => o.usage === 'media' && o.trust === 'trusted')),
  'large CSS must not lose trusted media-link evidence');

console.log('Two-phase rules, large prose/CSS, non-execution, executable budgets and media links: passed');
